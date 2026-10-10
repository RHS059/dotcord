import fs from 'node:fs';
const client=fs.readFileSync('clients/dotcord_wake.py','utf8');
const source=fs.readFileSync('worker/index.js','utf8').replace('const wakeClient=null;', 'const wakeClient='+JSON.stringify(client)+';');
const html=fs.readFileSync('client-build/index.html','utf8');
if(!html.includes('<div id="root"></div>')||html.includes('src="/src/'))throw Error('Invalid client build');
const start=source.indexOf('const page=');const end=source.indexOf('export default {async fetch',start);
fs.writeFileSync('dist/server/index.js',source.slice(0,start)+'const page='+JSON.stringify(html)+';\n'+source.slice(end));

fs.copyFileSync('worker/google-auth.js','dist/server/google-auth.js');
