#!/usr/bin/env node
// Local configuration only. Does not contact a service, create credentials, or deploy.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--project-id'||args[2]!=='--origin'){
  console.error('Usage: node scripts/configure-site.mjs --project-id YOUR_SITE_PROJECT_ID --origin https://YOUR-SITE-HOST');
  process.exit(2);
}
const [,projectId,,rawOrigin]=args;
if(!/^appgprj_[A-Za-z0-9]+$/.test(projectId))throw Error('Use the project ID returned for your newly provisioned Site.');
const u=new URL(rawOrigin);
if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!=='')||u.port||u.hostname.endsWith('.invalid')||/[\s\x00-\x1f]/.test(rawOrigin))throw Error('Use the verified HTTPS Site origin, without a path, custom port, query, or credentials.');
const manifest=JSON.parse(readFileSync(resolve(root,'.openai/hosting.example.json'),'utf8'));
manifest.project_id=projectId;
const clientPath=resolve(root,'clients/dotcord_wake.py');
const source=readFileSync(clientPath,'utf8');
if((source.match(/^DEFAULT_ORIGIN = .+$/gm)||[]).length!==1)throw Error('Expected exactly one client origin assignment.');
const configured=source.replace(/^DEFAULT_ORIGIN = .+$/m,'DEFAULT_ORIGIN = '+JSON.stringify(u.origin));
writeFileSync(resolve(root,'.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(clientPath,configured);
console.log('Configured the local Site manifest and exact-origin client pin. Rebuild and run all tests before publishing.');
console.log('Do not commit this deployment-specific client pin or the local hosting manifest to the public template.');
