import fs from 'node:fs';
const client=fs.readFileSync('clients/dotcord_wake.py','utf8');
const publicAssets={};
function collect(dir,prefix=''){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const filename=dir+'/'+item.name,key=prefix+'/'+item.name;if(item.isDirectory())collect(filename,key);else publicAssets[key]={body:fs.readFileSync(filename).toString('base64'),type:item.name.endsWith('.png')?'image/png':item.name.endsWith('.svg')?'image/svg+xml':item.name.endsWith('.md')?'text/markdown;charset=utf-8':'text/plain;charset=utf-8'};}}
if(fs.existsSync('public'))collect('public');
const source=fs.readFileSync('worker/index.js','utf8').replace('const publicAssets={};','const publicAssets='+JSON.stringify(publicAssets)+';').replace('const wakeClient=null;', 'const wakeClient='+JSON.stringify(client)+';');
const html=fs.readFileSync('client-build/index.html','utf8');
if(!html.includes('<div id="root"></div>')||html.includes('src="/src/'))throw Error('Invalid client build');
const start=source.indexOf('const page=');const end=source.indexOf('export default {async fetch',start);
fs.writeFileSync('dist/server/index.js',source.slice(0,start)+'const page='+JSON.stringify(html)+';\n'+source.slice(end));

fs.copyFileSync('worker/google-auth.js','dist/server/google-auth.js');
