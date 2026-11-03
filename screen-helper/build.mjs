// Bundles src/panel.js (with the Anthropic SDK) into panel.js and zips the extension.
// Usage: npm i esbuild @anthropic-ai/sdk && node build.mjs [node_modules dir]
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'src/panel.js')], outfile: path.join(here, 'panel.js'),
  bundle: true, minify: true, format: 'iife', target: 'chrome114', legalComments: 'none',
  nodePaths: [path.resolve(process.argv[2] || path.join(here, 'node_modules'))],
});
console.log('wrote panel.js');
