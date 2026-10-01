/**
 * A tiny static server for the compose page: marketing/ on disk (fonts,
 * recorded clips, menu screenshots) plus the page's bundle from esbuild.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { build } from 'esbuild';
import { MARKETING } from '../capture/director';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export async function serveCompose(): Promise<{ url: string; close: () => Promise<void> }> {
  const bundle = await build({
    entryPoints: [join(MARKETING, 'compose', 'page.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    write: false,
  });
  const js = bundle.outputFiles[0].contents;
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === '/bundle.js') {
      res.writeHead(200, { 'content-type': TYPES['.js'] });
      res.end(js);
      return;
    }
    const rel = path === '/' ? 'compose/index.html' : normalize(path).replace(/^\/+/, '');
    const file = join(MARKETING, rel);
    if (!file.startsWith(MARKETING) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(() => r())) };
}
