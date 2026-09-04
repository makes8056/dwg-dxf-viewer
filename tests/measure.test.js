// tests/measure.test.js — 長さを測る計算のテスト（開発ルール39章）
//
// 【なぜ「吸い付き」が要るのか】
// 指で正確な位置をタップするのは無理である。1ミリずれれば、測った長さも1ミリ狂う。
// それでは現場で使えないので、近くの「線の端・真ん中・円の中心」へ吸い付かせる。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SNAP_RADIUS_PX,
  insunitsToUnits,
  unitLabel,
  formatLength,
  formatAngle,
  measureBetween,
  forEachSnapPoint,
  findSnapPoint,
} from '../src/measure.js';
import { parseDxf } from '../src/dxf-parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = (name) => read(path.join('tests', 'fixtures', name));

const 集める = (e) => {
  const out = [];
  forEachSnapPoint(e, (x, y, kind) => out.push({ x, y, kind }));
  return out;
};

// ============================================================
// 吸い付く先
// ============================================================

test('線は、両端と真ん中に吸い付く', () => {
  const pts = 集める({ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 });
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map((p) => [p.x, p.y]), [[0, 0], [100, 0], [50, 0]]);
  assert.deepEqual(pts.map((p) => p.kind), ['端', '端', '真ん中']);
});

test('円は、中心と上下左右に吸い付く', () => {
  const pts = 集める({ type: 'circle', cx: 10, cy: 20, r: 5 });
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], { x: 10, y: 20, kind: '中心' });
  const 円周 = pts.slice(1).map((p) => [p.x, p.y]);
  assert.deepEqual(円周, [[15, 20], [5, 20], [10, 25], [10, 15]]);
});

test('円弧は、中心と両端に吸い付く', () => {
  const pts = 集める({ type: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: 90 });
  assert.equal(pts.length, 3);
  assert.deepEqual(pts[0], { x: 0, y: 0, kind: '中心' });
  assert.ok(Math.abs(pts[1].x - 10) < 1e-9 && Math.abs(pts[1].y) < 1e-9, '0度の端が違う');
  assert.ok(Math.abs(pts[2].x) < 1e-9 && Math.abs(pts[2].y - 10) < 1e-9, '90度の端が違う');
});

test('折れ線は、すべての角に吸い付く', () => {
  const pts = 集める({ type: 'polyline', points: [[0, 0], [10, 0], [10, 10]] });
  assert.equal(pts.length, 3);
  assert.ok(pts.every((p) => p.kind === '角'));
});

test('点は、その点に吸い付く', () => {
  const pts = 集める({ type: 'point', x: 3, y: 4 });
  assert.deepEqual(pts, [{ x: 3, y: 4, kind: '点' }]);
});

test('文字には吸い付かない（形が無いため）', () => {
  assert.deepEqual(集める({ type: 'text', x: 0, y: 0, height: 10, text: 'あ' }), []);
});

// ============================================================
// いちばん近い点をさがす
// ============================================================

const 図形 = [
  { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 100, y2: 0 },
  { type: 'circle', layer: '0', color: '#000', cx: 200, cy: 0, r: 20 },
];

test('少しずれてタップしても、線の端に吸い付く', () => {
  // 【これが無いと現場で使えない】指の誤差がそのまま長さの誤差になる
  const p = findSnapPoint(図形, 3, -4, 20);
  assert.deepEqual([p.x, p.y], [0, 0]);
  assert.equal(p.kind, '端');
});

test('いちばん近い点が選ばれる', () => {
  // 真ん中（50,0）のほうが近い場所をタップする
  const p = findSnapPoint(図形, 48, 2, 20);
  assert.deepEqual([p.x, p.y], [50, 0]);
  assert.equal(p.kind, '真ん中');
});

test('吸い付く範囲に2つ以上あるときも、いちばん近いほうが選ばれる', () => {
  // 【ここを「最初に見つけたもの」にすると、狙っていない点に吸い付く】
  // 配管の継ぎ目のように、点が近くに集まっているところで必ず起きる
  const 二つ = [
    { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: -50, y2: 0 },
    { type: 'line', layer: '0', color: '#000', x1: 10, y1: 0, x2: 60, y2: 0 },
  ];
  // (9,0) は (10,0) に1、(0,0) に9 の近さ。どちらも範囲20の中にある
  const p = findSnapPoint(二つ, 9, 0, 20);
  assert.deepEqual([p.x, p.y], [10, 0], '遠いほうに吸い付いている');

  // 逆向きでも同じ（並び順に左右されないこと）
  const q = findSnapPoint(二つ, 1, 0, 20);
  assert.deepEqual([q.x, q.y], [0, 0], '並び順で結果が変わっている');
});

test('近くに何も無ければ、吸い付かない（null を返す）', () => {
  assert.equal(findSnapPoint(図形, 1000, 1000, 20), null);
});

test('吸い付く範囲を超えたら、吸い付かない', () => {
  assert.equal(findSnapPoint(図形, 0, 30, 20), null, '範囲の外なのに吸い付いている');
  assert.ok(findSnapPoint(図形, 0, 15, 20), '範囲の中なのに吸い付かない');
});

test('図形がからっぽでも落ちない', () => {
  assert.equal(findSnapPoint([], 0, 0, 20), null);
  assert.equal(findSnapPoint(null, 0, 0, 20), null);
  assert.equal(findSnapPoint(図形, 0, 0, 0), null, '範囲0で吸い付いている');
});

