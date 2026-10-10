import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);
await mkdir(new URL('server/',dist),{recursive:true});
await mkdir(new URL('.openai/',dist),{recursive:true});
await copyFile(new URL('worker/index.js',root),new URL('server/index.js',dist));
let manifest;try{manifest=JSON.parse(await readFile(new URL('.openai/hosting.json',root),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;manifest=JSON.parse(await readFile(new URL('.openai/hosting.example.json',root),'utf8'));}
if(manifest.d1!==null||manifest.r2!==null||!manifest.capabilities?.includes('mcp'))throw new Error('Receiver manifest must declare MCP and no database/storage binding.');
await writeFile(new URL('.openai/hosting.json',dist),JSON.stringify(manifest,null,2)+'\n');
await writeFile(new URL('server/wrangler.json',dist),JSON.stringify({name:'dotcord-receiver',main:'index.js',compatibility_date:'2026-05-15',no_bundle:true},null,2)+'\n');
console.log('Built receiver/dist (deployment and runtime configuration remain separate).');
