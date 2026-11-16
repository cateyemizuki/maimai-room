import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
// ESBUILD_MODULE is useful on a developer machine with an existing cached build.
const esbuild = await import(process.env.ESBUILD_MODULE || 'esbuild');
const result = await esbuild.build({
  absWorkingDir: root, entryPoints: ['src/app.js'], bundle: true, write: false,
  format: 'iife', target: ['es2020'], minify: true, legalComments: 'inline',
  loader: { '.webp': 'dataurl' },
});
const [template, roomCss, gardenCss] = await Promise.all([
  fs.readFile(path.join(root, 'src/page.html'), 'utf8'),
  fs.readFile(path.join(root, 'src/style.css'), 'utf8'),
  fs.readFile(path.join(root, 'src/garden.css'), 'utf8'),
]);
const css = gardenCss + '\n' + roomCss;
const raw = Buffer.from(result.outputFiles[0].contents);
const directory=path.join(root,'runtime');
await fs.mkdir(directory,{recursive:true});
const assets={};
for(const [encoding,data] of Object.entries({plain:raw,gzip:gzipSync(raw,{level:9})})){
  await fs.writeFile(path.join(directory,encoding==='gzip'?'room.js.gz':'room.js'),data);
  assets[encoding]={size:data.length,sha256:createHash('sha256').update(data).digest('hex')};
}
const bootstrap=(await fs.readFile(path.join(root,'src/entry.js'),'utf8')).replace('__ROOM_ASSETS__',JSON.stringify(assets));
const html = template.replace('/*__ROOM_CSS__*/', () => css).replace('/*__ROOM_JS__*/', () => bootstrap);
for(const name of ['maisaka.glb','maisaka-hi.glb']){
  const model=path.join(root,'assets','models',name);
  await fs.writeFile(model+'.gz',gzipSync(await fs.readFile(model),{level:6}));
}
const bytes = Buffer.byteLength(html);
if (bytes > 2 * 1024 * 1024) throw new Error(`Custom HTML ${bytes} bytes exceeds MaiBot 2 MiB limit`);
await fs.writeFile(path.join(root, 'index.html'), html, 'utf8');
console.log(`Built web/index.html: ${bytes} bytes; no runtime CDN or external scripts`);