// ============================================================
// 長さと向き
// ============================================================

test('2点の間の長さと向きが正しい', () => {
  const m = measureBetween({ x: 0, y: 0 }, { x: 3, y: 4 });
  assert.equal(m.distance, 5);
  assert.equal(m.dx, 3);
  assert.equal(m.dy, 4);
  assert.ok(Math.abs(m.angleDeg - 53.130102) < 1e-4);
});

test('45度の向きが、45度と出る', () => {
  // 配管は45度のエルボをよく使うので、ここがずれると困る
  const m = measureBetween({ x: 0, y: 0 }, { x: 100, y: 100 });
  assert.ok(Math.abs(m.angleDeg - 45) < 1e-9);
  assert.equal(formatAngle(m.angleDeg), '45.0°');
});

// ============================================================
// 見せ方
// ============================================================

test('長さは、3桁ごとに区切って読みやすく出す', () => {
  assert.equal(formatLength(1234.56, 'mm'), '1,234.6 mm');
  assert.equal(formatLength(400, 'mm'), '400 mm');
  assert.equal(formatLength(12.345, 'mm'), '12.35 mm');
  assert.equal(formatLength(0, 'mm'), '0 mm');
});

test('単位は、図面の単位に合わせて変わる', () => {
  assert.equal(formatLength(5, 'm'), '5 m');
  assert.equal(formatLength(5, 'cm'), '5 cm');
  assert.equal(unitLabel('inch'), 'インチ');
});

test('おかしな数でも落ちない', () => {
  assert.equal(formatLength(NaN, 'mm'), '—');
  assert.equal(formatLength(Infinity, 'mm'), '—');
  assert.equal(formatAngle(NaN), '—');
});

// ============================================================
// 図面の単位（$INSUNITS）
// ============================================================

test('図面の単位を、DXFのヘッダーから読む', () => {
  assert.equal(insunitsToUnits(4), 'mm');
  assert.equal(insunitsToUnits(5), 'cm');
  assert.equal(insunitsToUnits(6), 'm');
  assert.equal(insunitsToUnits(1), 'inch');
});

test('単位が書いていない図面は、ミリとみなす', () => {
  // 日本の建築・設備の図面はミリで描くのがふつう。実物の図面も4（ミリ）だった
  assert.equal(insunitsToUnits(0), 'mm');
  assert.equal(insunitsToUnits(undefined), 'mm');
  assert.equal(insunitsToUnits(999), 'mm');
});

test('読み込んだ図面に、単位が入っている', () => {
  const d = parseDxf(fixture('point.dxf'));
  assert.ok(['mm', 'cm', 'm', 'inch', 'feet'].includes(d.units), `単位が変（${d.units}）`);
});

// ============================================================
// つなぎ方
// ============================================================

test('吸い付く範囲は、指で押せる大きさ', () => {
  // 手袋をした指でも狙えるように（開発ルール11章）
  assert.ok(SNAP_RADIUS_PX >= 24, `吸い付く範囲が ${SNAP_RADIUS_PX}px しかない`);
});

test('吸い付く範囲は、拡大率で割ってから使う', () => {
  // 画面の34ピクセルが、図面の上で何ミリになるかは拡大率で変わる。
  // ここを間違えると、拡大しても細かく狙えない（または広すぎて別の点に吸い付く）
  const app = read('src/ui/app.js');
  assert.match(app, /SNAP_RADIUS_PX \/ \(vp\.scale/, '拡大率で割っていない');
});

test('測る画面は、指を通す（図面の拡大縮小を邪魔しない）', () => {
  // 【32章・33章で作った拡大縮小を、作り直さないための決まり】
  // 板をかぶせて指を全部受け取ると、拡大縮小をもう一度作ることになる
  const css = read('src/ui/measure-ui.css');
  const i = css.indexOf('.ms-root');
  const body = css.slice(i, css.indexOf('}', i));
  assert.match(body, /pointer-events:\s*none/, '指を通していない。図面が動かせなくなる');
});

test('図面を動かしたら、測った印も置き直す', () => {
  // ここを忘れると、印だけ取り残されて別の場所を測ったように見える
  const app = read('src/ui/app.js');
  const i = app.indexOf('function redraw()');
  assert.ok(i >= 0, '描き直しが見つからない');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(body, /measureUi\.refresh\(\)/, '印を置き直していない');
});

test('測る画面と、範囲を囲む画面は同時に出さない', () => {
  const app = read('src/ui/app.js');
  assert.match(app, /if \(printUi\.isActive\(\)\) printUi\.stop\(\)/, '囲む画面を閉じていない');
  assert.match(app, /if \(measureUi\.isActive\(\)\) measureUi\.stop\(\)/, '測る画面を閉じていない');
});

test('どこに吸い付いたかを、画面に出す', () => {
  // 縮小したまま測ると吸い付く範囲が図面の上ではとても広くなり、
  // 狙っていない点に吸い付いても気づけない（39.4）
  const ui = read('src/ui/measure-ui.js');
  assert.match(ui, /合わせた先/, '何に合わせたかを出していない');
});

test('測った線は、紙には印刷しない', () => {
  const css = read('src/ui/measure-ui.css');
  assert.match(
    css,
    /@media\s+print\s*\{[\s\S]*?\.ms-root[\s\S]*?display\s*:\s*none/,
    '測った印が紙に印刷されてしまう'
  );
});
