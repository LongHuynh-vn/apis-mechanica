// Assemble the static site. This edition has no bundler: the browser loads the ES modules as written,
// with three.js resolved through the import map in index.html (./node_modules/three/…).
// So "building" means copying the page, its modules, and ONLY the three.js files they actually import.
//
//   node scripts/build.mjs [--outDir <dir>]        (default: ./dist)
import { cp, copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const at = args.indexOf('--outDir');
const OUT = resolve(at >= 0 && args[at + 1] ? args[at + 1] : join(ROOT, 'dist'));
const THREE = join(ROOT, 'node_modules', 'three');

if (OUT === ROOT || ROOT.startsWith(OUT + sep)) throw new Error(`refusing to build into ${OUT}: it contains the source`);
if (!existsSync(join(THREE, 'package.json'))) throw new Error('three.js is not installed — run `npm ci` first');

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;
const specifiersIn = async (file) => [...(await readFile(file, 'utf8')).matchAll(SPECIFIER)].map((m) => m[1]);

/** Map a bare three specifier to a file inside node_modules/three (null if it is not three). */
function threeFile(spec) {
  if (spec === 'three') return join(THREE, 'build', 'three.module.js');
  if (spec === 'three/webgpu') return join(THREE, 'build', 'three.webgpu.js');
  if (spec === 'three/tsl') return join(THREE, 'build', 'three.tsl.js');
  if (spec.startsWith('three/addons/')) return join(THREE, 'examples', 'jsm', spec.slice('three/addons/'.length));
  return null;
}

async function walk(dir, skip = () => false, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skip(path)) continue;
    if (entry.isDirectory()) await walk(path, skip, out); else out.push(path);
  }
  return out;
}

// 1 · the page and its own modules (the dev harness pages stay out of the published site)
const DEV = join(ROOT, 'src', 'dev');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await copyFile(join(ROOT, 'index.html'), join(OUT, 'index.html'));
await cp(join(ROOT, 'src'), join(OUT, 'src'), { recursive: true, filter: (src) => src !== DEV && !src.startsWith(DEV + sep) });

// 2 · three.js: follow imports from our modules, then each three file's own relative imports
const queue = [];
for (const file of (await walk(join(ROOT, 'src'), (p) => p === DEV)).filter((f) => f.endsWith('.js'))) {
  for (const spec of await specifiersIn(file)) { const f = threeFile(spec); if (f) queue.push(f); }
}
const seen = new Set();
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!existsSync(file)) throw new Error(`three.js file not found: ${relative(ROOT, file)}`);
  const dest = join(OUT, relative(ROOT, file));
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(file, dest);
  for (const spec of await specifiersIn(file)) {
    if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
    else { const f = threeFile(spec); if (f) queue.push(f); }
  }
}
await copyFile(join(THREE, 'LICENSE'), join(OUT, 'node_modules', 'three', 'LICENSE'));

const files = await walk(OUT);
console.log(`built ${relative(process.cwd(), OUT) || '.'} — ${files.length} files, ${seen.size} from three.js`);
