// Local integration evidence only: real Worker + migrated SQLite; all remote I/O is mocked.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import worker from '../worker/index.js';

const sql = new DatabaseSync(':memory:');
for (const file of readdirSync(new URL('../drizzle', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) {
  sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
}
const DB = {
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sql.exec('COMMIT');
      return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
  prepare(query) {
    return {bind(...args) {return {
      first: async () => sql.prepare(query).get(...args) || null,
      all: async () => ({results: sql.prepare(query).all(...args)}),
      run: async () => ({meta: {changes: sql.prepare(query).run(...args).changes}}),
    };}};
  },
};
const env = {DB, AUTHORIZED_ACCOUNTS: JSON.stringify([
  {email: 'owner@example.test', role: 'owner'},
  {email: 'member@example.test', role: 'member'},
])};
const emails = {owner: 'owner@example.test', member: 'member@example.test', outsider: 'outsider@example.test'};
async function rpc(owner, method, params = {}) {
 // Independent functional case; cooldown behavior is covered by test-wake-security.mjs.
 sql.exec('DELETE FROM wake_limits');

  const headers = {'content-type': 'application/json'};
  if (owner) Object.assign(headers, {'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': emails[owner]});
  const response = await worker.fetch(new Request('https://relay.test/mcp', {
    method: 'POST', headers, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
  }), env);
  return response.json();
}
async function tool(owner, name, args = {}) {
  const result = await rpc(owner, 'tools/call', {name, arguments: args});
  if (result.error) return {error: result.error};
  return JSON.parse(result.result.content[0].text);
}
async function success(owner, name, args) {
  const result = await tool(owner, name, args);
  assert.ok(!result.error, `${name}: ${JSON.stringify(result.error)}`);
  return result;
}

const guild = '123456789012345678', channel = '234567890123456789', otherChannel = '334567890123456789', thread = '734567890123456789';
const hook = 'https://discord.com/api/webhooks/434567890123456789/' + 'x'.repeat(60);
const bot = 'local_test_bot_token_123456789';
const secretBytes = Buffer.alloc(32, 17);
const secret = 'whsec_' + secretBytes.toString('base64');
const originalFetch = globalThis.fetch;
const calls = [], events = [];
const deliveryOnly=rows=>rows.map(({inbox_id,inbox_expires_at,...row})=>row);
let callbackStatus = 204, failBeforeSuccess = 0, messageCounter = 0;
const baseMessage = BigInt('534567890123456780');
globalThis.fetch = async (url, options = {}) => {
  calls.push({url: String(url), method: options.method || 'GET'});
  assert.equal(options.redirect, 'manual');
  if (String(url).startsWith(hook)) {
    const requestedThread = new URL(url).searchParams.get('thread_id');
    assert.equal(String(url), hook + '?wait=true' + (requestedThread ? '&thread_id=' + thread : ''));
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.allowed_mentions, {parse: []});
    assert.ok(!options.headers.Authorization);
    return Response.json({id: String(baseMessage + BigInt(++messageCounter)), channel_id: requestedThread || channel, content: body.content});
  }
  if (String(url) === 'https://discord.com/api/v10/channels/' + thread) {
    assert.equal(options.method || 'GET', 'GET');
    assert.equal(options.headers.Authorization, 'Bot ' + bot);
    return Response.json({id: thread, guild_id: guild, parent_id: channel, type: 11});
  }
  if (String(url).startsWith('https://discord.com/api/v10/channels/')) {
    assert.equal(String(url), `https://discord.com/api/v10/channels/${channel}/messages?limit=7`);
    assert.equal(options.headers.Authorization, 'Bot ' + bot);
    return Response.json([{
      id: '634567890123456789', content: 'Hello @receiver', author: {username: 'poster', ignored_secret: 'hidden'},
      timestamp: '2026-10-08T00:00:00.000Z', attachments: [{filename: 'note.txt', url: 'https://cdn.discordapp.com/note.txt'}],
    }]);
  }
  assert.equal(String(url), 'https://chatgpt.com/mock-receiver');
  assert.equal(options.method, 'POST');
  const headers = options.headers;
  assert.equal(headers['webhook-signature'], 'v1,' + createHmac('sha256', secretBytes)
    .update(headers['webhook-id'] + '.' + headers['webhook-timestamp'] + '.' + options.body).digest('base64'));
  const event = JSON.parse(options.body);
  if (event.type === 'verification') return Response.json({challenge: event.challenge});
  assert.equal(headers['webhook-id'], event.eventId);
  events.push({event, subscription: headers['X-MCP-Subscription-Id']});
  return new Response(null, {status: failBeforeSuccess-- > 0 ? 503 : callbackStatus});
};

try {
  const first = await success('owner', 'add_discord', {name: 'Shared destination', channel_url: `https://discord.com/channels/${guild}/${channel}`, bot_token: bot});
  const receiverConnection = await success('member', 'add_discord', {name: 'Same destination, separate owner', channel_url: `https://discord.com/channels/${guild}/${channel}`, bot_token: bot});
  const separate = await success('member', 'add_discord', {name: 'Other channel', channel_url: `https://discord.com/channels/${guild}/${otherChannel}`, bot_token: bot});
  await success('owner', 'register_dot', {dot_id: 'sender', discord_id: first.id, webhook_url: hook});
  await success('member', 'register_dot', {dot_id: 'receiver', discord_id: receiverConnection.id});
  await success('member', 'register_dot', {dot_id: 'unsubscribed', discord_id: receiverConnection.id});
  await success('member', 'register_dot', {dot_id: 'other_channel', discord_id: separate.id});
  assert.equal(calls.length, 0, 'Saving configuration must not contact any external endpoint');
  const subscriptionArgs = {name: 'dot.mentioned', arguments: {dot_id: 'receiver'}, delivery: {
    mode: 'webhook', url: 'https://chatgpt.com/mock-receiver', secret,
  }};
  assert.ok((await rpc('owner', 'events/subscribe', subscriptionArgs)).error, 'Another account cannot subscribe the receiver');
  const subscription = await rpc('member', 'events/subscribe', subscriptionArgs);
  assert.ok(subscription.result.id);

  const content = 'Hello @receiver; @receiver @sender @unregistered @unsubscribed @other_channel';
  const post = await success('owner', 'post_to_discord', {dot_id: 'sender', text: content});
  assert.equal(post.sent, true);
  assert.equal(calls.filter(c => c.url.startsWith(hook)).length, 1, 'Exactly one Discord post');
  assert.equal(events.length, 1, 'One automatic signed callback for the eligible recipient');
  assert.deepEqual(deliveryOnly(post.mention_delivery.results), [
    {handle: 'receiver', status: 'accepted', attempts: 1},
    {handle: 'unregistered', status: 'unregistered'},
    {handle: 'unsubscribed', status: 'not_subscribed', attempts: 0},
    {handle: 'other_channel', status: 'different_discord'},
  ]);
  const {event, subscription: subscriptionHeader} = events[0];
  assert.equal(subscriptionHeader, subscription.result.id);
  assert.equal(event.name, 'dot.mentioned');
  assert.equal(event.data.dot_id, 'receiver');
  assert.equal(event.data.discord_id, receiverConnection.id, 'Recipient gets their own connection reference');
  assert.equal(event.data.sender, 'sender');
  assert.equal(event.data.message_id, post.message_id);
  assert.equal(event.data.text, content);
  assert.equal(event.data.source_url, `https://discord.com/channels/${guild}/${channel}/${post.message_id}`);
  assert.equal(event.data.url, post.url);
  assert.equal(event.data.channel_url, `https://discord.com/channels/${guild}/${channel}`);
  assert.equal(event.cursor, null);

  const repeated = await success('owner', 'send_mention', {sender: 'sender', message_id: post.message_id, text: content, source_url: post.url});
  assert.equal(repeated.results[0].status, 'accepted');
  assert.equal(events[1].event.eventId, event.eventId, 'Retrying the same message yields stable receiver deduplication ID');
  const beforeRead = events.length;
  const read = await success('owner', 'read_discord', {dot_id: 'sender', limit: 7});
  assert.deepEqual(read.messages, [{id: '634567890123456789', text: 'Hello @receiver', author: 'poster', timestamp: '2026-10-08T00:00:00.000Z', url: `https://discord.com/channels/${guild}/${channel}/634567890123456789`, attachments: [{filename: 'note.txt', url: 'https://cdn.discordapp.com/note.txt'}]}]);
  assert.equal(events.length, beforeRead, 'Reading is side-effect free; it must not wake subscribers');
  await success('owner', 'send_mention', {sender: 'sender', message_id: read.messages[0].id, text: read.messages[0].text, source_url: read.messages[0].url});
  assert.equal(events.at(-1).event.data.message_id, read.messages[0].id, 'A read message can be explicitly forwarded');

  const threadCallStart = calls.length, threadEventStart = events.length;
  const threadPost = await success('owner', 'post_to_discord', {dot_id: 'sender', thread_id: thread, text: '@receiver thread reply'});
  assert.equal(threadPost.sent, true);
  assert.deepEqual(deliveryOnly(threadPost.mention_delivery.results), [{handle: 'receiver', status: 'accepted', attempts: 1}]);
  assert.deepEqual(calls.slice(threadCallStart), [
    {url: 'https://discord.com/api/v10/channels/' + thread, method: 'GET'},
    {url: hook + '?wait=true&thread_id=' + thread, method: 'POST'},
    {url: 'https://chatgpt.com/mock-receiver', method: 'POST'},
  ], 'Validate parent/guild once, then post and deliver without reposting or a second membership lookup');
  assert.equal(events.length, threadEventStart + 1);
  assert.equal(threadPost.url, `https://discord.com/channels/${guild}/${thread}/${threadPost.message_id}`);
  assert.equal(events.at(-1).event.data.source_url, threadPost.url);
  assert.equal(events.at(-1).event.data.url, threadPost.url);
  assert.equal(events.at(-1).event.data.channel_url, `https://discord.com/channels/${guild}/${channel}`);
  assert.equal(events.at(-1).event.data.discord_id, receiverConnection.id, 'Thread mention retains recipient parent connection scope');

  const callsBeforeACL = calls.length;
  for (const owner of [null, 'outsider']) {
    assert.ok((await tool(owner, 'post_to_discord', {dot_id: 'sender', text: '@receiver'})).error);
    assert.ok((await tool(owner, 'read_discord', {dot_id: 'sender', limit: 7})).error);
  }
  assert.ok((await tool('member', 'read_discord', {dot_id: 'sender', limit: 7})).error);
  assert.equal(calls.length, callsBeforeACL, 'Unauthorized reads/posts cannot use saved credentials');
  const sharedPost = await success('member', 'post_to_discord', {dot_id: 'sender', text: '@receiver authorized shared send'});
  assert.equal(sharedPost.sent, true);
  assert.equal(sharedPost.mention_delivery.results[0].status, 'accepted');
  assert.equal(events.at(-1).event.data.sender, 'sender');
  assert.equal(events.at(-1).event.data.source_url, sharedPost.url);
  for (const name of ['list_dots', 'list_discords']) {
    const serialized = JSON.stringify(await success('member', name, {}));
    for (const sensitive of [hook, bot, secret, guild, channel, 'owner@example.test']) assert.ok(!serialized.includes(sensitive), `${name} leaked saved sensitive data`);
  }

  failBeforeSuccess = 2;
  const beforeTransientPost = calls.filter(c => c.url.startsWith(hook)).length;
  const retried = await success('owner', 'post_to_discord', {dot_id: 'sender', text: '@receiver transient callback'});
  assert.equal(retried.sent, true);
  assert.deepEqual(deliveryOnly(retried.mention_delivery.results), [{handle: 'receiver', status: 'accepted', attempts: 3}]);
  assert.equal(calls.filter(c => c.url.startsWith(hook)).length, beforeTransientPost + 1, 'Callback retries never repost Discord');
  assert.equal(new Set(events.slice(-3).map(x => x.event.eventId)).size, 1);

  callbackStatus = 403;
  const rejected = await success('owner', 'post_to_discord', {dot_id: 'sender', text: '@receiver rejected callback'});
  assert.equal(rejected.sent, true, 'A callback rejection cannot hide a successful Discord post');
  assert.deepEqual(deliveryOnly(rejected.mention_delivery.results), [{handle: 'receiver', status: 'rejected', attempts: 1}]);
  callbackStatus = 503;
  const exhausted = await success('owner', 'post_to_discord', {dot_id: 'sender', text: '@receiver unavailable callback'});
  assert.equal(exhausted.sent, true);
  assert.deepEqual(deliveryOnly(exhausted.mention_delivery.results), [{handle: 'receiver', status: 'transient', attempts: 3}]);

  callbackStatus = 204;
  sql.prepare('UPDATE accounts SET enabled=0 WHERE user_id=?').run('member');
  const beforeDisabled = events.length;
  const disabled = await success('owner', 'post_to_discord', {dot_id: 'sender', text: '@receiver disabled account'});
  assert.equal(disabled.sent, true);
  assert.deepEqual(deliveryOnly(disabled.mention_delivery.results), [{handle: 'receiver', status: 'inactive', attempts: 0}]);
  assert.equal(events.length, beforeDisabled);
  sql.prepare('UPDATE accounts SET enabled=1 WHERE user_id=?').run('member');
  sql.prepare('UPDATE subscriptions SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z', subscription.result.id);
  const expired = await success('owner', 'post_to_discord', {dot_id: 'sender', text: '@receiver expired subscription'});
  assert.deepEqual(deliveryOnly(expired.mention_delivery.results), [{handle: 'receiver', status: 'not_subscribed', attempts: 0}]);
  assert.equal(events.length, beforeDisabled);
  assert.ok((await rpc('member', 'events/subscribe', subscriptionArgs)).result.id);
  callbackStatus = 410;
  const gone = await success('owner', 'post_to_discord', {dot_id: 'sender', text: '@receiver gone callback'});
  assert.equal(gone.sent, true);
  assert.deepEqual(deliveryOnly(gone.mention_delivery.results), [{handle: 'receiver', status: 'gone', attempts: 1}]);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 0);

  assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x => x.name), ['account_identities', 'account_onboarding', 'accounts', 'api_tokens', 'auth_sessions', 'discords', 'dots', 'google_oauth_settings', 'invitations', 'oauth_states', 'receiver_credentials', 'security_audit', 'security_maintenance', 'subscriptions', 'temporary_inbox', 'wake_limits', 'wake_tests']);
  for (const table of ['accounts', 'api_tokens', 'discords', 'dots', 'subscriptions']) {
    assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM ' + table).all()).includes(content), 'No posted content persisted');
  }
  console.log('PASS: local Worker→SQLite→mock Discord channel/thread post→signed subscribed cross-account callback; verified thread parent, exact payload, scope, self/duplicate filtering, explicit read→mention forwarding, ACL/redaction, callback retry/rejection/expiry/disable/removal, temporary inbox retention. No live Discord or ChatGPT wakeup claimed.');
} finally {
  globalThis.fetch = originalFetch;
  sql.close();
}
