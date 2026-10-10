#!/usr/bin/env python3
"""Isolated fixtures only: no hosted credentials, subscriptions, posts, or wakes."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("dotcord_wake", Path(__file__).resolve().parents[1] / "clients/dotcord_wake.py")
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
FAKE_TOKEN = "SYNTHETIC_ONLY_" + "x" * 27 + "z"
assert len(FAKE_TOKEN) == 43
PAYLOAD = {"message_id": "fixture-message", "text": "@receiver wake up"}
HEADERS = {"content-type": "application/json", "cf-ray": "0123456789abcdef-TST"}


class WakeClientTests(unittest.TestCase):
    def result(self, results=None, status=200, message_id="fixture-message", **options):
        data = {"message_id": message_id, "results": results if results is not None else [{"handle": "receiver", "status": "accepted", "attempts": 1}]}
        return client.summarize(status, HEADERS, json.dumps(data).encode(), 0,
                                expected=("receiver",), message_id="fixture-message", **options)

    def test_rate_limit_and_partial_delivery(self):
        payload = {"message_id": "fixture-message", "results": [{"handle": "receiver", "status": "rate_limited", "retry_after_seconds": 15}]}
        summary, code = client.summarize(429, {**HEADERS, "retry-after": "15"}, json.dumps(payload).encode(), 0, message_id="fixture-message")
        self.assertEqual(code, 4)
        self.assertEqual(summary["outcome"], "rate_limited")
        self.assertEqual(summary["retry_after_seconds"], 15)
        summary, code = self.result(results=[{"handle": "receiver", "status": "rate_limited", "retry_after_seconds": 8}, {"handle": "second", "status": "accepted"}])
        self.assertEqual(code, 4)
        self.assertEqual(summary["results"][0]["retry_after_seconds"], 8)

    def test_utf8_byte_limit(self):
        with self.assertRaises(client.ClientError):
            client.validate_payload({**PAYLOAD, "text": "界" * 7999})

    def test_exact_origin(self):
        self.assertEqual(client.endpoint(client.DEFAULT_ORIGIN), client.DEFAULT_ORIGIN + "/api/wake")
        for origin in ("http://relay.test", "https://evil.test", client.DEFAULT_ORIGIN + "/api", client.DEFAULT_ORIGIN + "?x=y", "https://user:secret@relay.test", "https://relay.test:444", "https://relay.test\n"):
            with self.assertRaises(client.ClientError):
                client.endpoint(origin)

    def test_payload_validation(self):
        self.assertEqual(client.validate_payload(PAYLOAD), PAYLOAD)
        self.assertEqual(client.validate_payload({**PAYLOAD, "sender": "ignored legacy label"}), PAYLOAD)
        for value in (None, [], {}, {**PAYLOAD, "extra": True}, {**PAYLOAD, "message_id": "x" * 121}, {**PAYLOAD, "text": ""}, {**PAYLOAD, "text": "😀" * 4001}, {**PAYLOAD, "source_url": 42}):
            with self.assertRaises(client.ClientError):
                client.validate_payload(value)
        client.validate_payload({**PAYLOAD, "text": "😀" * 4000})
        routed = {"message_id": "thread-fixture", "text": "project discussion", "recipients": ["receiver"]}
        self.assertEqual(client.validate_payload(routed), routed)
        for recipients in ([], "receiver", ["receiver", "receiver"], ["Receiver"], [None], ["r"], ["aa"] * 11):
            with self.assertRaises(client.ClientError):
                client.validate_payload({**routed, "recipients": recipients})

    def test_curl_secret_transport_and_headers(self):
        body = b'{"error":"Sign in to Dotcord to continue."}'
        response = b"HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 401\r\ncontent-type: application/json\r\ncf-ray: 0123456789abcdef-TST\r\n\r\n" + body + client.STATUS_MARKER + b"401"
        with patch.dict(os.environ, {"DOTCORD_TOKEN": FAKE_TOKEN, "HTTPS_PROXY": "http://configured-proxy.test:8080"}):
            with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, response, FAKE_TOKEN.encode())) as run:
                status, headers, returned, code = client.request(client.endpoint(client.DEFAULT_ORIGIN), PAYLOAD, FAKE_TOKEN)
        self.assertEqual((status, returned, code), (401, body, 0))
        self.assertEqual(headers, HEADERS)
        run.assert_called_once()
        args, kwargs = run.call_args
        command = args[0]
        self.assertEqual(command[:2], ["curl", "--disable"])
        self.assertNotIn(FAKE_TOKEN, " ".join(command))
        self.assertNotIn("DOTCORD_TOKEN", kwargs["env"])
        self.assertEqual(kwargs["env"]["HTTPS_PROXY"], "http://configured-proxy.test:8080")
        self.assertIn(FAKE_TOKEN.encode(), kwargs["input"])
        for forbidden in ("--retry", "--location", "-L", "--user-agent", "-A", "--proxy", "--insecure", "-k"):
            self.assertNotIn(forbidden, command)
        self.assertIn("360", command)
        self.assertEqual(kwargs["timeout"], 370)
        self.assertIn(b'header = "Authorization: Bearer ', kwargs["input"])

    def test_quoted_config(self):
        self.assertEqual(client.config_quote('a\\b"c\nd\t'), '"a\\\\b\\"c\\nd\\t"')

    def test_probe_succeeds_only_at_application_gate(self):
        body = b'{"error":"Sign in to the Site with your invited ChatGPT account."}'
        summary, code = client.summarize(401, HEADERS, body, 0, probe=True)
        self.assertEqual((summary["outcome"], code), ("ingress_reachable", 0))
        self.assertFalse(summary["wake_verified"])
        summary, code = client.summarize(401, HEADERS, b'{"error":"Invalid or revoked API token."}', 0, probe=True)
        self.assertEqual((summary["outcome"], code), ("authentication_rejected", 2))

    def test_denial_and_uncertainty_classification(self):
        fixtures = [(403, {"content-type": "text/plain"}, b"error code: 1010", 0, "edge_denied", 3),
                    (401, HEADERS, b'{"error":"Invalid or revoked API token."}', 0, "authentication_rejected", 2),
                    (400, HEADERS, b'{"error":"Rejected"}', 0, "application_rejected", 2),
                    (200, {"content-type": "text/html"}, b"<html>login</html>", 0, "non_application_response", 3),
                    (302, HEADERS, b"", 0, "redirect_refused", 3),
                    (0, {}, b"", 28, "transport_error", 5)]
        for status, headers, body, curl_code, outcome, expected_code in fixtures:
            summary, code = client.summarize(status, headers, body, curl_code)
            self.assertEqual((summary["outcome"], code), (outcome, expected_code))
            self.assertFalse(summary["wake_verified"])

    def test_callback_acceptance_is_not_wake(self):
        summary, code = self.result()
        self.assertEqual((summary["outcome"], code), ("callbacks_accepted", 0))
        self.assertEqual(summary["accepted_callbacks"], 1)
        self.assertFalse(summary["wake_verified"])
        self.assertIn("target agent's activity", summary["detail"])

    def test_missing_failed_and_wrong_recipients(self):
        for result in ([], [{"handle": "other", "status": "accepted"}], *[[{"handle": "receiver", "status": status}] for status in ("not_subscribed", "unregistered", "different_discord", "inactive", "rejected", "gone", "transient", "oversized", "inbox_full", "inbox_unavailable", "message_conflict", "already_acknowledged")]):
            summary, code = self.result(result)
            self.assertEqual((summary["outcome"], code), ("delivery_incomplete", 4))
        summary, code = self.result(message_id="wrong-message")
        self.assertEqual((summary["outcome"], code), ("unexpected_application_response", 3))

    def test_malformed_status_is_sanitized(self):
        for status in ([], {}, None, 1):
            summary, code = self.result([{"handle": "receiver", "status": status}])
            self.assertEqual((summary["outcome"], code), ("unexpected_application_response", 3))

    def test_subprocess_timeout_is_uncertain(self):
        with patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("curl", 370)):
            response = client.request(client.endpoint(client.DEFAULT_ORIGIN), PAYLOAD, FAKE_TOKEN)
        summary, code = client.summarize(*response)
        self.assertEqual((summary["outcome"], code), ("transport_error", 5))

    def test_arbitrary_responses_cannot_echo_tokens(self):
        for status in (200, 401, 403, 500):
            summary, _ = client.summarize(status, {**HEADERS, "cf-ray": FAKE_TOKEN}, json.dumps({"error": FAKE_TOKEN, "secret": FAKE_TOKEN}).encode(), 0)
            self.assertNotIn(FAKE_TOKEN, json.dumps(summary))
            self.assertNotIn("cf_ray", summary)

    def run_main(self, argv, data, token=FAKE_TOKEN):
        out = io.StringIO()
        fake_stdin = io.TextIOWrapper(io.BytesIO(data.encode()))
        with patch.object(sys, "argv", ["dotcord_wake.py", *argv]), patch.object(sys, "stdin", fake_stdin), patch.object(sys, "stdout", out), patch.dict(os.environ, {"DOTCORD_TOKEN": token}):
            code = client.main()
        return code, json.loads(out.getvalue())

    def test_probe_never_sends_token(self):
        with patch.object(client, "request", return_value=(401, HEADERS, b'{"error":"Sign in to the Site with your invited ChatGPT account."}', 0)) as request:
            code, summary = self.run_main(["--probe"], "not JSON")
        self.assertEqual(code, 0)
        self.assertIsNone(request.call_args.args[2])
        self.assertEqual(request.call_args.args[1], {})
        self.assertNotIn(FAKE_TOKEN, json.dumps(summary))

    def test_main_sends_once_and_checks_expected_recipient(self):
        body = json.dumps({"message_id": PAYLOAD["message_id"], "results": [{"handle": "receiver", "status": "accepted"}]}).encode()
        with patch.object(client, "request", return_value=(200, HEADERS, body, 0)) as request:
            code, summary = self.run_main(["--recipient", "receiver"], json.dumps(PAYLOAD))
        self.assertEqual((code, summary["outcome"]), (0, "callbacks_accepted"))
        request.assert_called_once()
        self.assertEqual(request.call_args.args[1], PAYLOAD)
        self.assertNotIn(FAKE_TOKEN, json.dumps(summary))

    def test_invalid_input_does_not_send(self):
        for argv, data, token in (([], json.dumps(PAYLOAD), FAKE_TOKEN), (["--recipient", "receiver"], "invalid JSON", FAKE_TOKEN), (["--recipient", "receiver"], json.dumps(PAYLOAD), "invalid"), (["--probe", "--prompt-token"], "", FAKE_TOKEN)):
            with patch.object(client, "request") as request:
                code, _ = self.run_main(argv, data, token)
            self.assertEqual(code, 2)
            request.assert_not_called()

    def test_getpass_never_falls_back_to_echo(self):
        with patch.object(client.getpass, "getpass", side_effect=client.getpass.GetPassWarning("No terminal")), patch.object(client, "request") as request:
            code, summary = self.run_main(["--recipient", "receiver", "--prompt-token"], json.dumps(PAYLOAD))
        self.assertEqual(code, 2)
        self.assertIn("No non-echoing terminal", summary["detail"])
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
