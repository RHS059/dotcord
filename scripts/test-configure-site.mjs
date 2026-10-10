// Configuration is exercised in an isolated temp directory; no network or hosted writes.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'dotcord-config-test-'));
try{
  for(const sub of ['scripts','clients','.openai'])mkdirSync(join(dir,sub));
  for(const file of ['scripts/configure-site.mjs','clients/dotcord_wake.py','.openai/hosting.example.json'])copyFileSync(file,join(dir,file));
  const run=(origin,project='appgprj_syntheticfixture')=>spawnSync(process.execPath,[join(dir,'scripts/configure-site.mjs'),'--project-id',project,'--origin',origin],{encoding:'utf8'});
  for(const origin of ['http://example.test','https://user:password@example.test','https://example.test/path','https://example.test?x=y','https://example.test:444','https://dotcord.example.invalid'])assert.notEqual(run(origin).status,0);
  assert.notEqual(run('https://example.test','invalid').status,0);
  assert.ok(!existsSync(join(dir,'.openai/hosting.json')));
  assert.equal(run('https://example.test').status,0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'.openai/hosting.json'),'utf8')),{d1:'DB',r2:null,capabilities:['mcp'],project_id:'appgprj_syntheticfixture'});
  assert.match(readFileSync(join(dir,'clients/dotcord_wake.py'),'utf8'),/^DEFAULT_ORIGIN = "https:\/\/example\.test"$/m);
  assert.equal(run('https://replacement.example.test').status,0);
  assert.match(readFileSync(join(dir,'clients/dotcord_wake.py'),'utf8'),/^DEFAULT_ORIGIN = "https:\/\/replacement\.example\.test"$/m);
  console.log('PASS: local configuration creates the isolated Site manifest and exact client-origin pin; rejects malformed or credential-bearing setup values.');
}finally{rmSync(dir,{recursive:true,force:true});}
