#!/usr/bin/env node
/**
 * Serves a built copy of the web app the way a locked-down host does, to see what a visitor there sees:
 * a content security policy that allows only the page's own files (no image from Scryfall's CDN, no outside request),
 * and — with --no-range — no answer to a request for part of a file.
 *
 *   node tools/dev/serve-hosted.cjs DIR [--port 5310] [--no-range] [--open]
 *
 * `--open` drops the policy, to compare with an ordinary host.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? '.');
const port = Number(args[args.indexOf('--port') + 1]) || 5310;
const ranges = !args.includes('--no-range');
const policy = args.includes('--open')
  ? null
  : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; worker-src blob: 'self'";
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.html': 'text/html', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    const size = fs.statSync(file).size;
    const head = { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...(policy ? { 'content-security-policy': policy } : {}) };
    const m = ranges ? /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '') : null;
    if (m) {
      const start = Number(m[1]);
      const end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1);
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'content-length': size });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}${policy ? ' (own files only' + (ranges ? '' : ', whole files only') + ')' : ''}`));
