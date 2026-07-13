#!/usr/bin/env node
// Serve the static site/ directory locally. Zero dependencies — uses Node's http/fs.
//
//   node scripts/serve-site.mjs [--port 5184] [--host 127.0.0.1] [--open]
//
// Extension-less paths resolve to `<path>.html` then `<path>/index.html`, so
// /how-it-works serves site/how-it-works.html.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(flag('--port', process.env.PORT ?? '5184'));
const host = flag('--host', '127.0.0.1');
const open = args.includes('--open');

const root = resolve(fileURLToPath(new URL('../site', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// Resolve a URL pathname to a file inside root, guarding against path traversal.
async function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const rel = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  let target = join(root, rel);
  if (target !== root && !target.startsWith(root + sep)) return null;

  const candidates = [];
  if (decoded.endsWith('/')) {
    candidates.push(join(target, 'index.html'));
  } else {
    candidates.push(target);
    if (!extname(target)) {
      candidates.push(`${target}.html`, join(target, 'index.html'));
    }
  }

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {}
  }
  return null;
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }

  const file = await resolveFile(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1>');
    console.log(`${method} ${req.url} -> 404`);
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(method === 'HEAD' ? undefined : body);
    console.log(`${method} ${req.url} -> 200`);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
    console.error(`${method} ${req.url} -> 500`, err);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try: node scripts/serve-site.mjs --port ${port + 1}`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`Serving site/ at ${url}`);
  if (open) {
    const cmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    import('node:child_process').then(({ spawn }) => {
      spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    });
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
