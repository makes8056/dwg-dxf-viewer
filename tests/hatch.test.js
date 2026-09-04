// tests/hatch.test.js — ハッチングを線に直す計算のテスト（開発ルール38章）
//
// ぜんぶ「数を入れて、数が返る」だけの関数なので、画面が無くても試せる。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_HATCH_LINES,
  arcPoints,
  ellipseArcPoints,
  bulgePoints,
  polygonsBounds,
  clipLineByPolygons,
  applyDashes,
  hatchToLines,
} from '../src/hatch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 0,0 から w,h までの四角。 */
const 四角 = (w = 100, h = 100) => [[[0, 0], [w, 0], [w, h], [0, h]]];

/** 45度・間隔10の斜線（ANSI31と同じ考え方）。 */
const 斜線 = [{ angleDeg: 45, baseX: 0, baseY: 0, offsetAlong: 0, offsetAcross: 10, dashes: [] }];

// ============================================================
// 線を切り取る（内と外の見分け）
// ============================================================

test('四角を横切る線が、四角の中だけ残る', () => {
  const spans = clipLineByPolygons({ x: -50, y: 50 }, { x: 1, y: 0 }, 四角());
  assert.equal(spans.length, 1, '中に入っている区間が1つでない');
  assert.ok(Math.abs(spans[0][0] - 50) < 1e-9, `はじまりが違う（${spans[0][0]}）`);
  assert.ok(Math.abs(spans[0][1] - 150) < 1e-9, `おわりが違う（${spans[0][1]}）`);
});

test('穴のあいた形（ドーナツ）では、穴の中を飛ばす', () => {
  // 【ハッチングでいちばん大事なところ】
  // 外の四角と、中の小さな四角。中は「穴」なので、斜線を引いてはいけない。
  const ドーナツ = [
    [[0, 0], [100, 0], [100, 100], [0, 100]],
    [[40, 40], [60, 40], [60, 60], [40, 60]],
  ];
  const spans = clipLineByPolygons({ x: -50, y: 50 }, { x: 1, y: 0 }, ドーナツ);
  assert.equal(spans.length, 2, '穴が抜けていない');
  assert.ok(Math.abs(spans[0][1] - 90) < 1e-9, '穴の手前で切れていない');
  assert.ok(Math.abs(spans[1][0] - 110) < 1e-9, '穴の向こうから始まっていない');
});

test('四角に当たらない線は、何も残らない', () => {
  const spans = clipLineByPolygons({ x: -50, y: 500 }, { x: 1, y: 0 }, 四角());
  assert.equal(spans.length, 0, '外の線が残っている');
});

test('頂点をちょうど通っても、数え間違えない', () => {
  // ここを間違えると、線が二重になったり消えたりする
  const spans = clipLineByPolygons({ x: -50, y: 0 }, { x: 1, y: 0 }, 四角());
  assert.ok(spans.length <= 1, `頂点の上で区間が ${spans.length} 個できている`);
});

// ============================================================
// 模様の線を作る
// ============================================================

test('斜線が、指定した角度と間隔で作られる', () => {
  const lines = hatchToLines(四角(), 斜線);
  assert.ok(lines.length >= 10, `斜線が ${lines.length} 本しかない`);
  for (const [x1, y1, x2, y2] of lines) {
    const 角度 = ((((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI) % 180) + 180) % 180;
    assert.ok(Math.abs(角度 - 45) < 1e-6, `角度が45度でない（${角度}）`);
  }
  // 直角方向の間隔
  const 角 = (Math.PI * 3) / 4;
  const 距離 = lines.map(([x, y]) => x * Math.cos(角) + y * Math.sin(角)).sort((a, b) => a - b);
  for (let i = 1; i < 距離.length; i++) {
    assert.ok(Math.abs(距離[i] - 距離[i - 1] - 10) < 1e-6, '間隔が10になっていない');
  }
});

test('斜線が、囲いの外へはみ出さない', () => {
  const lines = hatchToLines(四角(), 斜線);
  for (const [x1, y1, x2, y2] of lines) {
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      assert.ok(
        x >= -1e-6 && x <= 100 + 1e-6 && y >= -1e-6 && y <= 100 + 1e-6,
        `はみ出している（${x}, ${y}）`
      );
    }
  }
});

test('基準の点が遠くにあっても、正しい場所に線が出る', () => {
  // 実物の図面では、基準の点が図形から1万以上離れていた。
  // 基準から順に数えると、いつまでも囲いにたどり着かない
  const 遠い基準 = [{ angleDeg: 45, baseX: 13005.89, baseY: 16693.63, offsetAlong: 0, offsetAcross: 10, dashes: [] }];
  const lines = hatchToLines(四角(), 遠い基準);
  assert.ok(lines.length >= 10, `斜線が ${lines.length} 本しかない。基準が遠いと出なくなっている`);
});

test('間隔が0の模様では、線を作らない', () => {
  // 間隔0は「線を無限に並べろ」という意味になってしまう。
  // 何も作らないのが正しい（0本なら、少なくとも図面は壊れない）
  const だめな模様 = [{ angleDeg: 45, baseX: 0, baseY: 0, offsetAlong: 0, offsetAcross: 0, dashes: [] }];
  const lines = hatchToLines(四角(), だめな模様);
  assert.equal(lines.length, 0);
});

