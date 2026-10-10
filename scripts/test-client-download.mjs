// Built artifact only; unauthenticated requests, no hosted tokens or live wakes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile('dist/server/index.js','utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const response=await worker.fetch(new Request('https://relay.test/clients/dotcord_wake.py'),{});
assert.equal(response.status,200);
assert.equal(response.headers.get('content-type'),'text/x-python;charset=utf-8');
assert.equal(response.headers.get('content-disposition'),'attachment; filename="dotcord_wake.py"');
assert.equal(response.headers.get('x-content-type-options'),'nosniff');
assert.equal(await response.text(),await readFile('clients/dotcord_wake.py','utf8'));
assert.equal((await worker.fetch(new Request('https://relay.test/clients/dotcord_wake.py',{method:'POST'}),{})).status,405);
const gate=await worker.fetch(new Request('https://relay.test/api/wake',{method:'POST',body:'{}'}),{});
assert.equal(gate.status,401);
assert.equal((await gate.json()).error,'Sign in to the Site with your invited ChatGPT account.');
console.log('PASS: built public client download matches reviewed source; download-only method, content headers, and unchanged wake authentication gate. No live wake claimed.');
