#!/usr/bin/env python3
"""Send one Dotcord wake request using ordinary curl; never retry or change transport.

The existing bearer token comes from DOTCORD_TOKEN or hidden --prompt-token input.
JSON input is read from stdin.
--probe sends an unauthenticated request and cannot deliver a wake.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import subprocess
import sys
import warnings
from urllib.parse import urlsplit

DEFAULT_ORIGIN = "https://dotcord.example.invalid"
STATUS_MARKER = b"\n__DOTCORD_HTTP_STATUS__:"
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}\Z")
HANDLE_RE = re.compile(r"(?!.*\.\.)[a-z0-9_.]{2,32}\Z")


class ClientError(Exception):
    pass


def endpoint(origin: str) -> str:
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError:
        raise ClientError("Use an HTTPS Site origin without a path, query, or credentials.") from None
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment or port not in (None, 443)
            or any(ord(c) < 33 for c in origin)):
        raise ClientError("Use an HTTPS Site origin without a path, query, or credentials.")
    if origin.rstrip("/") != DEFAULT_ORIGIN:
        raise ClientError("This client only sends requests to the verified Dotcord Site origin.")
    return origin.rstrip("/") + "/api/wake"


def utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def validate_payload(value: object) -> dict:
    if not isinstance(value, dict) or set(value) - {"sender", "message_id", "text", "source_url", "recipients"}:
        raise ClientError("Input must be a JSON object with message_id, text, and optional recipients/source_url.")
    # Legacy callers may supply sender, but the server identifies the saved token name.
    value = {key: item for key, item in value.items() if key != "sender"}
    for key, limit in (("message_id", 120), ("text", 8000)):
        item = value.get(key)
        if not isinstance(item, str) or not item.strip() or utf16_length(item) > limit:
            raise ClientError(f"{key} must be nonempty text of at most {limit} characters.")
    if "source_url" in value and not isinstance(value["source_url"], str):
        raise ClientError("source_url must be a Discord message-link string.")
    if "recipients" in value:
        recipients = value["recipients"]
        if (not isinstance(recipients, list) or not 1 <= len(recipients) <= 10
                or any(not isinstance(item, str) or not HANDLE_RE.fullmatch(item) for item in recipients)
                or len(set(recipients)) != len(recipients)):
            raise ClientError("recipients must contain 1–10 unique lowercase handles.")
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > 20000:
        raise ClientError("The serialized request exceeds Dotcord's 20,000-byte limit.")
    return value


def config_quote(value: str) -> str:
    # curl's quoted config syntax supports these escapes. No secret goes in argv.
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r").replace("\v", "\\v") + '"'


def request(url: str, payload: dict, token: str | None, timeout: int = 360) -> tuple[int, dict, bytes, int]:
    config = ["url = " + config_quote(url), 'header = "Content-Type: application/json"',
              'header = "Accept: application/json"']
    if token:
        config.append("header = " + config_quote("Authorization: Bearer " + token))
    config.append("data-binary = " + config_quote(json.dumps(payload, ensure_ascii=False, separators=(",", ":"))))
    command = ["curl", "--disable", "--silent", "--show-error", "--include", "--proto", "=https",
               "--request", "POST", "--connect-timeout", "15", "--max-time", str(timeout),
               "--max-redirs", "0", "--write-out", STATUS_MARKER.decode() + "%{http_code}", "--config", "-"]
    # Preserve the environment's normal network/proxy settings; never pass the token on.
    child_env = {key: value for key, value in os.environ.items() if key != "DOTCORD_TOKEN"}
    try:
        result = subprocess.run(command, input=("\n".join(config) + "\n").encode("utf-8"),
                                capture_output=True, env=child_env, timeout=timeout + 10, check=False)
    except FileNotFoundError:
        raise ClientError("curl is required. Install it through your environment's supported setup.") from None
    except subprocess.TimeoutExpired:
        return 0, {}, b"", 28
    except OSError:
        raise ClientError("curl could not be started in this environment.") from None
    # Never echo stderr, request contents, or arbitrary error bodies: they can include secrets.
    output, separator, status_raw = result.stdout.rpartition(STATUS_MARKER)
    status = int(status_raw) if separator and re.fullmatch(rb"\d{3}", status_raw) else 0
    if not separator:
        output = result.stdout
    headers = {}
    # --include can contain a proxy CONNECT response and/or informational responses.
    while output.startswith(b"HTTP/"):
        match = re.search(rb"\r?\n\r?\n", output)
        if not match:
            break
        block, output = output[:match.start()], output[match.end():]
        current = {}
        for line in block.splitlines()[1:]:
            key, sep, value = line.partition(b":")
            if sep:
                current[key.decode("latin-1").lower()] = value.decode("latin-1").strip()
        headers = current
    return status, headers, output, result.returncode


def summarize(status: int, headers: dict, body: bytes, curl_code: int, probe: bool = False, expected: tuple[str, ...] = (), message_id: str | None = None) -> tuple[dict, int]:
    summary = {"http_status": status, "transport": "curl", "wake_verified": False}
    ray = headers.get("cf-ray", "")
    if re.fullmatch(r"[A-Fa-f0-9]{16}-[A-Z]{3}", ray):
        summary["cf_ray"] = ray
    if curl_code:
        summary.update(outcome="transport_error", curl_exit_code=curl_code,
                       detail="Request did not complete reliably. Delivery is uncertain; do not automatically retry.")
        return summary, 5
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        data = None
    if 300 <= status < 400:
        summary.update(outcome="redirect_refused", detail="The endpoint redirected. No redirect was followed and no credential was forwarded.")
        return summary, 3
    if status == 403 and b"1010" in body and not isinstance(data, dict):
        summary.update(outcome="edge_denied", detail="Cloudflare error 1010. Stop here and ask the hosting provider to review the request; do not switch identity, proxy, or transport to bypass it.")
        return summary, 3
    if not isinstance(data, dict) or "application/json" not in headers.get("content-type", "").lower():
        summary.update(outcome="non_application_response", detail="The endpoint did not return the expected JSON response. A hosting or network layer may have intercepted it.")
        return summary, 3
    if status == 401:
        expected_probe = data.get("error") in {"Sign in to Dotcord to continue.", "Sign in to the Site with your invited ChatGPT account."}
        if probe and expected_probe:
            summary.update(outcome="ingress_reachable", detail="The unauthenticated probe reached Dotcord's application gate. No token was sent and no wake was delivered.")
            return summary, 0
        summary.update(outcome="authentication_rejected", detail="Dotcord rejected authentication. Check the token privately; do not paste it into chat or logs.")
        return summary, 2
    if status == 429 and data.get("message_id") == message_id and isinstance(data.get("results"), list):
        retry = headers.get("retry-after", "")
        if re.fullmatch(r"[0-9]{1,2}", retry) and 1 <= int(retry) <= 15:
            summary["retry_after_seconds"] = int(retry)
        summary.update(outcome="rate_limited", detail="The recipient wake limit was reached. No automatic retry was made.")
        return summary, 4
    if status < 200 or status >= 300 or "error" in data:
        summary.update(outcome="application_rejected", detail="Dotcord rejected the request. Check registration, payload, account access, and the selected destination.")
        return summary, 2
    if probe:
        summary.update(outcome="unexpected_probe_response", detail="The unauthenticated probe did not return the expected authentication rejection. No wake result is verified.")
        return summary, 3
    if data.get("message_id") != message_id or message_id is None:
        summary.update(outcome="unexpected_application_response", detail="The response message ID did not match the request. Delivery is not verified.")
        return summary, 3
    results = data.get("results")
    if not isinstance(results, list) or any(not isinstance(item, dict) for item in results):
        summary.update(outcome="unexpected_application_response", detail="The JSON response did not contain a valid wake result list.")
        return summary, 3
    # Only expected result fields are returned; never echo arbitrary response data.
    allowed_statuses = {"accepted", "unregistered", "different_discord", "not_subscribed", "inactive", "gone", "oversized", "transient", "rejected", "inbox_full", "inbox_unavailable", "message_conflict", "already_acknowledged", "rate_limited"}
    safe_results = []
    for item in results:
        handle, delivery = item.get("handle"), item.get("status")
        if not isinstance(handle, str) or not HANDLE_RE.fullmatch(handle) or not isinstance(delivery, str) or delivery not in allowed_statuses:
            summary.update(outcome="unexpected_application_response", detail="Dotcord returned an unrecognized delivery result.")
            return summary, 3
        result = {"handle": handle, "status": delivery}
        if isinstance(item.get("attempts"), int) and 0 <= item["attempts"] <= 3:
            result["attempts"] = item["attempts"]
        retry = item.get("retry_after_seconds")
        if delivery == "rate_limited" and isinstance(retry, int) and 1 <= retry <= 15:
            result["retry_after_seconds"] = retry
        inbox_id, inbox_expiry = item.get("inbox_id"), item.get("inbox_expires_at")
        if (isinstance(inbox_id, str) and re.fullmatch(r"inbox_[a-f0-9]{64}", inbox_id)
                and isinstance(inbox_expiry, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", inbox_expiry)):
            result["inbox_saved"] = True
            result["inbox_expires_at"] = inbox_expiry
        safe_results.append(result)
    accepted = sum(item["status"] == "accepted" for item in safe_results)
    summary.update(results=safe_results, accepted_callbacks=accepted)
    recipients_accepted = all(any(row["handle"] == handle and row["status"] == "accepted" for row in safe_results) for handle in expected)
    if results and accepted == len(results) and recipients_accepted:
        summary.update(outcome="callbacks_accepted", detail="The callback receivers accepted delivery. Verify the matching message ID in the target agent's activity before claiming a wake.")
        return summary, 0
    summary.update(outcome="delivery_incomplete", detail="One or more callbacks were not accepted, or no recipient was selected. Check each result and the recipient's active subscription. A failed callback may still have a temporary inbox copy; never automatically repost.")
    return summary, 4


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true", help="test unauthenticated ingress without reading or sending a token")
    parser.add_argument("--recipient", action="append", default=[], help="expected recipient handle; required for a wake, repeat for multiple recipients")
    parser.add_argument("--prompt-token", action="store_true", help="read an existing token from a non-echoing terminal instead of the environment")
    args = parser.parse_args()
    try:
        url = endpoint(DEFAULT_ORIGIN)
        if args.probe:
            if args.prompt_token or args.recipient:
                raise ClientError("Use --probe on its own; it never uses a token or sends a wake.")
            token, payload = None, {}
        else:
            if not args.recipient or any(not HANDLE_RE.fullmatch(item) for item in args.recipient):
                raise ClientError("Supply --recipient with each intended lowercase recipient handle.")
            if args.prompt_token:
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter("error", getpass.GetPassWarning)
                        token = getpass.getpass("Existing Dotcord token (hidden): ")
                except (getpass.GetPassWarning, EOFError):
                    raise ClientError("No non-echoing terminal is available. Use your environment's private DOTCORD_TOKEN setting.") from None
            else:
                token = os.environ.get("DOTCORD_TOKEN", "")
            if not TOKEN_RE.fullmatch(token):
                raise ClientError("Set DOTCORD_TOKEN privately to an existing wake token; no token was sent.")
            try:
                raw = sys.stdin.buffer.read(80001)
                if len(raw) > 80000:
                    raise ClientError("Input is too large.")
                payload = validate_payload(json.loads(raw))
            except (ValueError, UnicodeError):
                raise ClientError("stdin must contain one valid UTF-8 JSON wake request.") from None
        summary, code = summarize(*request(url, payload, token), probe=args.probe, expected=tuple(args.recipient), message_id=payload.get("message_id"))
    except ClientError as exc:
        summary, code = {"outcome": "client_error", "detail": str(exc), "wake_verified": False}, 2
    print(json.dumps(summary, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
