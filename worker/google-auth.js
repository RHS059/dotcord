// Google OIDC server flow. No Google API tokens are retained or exposed to clients.
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const FLOW_COOKIE = '__Host-dotcord_oauth';
const SESSION_COOKIE = '__Host-dotcord_session';
const FLOW_MS = 10 * 60_000;
const SESSION_MS = 7 * 24 * 60 * 60_000;
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const cookie = (name, value, seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
function readCookie(request, name) {
  const matches = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function response(body, status = 200, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers,
  } });
}
export function googleConfigured(env) {
  try {
    const url = new URL(env.GOOGLE_REDIRECT_URI);
    return Boolean(typeof env.GOOGLE_CLIENT_ID === 'string' && env.GOOGLE_CLIENT_ID.trim() &&
      typeof env.GOOGLE_CLIENT_SECRET === 'string' && env.GOOGLE_CLIENT_SECRET.trim() &&
      url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/auth/google/callback' && url.href === env.GOOGLE_REDIRECT_URI);
  } catch { return false; }
}
function configuredFor(request, env) {
  return googleConfigured(env) && new URL(request.url).origin === new URL(env.GOOGLE_REDIRECT_URI).origin;
}
async function remoteJSON(url, options = {}) {
  const result = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  if (!result.ok || !result.body) throw new Error('Google unavailable');
  const reader = result.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) throw new Error('Oversized response');
      chunks.push(value);
    }
  } catch (e) { await reader.cancel().catch(() => {}); throw e; } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function decode(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid JWT');
  return Uint8Array.from(atob(segment.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function verifyIDToken(jwt, env, nonce) {
  if (typeof jwt !== 'string' || jwt.length > 16_000) throw new Error('Invalid JWT');
  const parts = jwt.split('.'); if (parts.length !== 3) throw new Error('Invalid JWT');
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256 || header.crit) throw new Error('Invalid header');
  const keys = await remoteJSON(JWKS);
  const candidates = Array.isArray(keys.keys) ? keys.keys.filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig')) : [];
  if (candidates.length !== 1) throw new Error('Unknown key');
  const key = await crypto.subtle.importKey('jwk', candidates[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))) throw new Error('Invalid signature');
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
    !audiences.includes(env.GOOGLE_CLIENT_ID) || audiences.some(a => typeof a !== 'string') ||
    (audiences.length > 1 && claims.azp !== env.GOOGLE_CLIENT_ID) ||
    (claims.azp !== undefined && claims.azp !== env.GOOGLE_CLIENT_ID) ||
    !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 60 || claims.iat < now - 600 ||
    claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 255 ||
    claims.email_verified !== true || typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) throw new Error('Invalid claims');
  return { subject: claims.sub, email: claims.email.toLowerCase() };
}
export async function googleIdentity(request, env) {
  if (!configuredFor(request, env)) return null;
  const secret = readCookie(request, SESSION_COOKIE); if (!secret) return null;
  const row = await env.DB.prepare('SELECT subject, email, user_id FROM auth_sessions WHERE id = ? AND expires > ?').bind(await hash(secret), Date.now()).first();
  return row ? { provider: 'google', subject: row.subject, email: row.email, user_id: row.user_id } : null;
}
export async function handleGoogleAuth(request, env, { resolveAccount, audit = async () => {} } = {}) {
  const url = new URL(request.url);
  if (!['/api/auth/providers', '/auth/google/start', '/auth/google/callback', '/auth/logout'].includes(url.pathname)) return null;
  const expectedMethod = url.pathname === '/auth/logout' ? 'POST' : 'GET';
  if (request.method !== expectedMethod) return response({ error: 'Method not allowed' }, 405, { Allow: expectedMethod });
  if (url.pathname === '/api/auth/providers') return response({ google: configuredFor(request, env), google_start: '/auth/google/start', chatgpt: true });
  if (url.pathname === '/auth/logout') {
    if (url.protocol !== 'https:' || request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'Same-origin request required' }, 403);
    const secret = readCookie(request, SESSION_COOKIE);
    if (secret) await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(await hash(secret)).run();
    return response({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
  }
  if (!configuredFor(request, env)) return response({ error: 'Google sign-in is not configured for this site' }, 503);
  try {
    if (url.pathname === '/auth/google/start') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return response({ error: 'Invalid sign-in request' }, 403);
      await audit('google_signin', 'attempt');
      const state = random(), browser = random(), verifier = random(), nonce = random(), now = Date.now();
      await env.DB.prepare('DELETE FROM oauth_states WHERE id IN (SELECT id FROM oauth_states WHERE expires <= ? LIMIT 100)').bind(now).run();
      const row = await env.DB.prepare('INSERT INTO oauth_states (id,browser_hash,verifier,nonce,created,expires) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM oauth_states) < 1000 RETURNING id')
        .bind(await hash(state), await hash(browser), verifier, nonce, now, now + FLOW_MS).first();
      if (!row) return response({ error: 'Sign-in is busy; try again later' }, 429);
      const target = new URL(AUTH);
      target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'openid email', state, nonce, code_challenge: await hash(verifier), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
      return response(null, 302, { Location: target.href, 'Set-Cookie': cookie(FLOW_COOKIE, browser, FLOW_MS / 1000) });
    }
    const state = url.searchParams.get('state'), browser = readCookie(request, FLOW_COOKIE);
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browser || url.searchParams.getAll('state').length !== 1) throw new Error('Invalid state');
    // Consume only a state that matches this browser; one atomic claim prevents replay/races.
    const flow = await env.DB.prepare('DELETE FROM oauth_states WHERE id = ? AND browser_hash = ? AND expires > ? RETURNING verifier, nonce')
      .bind(await hash(state), await hash(browser), Date.now()).first();
    if (!flow) throw new Error('Expired state');
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) throw new Error('Authorization failed');
    const data = await remoteJSON(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: flow.verifier }) });
    const identity = await verifyIDToken(data.id_token, env, flow.nonce);
    const account = await resolveAccount(identity, request);
    const userId = typeof account === 'string' ? account : account?.user_id;
    if (typeof userId !== 'string' || !userId.length) throw new Error('Account denied');
    await audit('google_signin', 'success');
    const secret = random(), now = Date.now();
    await env.DB.prepare('DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE expires <= ? LIMIT 100)').bind(now).run();
    const session = await env.DB.prepare('INSERT INTO auth_sessions (id,subject,email,user_id,created,expires) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM auth_sessions) < 10000 RETURNING id')
      .bind(await hash(secret), identity.subject, identity.email, userId, now, now + SESSION_MS).first();
    if (!session) throw new Error('Session capacity');
    const old = readCookie(request, SESSION_COOKIE);
    if (old) await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(await hash(old)).run();
    const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    headers.append('Set-Cookie', cookie(FLOW_COOKIE, '', 0));
    headers.append('Set-Cookie', cookie(SESSION_COOKIE, secret, SESSION_MS / 1000));
    return new Response(null, { status: 303, headers });
  } catch (error) {
    try { await audit('google_signin', 'denied'); } catch { /* Never expose provider/storage errors. */ }
    const message = error?.code === 'GOOGLE_ACCOUNT_LINK_REQUIRED'
      ? 'This email already has an account. Sign in with its existing ChatGPT account, then choose Continue with Google to link them.'
      : 'Google sign-in could not be completed. Restart sign-in or ask the administrator to check your account access.';
    return response({ error: message }, 403, { 'Set-Cookie': cookie(FLOW_COOKIE, '', 0) });
  }
}
