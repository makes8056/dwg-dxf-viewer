// tests/render.test.js — 描画（src/render.js）のテスト
//
// nodeにはCanvasがないので、**Canvasのふりをする入れ物**を作って、
// 「どんな命令が出されたか」を記録して確かめます。
// 絵そのものは見られませんが、iPadで起きた不具合はこの方法で捕まえられます。

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDrawing } from '../src/render.js';
import { createViewport, fitToBounds } from '../src/viewport.js';

/**
 * Canvasのふりをする入れ物。呼ばれた命令を記録するだけ。
 * @param {number} pixelWidth  キャンバスの実際の点の数（横）
 * @param {number} pixelHeight キャンバスの実際の点の数（縦）
 */
function makeFakeCtx(pixelWidth, pixelHeight) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    canvas: { width: pixelWidth, height: pixelHeight },
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    fillText: record('fillText'),
    translate: record('translate'),
    rotate: record('rotate'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}

const SAMPLE = {
  units: 'mm',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  contentBounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  layers: [],
  entities: [
    { type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: 100, y2: 60 },
    { type: 'line', layer: '0', color: '#000000', x1: 0, y1: 60, x2: 100, y2: 0 },
  ],
  unsupported: { count: 0, kinds: {} },
  source: 'dxf',
};

/** 実際に使われた拡大の倍率（setTransform の1つ目の数）を取り出す。 */
function usedDpr(ctx) {
  const call = ctx.calls.find((c) => c[0] === 'setTransform');
  assert.ok(call, 'setTransform が呼ばれていない');
  return call[1];
}

// ============================================================
// 【iPadで起きた本番不具合】画面が左上4分の1にしか出ない
//
// iPadの画面は細かいので、キャンバスは「見た目 × 2倍」の点数で作られる。
// ここで1倍と決めつけて描くと、2倍の広さに1倍で描くことになり、
// 図面が左上4分の1に縮こまる。実際にお客様のiPadでそうなった。
//
// パソコンの画面は1倍なので、**この不具合はパソコンでは絶対に再現しない。**
// だからこのテストで守る。
// ============================================================

test('倍率を渡さなくても、キャンバスの大きさから正しい倍率を読み取る（iPadの2倍）', () => {
  // 見た目 1000x600、キャンバスは2倍の 2000x1200（iPadと同じ状態）
  const ctx = makeFakeCtx(2000, 1200);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);

  renderDrawing(ctx, SAMPLE, vp, {}); // わざと倍率を渡さない

  assert.equal(usedDpr(ctx), 2, '2倍と読み取れていない（図面が左上4分の1に縮こまる）');
});

test('倍率を渡さなくても正しい倍率を読み取る（iPad Proの3倍）', () => {
  const ctx = makeFakeCtx(3000, 1800);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);
  renderDrawing(ctx, SAMPLE, vp, {});
  assert.equal(usedDpr(ctx), 3);
});

test('パソコン（1倍）はこれまでどおり1倍', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);
  renderDrawing(ctx, SAMPLE, vp, {});
  assert.equal(usedDpr(ctx), 1);
});

test('呼び出す側が倍率を渡したときは、その値を使う', () => {
  const ctx = makeFakeCtx(2000, 1200);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);
  renderDrawing(ctx, SAMPLE, vp, { dpr: 2 });
  assert.equal(usedDpr(ctx), 2);
});

test('キャンバスの大きさがまだ決まっていなくても落ちない', () => {
  const ctx = makeFakeCtx(0, 0);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);
  renderDrawing(ctx, SAMPLE, vp, {});
  assert.equal(usedDpr(ctx), 1, '判断できないときは1倍にする');
});

test('背景は、見た目の大きさいっぱいに塗る', () => {
  // ここが実際の点の数（2000x1200）で塗られていると、
  // 倍率と二重に掛かって画面からはみ出す。
  const ctx = makeFakeCtx(2000, 1200);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);
  renderDrawing(ctx, SAMPLE, vp, {});
  const fill = ctx.calls.find((c) => c[0] === 'fillRect');
  assert.deepEqual([fill[3], fill[4]], [1000, 600], '背景の大きさが見た目と合っていない');
});

// ============================================================
// ふつうの描画
// ============================================================

test('画面の中にある線は描かれる', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);
  const res = renderDrawing(ctx, SAMPLE, vp, {});
  assert.equal(res.drawn, 2, '2本の線が描かれていない');
  assert.equal(res.skipped, 0);
});

test('画面の外にある図形は描かない（実務の図面で固まらないため）', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, SAMPLE.bounds);
  const drawing = {
    ...SAMPLE,
    entities: [
      ...SAMPLE.entities,
      { type: 'line', layer: '0', color: '#000', x1: 1e6, y1: 1e6, x2: 1e6 + 10, y2: 1e6 },
    ],
  };
  const res = renderDrawing(ctx, drawing, vp, {});
  assert.equal(res.drawn, 2);
  assert.equal(res.skipped, 1, '画面の外の図形を省いていない');
});

test('図形が無くても落ちない', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  const res = renderDrawing(ctx, { ...SAMPLE, entities: [] }, vp, {});
  assert.deepEqual(res, { drawn: 0, skipped: 0 });
});

test('小さすぎて読めない文字は描かない', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100000, maxY: 60000 });
  const drawing = {
    ...SAMPLE,
    entities: [{ type: 'text', layer: '0', color: '#000', x: 0, y: 0, height: 0.01, rotation: 0, text: 'あ' }],
  };
  const res = renderDrawing(ctx, drawing, vp, {});
  assert.equal(res.drawn, 0, '読めない大きさの文字を描いている');
});

test('文字のそろえ方（中央ぞろえなど）が描画に反映される', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'text', layer: '0', color: '#000', x: 50, y: 30, height: 10,
        rotation: 0, text: '250', hAlign: 'center', vAlign: 'middle' },
    ],
  };
  renderDrawing(ctx, drawing, vp, {});
  assert.equal(ctx.textAlign, 'center', '中央ぞろえが反映されていない');
  assert.equal(ctx.textBaseline, 'middle', '上下の中央が反映されていない');
});

test('そろえ方の指定が無い文字は、これまでどおり左端・下端', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'text', layer: '0', color: '#000', x: 50, y: 30, height: 10, rotation: 0, text: 'あ' },
    ],
  };
  renderDrawing(ctx, drawing, vp, {});
  assert.equal(ctx.textAlign, 'left');
  assert.equal(ctx.textBaseline, 'alphabetic');
});
