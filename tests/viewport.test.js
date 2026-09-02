// tests/viewport.test.js — 座標の変換と、拡大縮小・移動の状態（src/viewport.js）のテスト
//
// nodeにはCanvasが無いので、ここでは「座標の計算」だけを守る。
// 動かし方：  node --test
// node に最初から入っているテスト機能だけを使う（npmは使わない。開発ルール9.1）。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewport,
  setSize,
  fitToBounds,
  toScreen,
  toDrawing,
  panBy,
  zoomAt,
  visibleBounds,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/viewport.js';

// ------------------------------------------------------------
// 図面座標 ⇔ 画面座標の往復
// ------------------------------------------------------------

test('toScreen → toDrawing で元の図面座標に戻る', () => {
  const vp = createViewport(800, 600);
  vp.scale = 3.2;
  vp.offsetX = -17;
  vp.offsetY = 250;

  const cases = [[0, 0], [100, -50], [-30.5, 12.25], [999999, -999999]];
  for (const [x, y] of cases) {
    const [sx, sy] = toScreen(vp, x, y);
    const [bx, by] = toDrawing(vp, sx, sy);
    assert.ok(Math.abs(bx - x) < 1e-9, `Xが戻らない: ${x} → ${bx}`);
    assert.ok(Math.abs(by - y) < 1e-9, `Yが戻らない: ${y} → ${by}`);
  }
});

test('toDrawing → toScreen で元の画面座標に戻る', () => {
  const vp = createViewport(1024, 768);
  vp.scale = 0.75;
  vp.offsetX = 40;
  vp.offsetY = -10;

  const cases = [[0, 0], [1024, 768], [512.5, 300]];
  for (const [sx, sy] of cases) {
    const [x, y] = toDrawing(vp, sx, sy);
    const [bsx, bsy] = toScreen(vp, x, y);
    assert.ok(Math.abs(bsx - sx) < 1e-9, `画面Xが戻らない: ${sx} → ${bsx}`);
    assert.ok(Math.abs(bsy - sy) < 1e-9, `画面Yが戻らない: ${sy} → ${bsy}`);
  }
});

// ------------------------------------------------------------
// Y軸の向き（開発ルール10.6）：CADは上向き、Canvasは下向き
// ------------------------------------------------------------

test('図面で上（Yが大きい）ものは、画面でも上（syが小さい）に出る', () => {
  const vp = createViewport(800, 600);
  vp.scale = 1;
  vp.offsetX = 0;
  vp.offsetY = 600; // 画面の上端が図面のY=600

  const [, syTop] = toScreen(vp, 0, 500);   // 図面で上の方
  const [, syBottom] = toScreen(vp, 0, 100); // 図面で下の方
  assert.ok(syTop < syBottom, 'Y軸が反転していない（図面の上が画面の下に出ている）');
});

test('図面のXが増えると、画面のsxも増える（Xは反転しない）', () => {
  const vp = createViewport(800, 600);
  const [sxLeft] = toScreen(vp, 10, 0);
  const [sxRight] = toScreen(vp, 200, 0);
  assert.ok(sxLeft < sxRight, 'X軸まで反転してしまっている');
});

// ------------------------------------------------------------
// zoomAt：指定した画面の点が動かない（ピンチの中心がすっ飛ばない）
// ------------------------------------------------------------

test('zoomAt で指定した画面の点は、拡大しても同じ画面位置を指し続ける', () => {
  const vp = createViewport(800, 600);
  vp.scale = 2;
  vp.offsetX = 10;
  vp.offsetY = 300;

  const sx = 320;
  const sy = 180;
  const [drawBefore] = [toDrawing(vp, sx, sy)];

  zoomAt(vp, sx, sy, 2.5); // 2.5倍に拡大

  const drawAfter = toDrawing(vp, sx, sy);
  assert.ok(Math.abs(drawBefore[0] - drawAfter[0]) < 1e-9, 'ピンチの中心のXがずれた');
  assert.ok(Math.abs(drawBefore[1] - drawAfter[1]) < 1e-9, 'ピンチの中心のYがずれた');
});

test('zoomAt で縮小しても、指定した画面の点は動かない', () => {
  const vp = createViewport(800, 600);
  vp.scale = 5;
  vp.offsetX = -100;
  vp.offsetY = 50;

  const sx = 40;
  const sy = 550;
  const before = toDrawing(vp, sx, sy);
  zoomAt(vp, sx, sy, 0.3);
  const after = toDrawing(vp, sx, sy);

  assert.ok(Math.abs(before[0] - after[0]) < 1e-9);
  assert.ok(Math.abs(before[1] - after[1]) < 1e-9);
});

// ------------------------------------------------------------
// 拡大縮小の上限・下限
// ------------------------------------------------------------

test('拡大しすぎても上限（MAX_SCALE）で止まる', () => {
  const vp = createViewport(800, 600);
  vp.scale = 1;
  zoomAt(vp, 400, 300, 1e12); // ばかでかい倍率
  assert.ok(vp.scale <= MAX_SCALE, `上限を超えた: ${vp.scale}`);
  assert.ok(Number.isFinite(vp.scale), '無限大やNaNになった');
});

