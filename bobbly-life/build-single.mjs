// Builds bobbly-life.html: the whole game (three.js, PeerJS, CSS, all modules) in one file.
// Usage: npm i esbuild three@0.160.0 peerjs@1.5.4 && node build-single.mjs [node_modules dir]
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = path.resolve(process.argv[2] || path.join(here, 'node_modules'));

const js = await build({
  entryPoints: [path.join(here, 'js/main.js')],
  bundle: true, minify: true, format: 'esm', write: false, target: 'es2022',
  nodePaths: [nm], legalComments: 'none',
});
const peer = fs.readFileSync(path.join(nm, 'peerjs/dist/peerjs.min.js'), 'utf8');
const css = fs.readFileSync(path.join(here, 'style.css'), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

let html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="style\.css[^"]*">/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/peerjs[^"]*"><\/script>/, () => `<script>${safe(peer)}</script>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/, () => `<script type="module">${safe(js.outputFiles[0].text)}</script>`);
if (/src="js\/|importmap|href="style/.test(html)) throw new Error('something was not inlined');
fs.writeFileSync(path.join(here, 'bobbly-life.html'), html);
console.log('wrote bobbly-life.html', Math.round(html.length / 1024) + ' KB');
