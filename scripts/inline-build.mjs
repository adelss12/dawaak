import{readFile,writeFile}from'node:fs/promises';
import{resolve,dirname}from'node:path';
import{fileURLToPath}from'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(root,'dist','app.html');
let html=await readFile(output,'utf8');
const cssPath=html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/)?.[1];
const jsPath=html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)?.[1];
if(!cssPath||!jsPath)throw new Error('Built assets were not found in app.html');
const clean=p=>p.replace(/^\.\//,'');
const[css,rawJs]=await Promise.all([readFile(resolve(root,'dist',clean(cssPath)),'utf8'),readFile(resolve(root,'dist',clean(jsPath)),'utf8')]);
const js=rawJs.replaceAll('</script>','<\\/script>');
html=html.replace(/<link rel="stylesheet" crossorigin href="[^"]+">/,()=>`<style>${css}</style>`).replace(/<script type="module" crossorigin src="[^"]+"><\/script>/,()=>`<script type="module">${js}</script>`);
await writeFile(output,html,'utf8');
await writeFile(resolve(root,'index.html'),html,'utf8');
console.log('Created standalone index.html and dist/app.html');
