// tools/serve.mjs — 開発中に実機・ブラウザで確かめるための、ごく小さなWebサーバー
//
// npmを使わない決まり（開発ルール2章）なので、Nodeの標準機能だけで書いてあります。
// 本番の配布には使いません（GitHub Pagesで配ります）。
//
//   node tools/serve.mjs        → http://localhost:8123
//   node tools/serve.mjs 3000   → ポート番号を変える

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8123;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.dxf': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);

    // 上の階層へ抜け出すのを防ぐ
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('見つかりません');
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`確認用サーバー: http://localhost:${PORT}`);
  });