test('縮小しすぎても下限（MIN_SCALE）で止まる', () => {
  const vp = createViewport(800, 600);
  vp.scale = 1;
  zoomAt(vp, 400, 300, 1e-12); // ものすごく小さい倍率
  assert.ok(vp.scale >= MIN_SCALE, `下限を下回った: ${vp.scale}`);
  assert.ok(vp.scale > 0, '0以下になった');
});

test('上限に張り付いた後で拡大しても、それ以上は大きくならない', () => {
  const vp = createViewport(800, 600);
  vp.scale = MAX_SCALE;
  zoomAt(vp, 100, 100, 100);
  assert.equal(vp.scale, MAX_SCALE);
});

// ------------------------------------------------------------
// fitToBounds：図面全体が画面に収まる
// ------------------------------------------------------------

test('fitToBounds で、図面の四隅が画面の外に出ない', () => {
  const vp = createViewport(800, 600);
  const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 500 };
  fitToBounds(vp, bounds);

  const corners = [
    [bounds.minX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
  ];
  for (const [x, y] of corners) {
    const [sx, sy] = toScreen(vp, x, y);
    assert.ok(sx >= -1e-6 && sx <= vp.width + 1e-6, `画面の外にはみ出た(x): ${sx}`);
    assert.ok(sy >= -1e-6 && sy <= vp.height + 1e-6, `画面の外にはみ出た(y): ${sy}`);
  }
});

test('fitToBounds で、図面が小さくなりすぎない（画面の大部分を使う）', () => {
  const vp = createViewport(1000, 800);
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 40 }; // 横長の図面
  fitToBounds(vp, bounds);

  const [sxMin, syMin] = toScreen(vp, bounds.minX, bounds.maxY); // 左上
  const [sxMax, syMax] = toScreen(vp, bounds.maxX, bounds.minY); // 右下
  const usedWidth = sxMax - sxMin;
  const usedHeight = syMax - syMin;

  // 横長の図面を1000x800の画面に収めるので、幅いっぱい（90%以上）は使うはず
  assert.ok(usedWidth > vp.width * 0.9, `画面をほとんど使えていない: ${usedWidth}`);
  assert.ok(usedHeight > 0, '高さが0になっている');
});

test('fitToBounds は bounds が null でも落ちない', () => {
  const vp = createViewport(800, 600);
  assert.doesNotThrow(() => fitToBounds(vp, null));
});

test('fitToBounds は 幅か高さが0の図面（線1本）でも落ちない・つぶれない', () => {
  const vp = createViewport(800, 600);
  fitToBounds(vp, { minX: 0, minY: 50, maxX: 100, maxY: 50 }); // 高さ0
  assert.ok(Number.isFinite(vp.scale) && vp.scale > 0, '高さ0の図面でscaleが壊れた');

  const [sx1, sy1] = toScreen(vp, 0, 50);
  const [sx2, sy2] = toScreen(vp, 100, 50);
  assert.ok(Number.isFinite(sx1) && Number.isFinite(sy1));
  assert.ok(Number.isFinite(sx2) && Number.isFinite(sy2));
});

// ------------------------------------------------------------
// setSize：大きさが変わっても中心を保つ
// ------------------------------------------------------------

test('setSize しても、画面中心に映っていた図面の場所は中心のまま', () => {
  const vp = createViewport(800, 600);
  vp.scale = 2;
  vp.offsetX = 5;
  vp.offsetY = 400;

  const centerBefore = toDrawing(vp, vp.width / 2, vp.height / 2);
  setSize(vp, 600, 800); // 画面回転を想定（縦横入れ替え）
  const centerAfter = toDrawing(vp, vp.width / 2, vp.height / 2);

  assert.ok(Math.abs(centerBefore[0] - centerAfter[0]) < 1e-9, '中心のXがずれた');
  assert.ok(Math.abs(centerBefore[1] - centerAfter[1]) < 1e-9, '中心のYがずれた');
});

// ------------------------------------------------------------
// panBy：往復すれば元に戻る
// ------------------------------------------------------------

test('panBy で動かした分、逆向きに動かせば元の位置に戻る', () => {
  const vp = createViewport(800, 600);
  vp.scale = 1.5;
  const before = { offsetX: vp.offsetX, offsetY: vp.offsetY };

  panBy(vp, 120, -40);
  panBy(vp, -120, 40);

  assert.ok(Math.abs(vp.offsetX - before.offsetX) < 1e-9);
  assert.ok(Math.abs(vp.offsetY - before.offsetY) < 1e-9);
});

// ------------------------------------------------------------
// visibleBounds
// ------------------------------------------------------------

test('visibleBounds は画面の四隅を図面座標にした範囲を返す', () => {
  const vp = createViewport(800, 600);
  vp.scale = 2;
  vp.offsetX = 0;
  vp.offsetY = 600;

  const vb = visibleBounds(vp);
  // 画面全体 800x600、scale=2 なので、図面上では 400x300 が見えているはず
  assert.ok(Math.abs((vb.maxX - vb.minX) - 400) < 1e-9, `幅が合わない: ${vb.maxX - vb.minX}`);
  assert.ok(Math.abs((vb.maxY - vb.minY) - 300) < 1e-9, `高さが合わない: ${vb.maxY - vb.minY}`);
});
