// tests/drawing.test.js — 図形データの決まりごと（src/drawing.js）のテスト
//
// 動かし方：  node --test tests/
// node に最初から入っているテスト機能だけを使う（npmは使わない。開発ルール9.1）。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aciToCss,
  rgbToCss,
  computeBounds,
  normalizeAngle,
  padBounds,
  createDrawing,
  countUnsupported,
  finishDrawing,
} from '../src/drawing.js';

// ------------------------------------------------------------
// 色の変換
// ------------------------------------------------------------

test('色番号7（CADの白）は黒になる。白背景で線が消えないため', () => {
  assert.equal(aciToCss(7), '#000000');
});

test('色番号255（白）も黒になる', () => {
  assert.equal(aciToCss(255), '#000000');
});

test('色番号1（赤）はそのまま赤のまま残る', () => {
  assert.equal(aciToCss(1), '#ff0000');
});

test('明るすぎる色（黄・水色）は、白背景で見えるまで暗くなる', () => {
  // 黄 #ffff00 と 水色 #00ffff は、そのままだと白い紙の上でほぼ見えない
  assert.notEqual(aciToCss(2), '#ffff00');
  assert.notEqual(aciToCss(4), '#00ffff');
});

test('色番号10〜249も必ず色文字列を返す（穴を作らない）', () => {
  for (let i = 10; i <= 249; i++) {
    assert.match(aciToCss(i), /^#[0-9a-f]{6}$/, `色番号 ${i} が色文字列になっていない`);
  }
});

test('おかしな色番号でも落ちずに黒を返す', () => {
  assert.equal(aciToCss(undefined), '#000000');
  assert.equal(aciToCss(NaN), '#000000');
  assert.equal(aciToCss(-1), '#000000');
});

test('24ビットの色指定も色文字列になる', () => {
  assert.equal(rgbToCss(0xff0000), '#ff0000');
  assert.match(rgbToCss(0xffffff), /^#[0-9a-f]{6}$/);
});

// ------------------------------------------------------------
// 図面の範囲（bounds）
// ------------------------------------------------------------

test('図形が無いときの範囲は null', () => {
  assert.equal(computeBounds([]), null);
});

test('直線の範囲', () => {
  const b = computeBounds([{ type: 'line', x1: 0, y1: 0, x2: 100, y2: 50 }]);
  assert.deepEqual(b, { minX: 0, minY: 0, maxX: 100, maxY: 50 });
});

test('折れ線の範囲', () => {
  const b = computeBounds([
    { type: 'polyline', points: [[10, 20], [-5, 40], [30, 0]], closed: false },
  ]);
  assert.deepEqual(b, { minX: -5, minY: 0, maxX: 30, maxY: 40 });
});

test('円の範囲は中心から半径ぶん', () => {
  const b = computeBounds([{ type: 'circle', cx: 10, cy: 10, r: 5 }]);
  assert.deepEqual(b, { minX: 5, minY: 5, maxX: 15, maxY: 15 });
});

test('円弧の範囲は、円まるごとではなく実際に通る部分だけ', () => {
  // 0度から90度の円弧。右上の4分の1だけなので (0,0)-(10,10) が正しい。
  // ここを円まるごと (-10,-10)-(10,10) で計算すると、
  // 図面が実際の半分の大きさで表示されてしまう。
  const b = computeBounds([
    { type: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: 90 },
  ]);
  assert.ok(Math.abs(b.minX - 0) < 1e-9, `minX が 0 でない: ${b.minX}`);
  assert.ok(Math.abs(b.minY - 0) < 1e-9, `minY が 0 でない: ${b.minY}`);
  assert.ok(Math.abs(b.maxX - 10) < 1e-9, `maxX が 10 でない: ${b.maxX}`);
  assert.ok(Math.abs(b.maxY - 10) < 1e-9, `maxY が 10 でない: ${b.maxY}`);
});

test('0度をまたぐ円弧（270度→90度）の範囲', () => {
  // 右半分を通る円弧。右端(10,0)と上下端に届く。
  const b = computeBounds([
    { type: 'arc', cx: 0, cy: 0, r: 10, startAngle: 270, endAngle: 90 },
  ]);
  assert.ok(Math.abs(b.maxX - 10) < 1e-9, `右端に届いていない: ${b.maxX}`);
  assert.ok(Math.abs(b.minY + 10) < 1e-9, `下端に届いていない: ${b.minY}`);
  assert.ok(Math.abs(b.maxY - 10) < 1e-9, `上端に届いていない: ${b.maxY}`);
  assert.ok(b.minX >= -1e-9, `左へはみ出している: ${b.minX}`);
});

test('数値でない座標が混ざっても範囲がこわれない', () => {
  const b = computeBounds([
    { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 },
    { type: 'line', x1: NaN, y1: 0, x2: undefined, y2: 10 },
  ]);
  assert.deepEqual(b, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
});

test('複数の図形をまとめた範囲', () => {
  const b = computeBounds([
    { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 },
    { type: 'circle', cx: 100, cy: 100, r: 5 },
  ]);
  assert.deepEqual(b, { minX: 0, minY: 0, maxX: 105, maxY: 105 });
});

// ------------------------------------------------------------
// 角度と余白
// ------------------------------------------------------------

test('角度は0〜360度に直る', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.equal(normalizeAngle(370), 10);
  assert.equal(normalizeAngle(-90), 270);
});

test('余白を足すと範囲が広がる', () => {
  const p = padBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0.1);
  assert.deepEqual(p, { minX: -10, minY: -10, maxX: 110, maxY: 110 });
});

test('線1本だけ（幅か高さが0）の図面でも余白が付く', () => {
  // ここが0のままだと、あとで「幅で割る」計算が無限大になり画面が真っ白になる
  const p = padBounds({ minX: 0, minY: 50, maxX: 100, maxY: 50 }, 0.1);
  assert.ok(p.maxY > p.minY, '高さが0のままになっている');
});

test('範囲が null なら余白も null', () => {
  assert.equal(padBounds(null), null);
});

// ------------------------------------------------------------
// 図形データの入れ物
// ------------------------------------------------------------

test('からっぽの図形データが作れる', () => {
  const d = createDrawing('dxf');
  assert.equal(d.source, 'dxf');
  assert.equal(d.units, 'mm');
  assert.deepEqual(d.entities, []);
  assert.equal(d.unsupported.count, 0);
});

test('表示できなかった図形は種類ごとに数えられる（黙って捨てない）', () => {
  const d = createDrawing('dxf');
  countUnsupported(d, 'SPLINE');
  countUnsupported(d, 'SPLINE');
  countUnsupported(d, 'HATCH');
  assert.equal(d.unsupported.count, 3);
  assert.equal(d.unsupported.kinds.SPLINE, 2);
  assert.equal(d.unsupported.kinds.HATCH, 1);
});

test('仕上げをすると範囲が入る', () => {
  const d = createDrawing('dxf');
  d.entities.push({ type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: 5, y2: 5 });
  finishDrawing(d);
  assert.deepEqual(d.bounds, { minX: 0, minY: 0, maxX: 5, maxY: 5 });
});