test('線が増えすぎても、上限で止まる（安全装置）', () => {
  // 壊れた図面で何十万本もの線ができると、iPadが止まってしまう
  const こまかい = [{ angleDeg: 45, baseX: 0, baseY: 0, offsetAlong: 0, offsetAcross: 0.01, dashes: [] }];
  const lines = hatchToLines(四角(10000, 10000), こまかい);
  assert.ok(lines.length <= MAX_HATCH_LINES, `上限を超えている（${lines.length}）`);
  assert.ok(MAX_HATCH_LINES <= 10000, '上限がゆるすぎる');
});

test('模様が無いときは、線を作らない', () => {
  assert.deepEqual(hatchToLines(四角(), []), []);
  assert.deepEqual(hatchToLines([], 斜線), []);
});

// ============================================================
// 破線の模様
// ============================================================

test('破線の模様は、描くところと空けるところに分かれる', () => {
  // 正の数＝描く、負の数＝あける。
  // 長さ10の区間に「2描いて3あける」を当てると、0〜2 と 5〜7 が描かれる
  assert.deepEqual(applyDashes([0, 10], [2, -3]), [[0, 2], [5, 7]]);
  // 「5描いて5あける」なら、0〜5 だけ
  assert.deepEqual(applyDashes([0, 10], [5, -5]), [[0, 5]]);
});

test('破線でも、区間の外へはみ出さない', () => {
  for (const 模様 of [[2, -3], [1, -1], [7, -2], [0.5, -0.5]]) {
    for (const [a, b] of applyDashes([3, 13], 模様)) {
      assert.ok(a >= 3 - 1e-9 && b <= 13 + 1e-9, `はみ出している（${a}〜${b}／模様${模様}）`);
      assert.ok(b > a, '長さが0以下の区間がある');
    }
  }
});

test('破線の指定が無いときは、区間をそのまま返す', () => {
  assert.deepEqual(applyDashes([3, 8], []), [[3, 8]]);
  assert.deepEqual(applyDashes([3, 8], null), [[3, 8]]);
});

// ============================================================
// 囲いの形（円弧・楕円弧・ふくらみ）
// ============================================================

test('円弧が、半径のとおりの点になる', () => {
  const pts = arcPoints(10, 20, 5, 0, 90, true);
  assert.ok(pts.length >= 3);
  for (const [x, y] of pts) {
    assert.ok(Math.abs(Math.hypot(x - 10, y - 20) - 5) < 1e-9, '円の上に乗っていない');
  }
  assert.ok(Math.abs(pts[0][0] - 15) < 1e-9 && Math.abs(pts[0][1] - 20) < 1e-9, '始まりが0度でない');
});

test('楕円弧が、長い軸と短い軸のとおりになる', () => {
  // 中心(0,0)、長い軸は右へ10、短い軸はその半分
  const pts = ellipseArcPoints(0, 0, 10, 0, 0.5, 0, 360, true);
  const maxX = Math.max(...pts.map((p) => Math.abs(p[0])));
  const maxY = Math.max(...pts.map((p) => Math.abs(p[1])));
  assert.ok(Math.abs(maxX - 10) < 0.1, `長い軸が10でない（${maxX}）`);
  assert.ok(Math.abs(maxY - 5) < 0.1, `短い軸が5でない（${maxY}）`);
});

test('ふくらみ（bulge）が、円弧の点になる', () => {
  // ふくらみ1＝半円
  const pts = bulgePoints(0, 0, 10, 0, 1);
  assert.ok(pts.length >= 3, '点が足りない');
  assert.ok(Math.abs(pts[0][0]) < 1e-9 && Math.abs(pts[0][1]) < 1e-9, '始まりの点が違う');
  // 半円なので、途中で中心から半径5だけ離れる
  const 離れ = pts.map(([x, y]) => Math.hypot(x - 5, y - 0));
  for (const r of 離れ) assert.ok(Math.abs(r - 5) < 1e-6, `半径が5でない（${r}）`);
});

// ============================================================
// つなぎ方
// ============================================================

test('ハッチングは、ふつうの線に直して図面に入れる（図形の種類を増やさない）', () => {
  // 種類を増やすと、画面・PDF・範囲の計算…と直す場所が一気に増える
  const src = read('src/dxf-parse.js');
  assert.match(src, /function convertHatch/, 'ハッチングの変換が無い');
  assert.match(src, /hatchToLines\(/, '線に直していない');
  const drawing = read('src/drawing.js');
  assert.ok(!/'hatch'/.test(drawing), 'ハッチングを新しい図形の種類にしてしまっている');
});

test('模様の角度と間隔は、そのままの値を使う（重ねて掛けない）', () => {
  // HATCHに入っている模様の数字は、すでに拡大率と回転を掛けたあとの値。
  // コード52（角度）や41（拡大率）を重ねて掛けると、模様が壊れる
  const src = read('src/dxf-parse.js');
  const i = src.indexOf('function parseHatchGroups');
  assert.ok(i >= 0, 'ハッチングの読み取りが無い');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.ok(!/52|41/.test(body.replace(/\/\/.*$/gm, '')), '角度や拡大率を重ねて掛けている');
});
