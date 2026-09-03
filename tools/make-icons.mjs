// tools/make-icons.mjs — アプリのアイコン（icons/icon-192.png・icons/icon-512.png）を作るスクリプト
//
// 開発ルール1.1「npm・ビルド・フレームワークは使わない」を守るため、
// 画像を作る部品（Canvas等）にもnpmライブラリを使わない。
// PNGファイルのバイト列を、Node標準の zlib（圧縮）だけを使って自分で組み立てる。
//
// 【開発ルール6.4】このスクリプトは、何回動かしても同じPNGができる（決め打ちの値だけで描く。
// 乱数・現在時刻を一切使わない）。中身を直したら手でPNGを直さず、必ずこのスクリプトを動かし直すこと。
//
// 動かし方： node tools/make-icons.mjs
// （このフォルダーの一番上で実行する）

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------
// 色（見た目は凝らない。現場で見分けがつけば十分：白地・青い枠・図面らしい線）
// ------------------------------------------------------------
const WHITE = [255, 255, 255, 255];
const BLUE = [21, 86, 183, 255];   // 枠の青
const NAVY = [30, 41, 59, 255];    // 図面の線（黒に近い紺）

// ------------------------------------------------------------
// 極めて簡単な2Dピクセル描画（Canvasを使わないための自前の道具）
// ------------------------------------------------------------
function makeCanvas(size) {
  const px = new Uint8Array(size * size * 4);
  // 全面を白で塗る
  for (let i = 0; i < px.length; i += 4) {
    px[i] = WHITE[0]; px[i + 1] = WHITE[1]; px[i + 2] = WHITE[2]; px[i + 3] = WHITE[3];
  }
  function setPixel(x, y, color) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = color[3];
  }
  // 太さ付きの直線（ブレゼンハムの直線を、太さの分だけ並行にずらして重ね描きする）
  function drawLine(x0, y0, x1, y1, color, thickness) {
    const half = thickness / 2;
    // 線の向きに垂直な方向へ、half の範囲でずらして何本も描く（簡易的な太い線）
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // 垂直方向の単位ベクトル
    const steps = Math.max(1, Math.ceil(thickness));
    for (let s = 0; s <= steps; s++) {
      const off = -half + (thickness * s) / steps;
      bresenham(x0 + nx * off, y0 + ny * off, x1 + nx * off, y1 + ny * off, color);
    }
  }
  function bresenham(x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      setPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function drawRectOutline(x, y, w, h, color, thickness) {
    drawLine(x, y, x + w, y, color, thickness);
    drawLine(x + w, y, x + w, y + h, color, thickness);
    drawLine(x + w, y + h, x, y + h, color, thickness);
    drawLine(x, y + h, x, y, color, thickness);
  }
  return { size, px, setPixel, drawLine, drawRectOutline };
}

// ------------------------------------------------------------
// アイコンの絵柄：白地に、青い枠（図面用紙のふち）と、図面らしい線を数本
// ------------------------------------------------------------
function drawIcon(size) {
  const c = makeCanvas(size);

  // 1) 青い枠（図面用紙のふち）
  const frameMargin = size * 0.09;
  const frameThickness = Math.max(2, size * 0.035);
  c.drawRectOutline(frameMargin, frameMargin, size - frameMargin * 2, size - frameMargin * 2, BLUE, frameThickness);

  // 2) 図面らしい線その1：部屋の外形のような四角
  const roomX = size * 0.28;
  const roomY = size * 0.24;
  const roomW = size * 0.44;
  const roomH = size * 0.34;
  const lineThickness = Math.max(1.5, size * 0.018);
  c.drawRectOutline(roomX, roomY, roomW, roomH, NAVY, lineThickness);

  // 3) 図面らしい線その2：屋根のような斜め線（三角の頂点）
  c.drawLine(roomX, roomY, roomX + roomW / 2, roomY - size * 0.12, NAVY, lineThickness);
  c.drawLine(roomX + roomW / 2, roomY - size * 0.12, roomX + roomW, roomY, NAVY, lineThickness);

  // 4) 図面らしい線その3：寸法線のような、長さの違う横線を数本
  const dimY0 = roomY + roomH + size * 0.10;
  const dimLines = [
    { x: roomX, w: roomW * 0.85 },
    { x: roomX, w: roomW * 0.55 },
    { x: roomX, w: roomW * 0.25 },
  ];
  dimLines.forEach((d, i) => {
    const y = dimY0 + i * size * 0.075;
    c.drawLine(d.x, y, d.x + d.w, y, NAVY, lineThickness);
  });

  return c.px;
}

// ------------------------------------------------------------
// PNGファイルの組み立て（外部ライブラリを使わず、バイト列を直接書き出す）
// ------------------------------------------------------------
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32（PNG仕様に載っている標準の計算方法。ライブラリではなく仕様どおりの実装）
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);       // 幅
  ihdr.writeUInt32BE(size, 4);       // 高さ
  ihdr.writeUInt8(8, 8);             // ビット深度
  ihdr.writeUInt8(6, 9);             // 色の種類：6 = RGBA
  ihdr.writeUInt8(0, 10);            // 圧縮方式
  ihdr.writeUInt8(0, 11);            // フィルター方式
  ihdr.writeUInt8(0, 12);            // インターレースなし

  // 各行の先頭にフィルタータイプ（0=そのまま）を付けて連結する
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // フィルタータイプ0
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// rgbaはUint8Arrayなので、Bufferとして扱えるようにする
function toBuffer(uint8) {
  return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
}

// ------------------------------------------------------------
// 実行
// ------------------------------------------------------------
const iconsDir = path.join(ROOT, 'icons');
mkdirSync(iconsDir, { recursive: true });

for (const size of [192, 512]) {
  const pixels = drawIcon(size);
  const png = encodePNG(size, toBuffer(pixels));
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`作成しました: ${outPath}（${png.length} バイト）`);
}
