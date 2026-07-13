#!/usr/bin/env node
// Copy the built ESM runtime (index + worker + shared chunks) from dist/ into
// site/lib/cam2qr/ so the live demo on cam2qr.com serves the library same-origin.
// Same-origin matters: the scanner spawns a module Web Worker via
// `new URL('./worker.js', import.meta.url)`, and cross-origin module workers are
// blocked, which would silently drop decoding back onto the main thread.
//
//   pnpm build && node scripts/sync-site-lib.mjs

import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const target = join(root, 'site', 'lib', 'cam2qr');

const wanted = (name) =>
  /^(index|worker|chunk-[A-Z0-9]+)\.js(\.map)?$/.test(name);

let distFiles;
try {
  distFiles = (await readdir(dist)).filter(wanted);
} catch {
  console.error('dist/ not found — run `pnpm build` first.');
  process.exit(1);
}
if (!distFiles.some((f) => f.startsWith('index.')) || !distFiles.some((f) => f.startsWith('worker.'))) {
  console.error('dist/ is missing index.js or worker.js — run `pnpm build` first.');
  process.exit(1);
}

// Rebuild the directory from scratch so stale content-hashed chunks disappear.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of distFiles.sort()) {
  await copyFile(join(dist, name), join(target, name));
  console.log(`site/lib/cam2qr/${name}`);
}
