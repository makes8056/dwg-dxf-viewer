// tests/render.test.js — 描画（src/render.js）のテスト
//
// nodeにはCanvasがないので、**Canvasのふりをする入れ物**を作って、
// 「どんな命令が出されたか」を記録して確かめます。
// 絵そのものは見られませんが、iPadで起きた不具合はこの方法で捕まえられます。

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDrawing } from '../src/render.js';
import { createViewport, fitToBounds } from '../src/viewport.js';
import { CAP_HEIGHT_RATIO } from '../src/drawing.js';

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
    fill: record('fill'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    ellipse: record('ellipse'),
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

// ============================================================
// 文字の大きさ（48章）
//
// 【実物の図面で判明】CADの「文字の高さ」は**大文字そのものの高さ**だが、
// Canvasの font に渡す数値は**文字枠ぜんたい（em）**の大きさである。
// そのまま渡すと、文字が3割ちかく小さく、しかも下に寄って出る。
// 俵型マークの中の記号が中心から外れ、図面番号が小さく出ていた。
// ============================================================

test('文字は、CADの「大文字の高さ」どおりの大きさで描かれる', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'text', layer: '0', color: '#000', x: 50, y: 30, height: 10, rotation: 0, text: 'A89-7' },
    ],
  };
  renderDrawing(ctx, drawing, vp, {});

  const 大文字px = 10 * vp.scale;
  const 出た = Number(String(ctx.font).replace('px sans-serif', ''));
  assert.ok(出た > 0, `font が設定されていない: ${JSON.stringify(ctx.font)}`);
  // 文字枠は、大文字の高さより必ず大きい（そのまま渡していたら同じ値になる）
  assert.ok(
    出た > 大文字px * 1.15,
    `文字枠の大きさをそのまま渡している（大文字 ${大文字px} に対して ${出た}）`
  );
  // 割り戻すと、大文字の高さが指定どおりになること
  assert.ok(
    Math.abs(出た * CAP_HEIGHT_RATIO - 大文字px) < 1e-9,
    `大文字の高さが ${出た * CAP_HEIGHT_RATIO} になっており、指定の ${大文字px} と合わない`
  );
});

test('読めない大きさかどうかは、大文字の高さで決める（文字枠の大きさで決めない）', () => {
  // 【境目でしか分からない】読めるかどうかの目安は5px。
  // 大文字の高さ4pxの文字は読めないので描かない。
  // ところが文字枠の大きさで判断すると 4 ÷ 0.72 ＝ 5.6px となり、
  // **読めない文字まで描いてしまう。** 画面が黒くつぶれるもとになる。
  //
  // ふつうの大きさの文字で試すと、どちらで判断しても同じ結果になり、
  // 取り違えを見逃す（開発ルール47.6と同じ「見分けのつく見本を選ぶ」話）。
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });

  const 文字 = (大文字px) => ({
    ...SAMPLE,
    entities: [{
      type: 'text', layer: '0', color: '#000',
      x: 50, y: 30, height: 大文字px / vp.scale, rotation: 0, text: 'あ',
    }],
  });

  assert.equal(
    renderDrawing(makeFakeCtx(1000, 600), 文字(4), vp, {}).drawn, 0,
    '大文字の高さ4pxは読めないのに描いている（文字枠の大きさで判断していないか）'
  );
  assert.equal(
    renderDrawing(makeFakeCtx(1000, 600), 文字(6), vp, {}).drawn, 1,
    '大文字の高さ6pxは読めるのに描いていない'
  );
});

test('楕円が描かれる', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'ellipse', layer: '0', color: '#000', cx: 50, cy: 30,
        rx: 20, ry: 10, rotation: 0, startAngle: 0, endAngle: 360 },
    ],
  };
  const res = renderDrawing(ctx, drawing, vp, {});
  assert.equal(res.drawn, 1, '楕円が描かれていない');
  assert.ok(ctx.calls.some((c) => c[0] === 'ellipse'), '楕円を描く命令が出ていない');
});

test('大きさが0の楕円は描かない（落ちない）', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'ellipse', layer: '0', color: '#000', cx: 50, cy: 30,
        rx: 0, ry: 0, rotation: 0, startAngle: 0, endAngle: 360 },
    ],
  };
  const res = renderDrawing(ctx, drawing, vp, {});
  assert.equal(res.drawn, 0);
});

test('ぐるっと一周する楕円が、ちゃんと一周ぶん描かれる', () => {
  // 角度は0〜360度に直してあるので、一周の楕円は「0度→0度」になる。
  // そのまま描くと長さ0の弧になり、**何も描かれない**。
  // 実物の図面には一周の楕円が100個以上あるので、ここは必ず要る。
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'ellipse', layer: '0', color: '#000', cx: 50, cy: 30,
        rx: 20, ry: 10, rotation: 0, startAngle: 0, endAngle: 0 },
    ],
  };
  const res = renderDrawing(ctx, drawing, vp, {});
  assert.equal(res.drawn, 1, '一周の楕円が描かれていない');

  const call = ctx.calls.find((c) => c[0] === 'ellipse');
  assert.ok(call, '楕円を描く命令が出ていない');
  const startRad = call[6];
  const endRad = call[7];
  const sweep = Math.abs(endRad - startRad);
  assert.ok(
    Math.abs(sweep - Math.PI * 2) < 1e-9,
    `一周ぶん描いていない（実際の回り幅は ${sweep} ラジアン、正しくは ${Math.PI * 2}）`
  );
});

test('部分的な楕円（C字）は、その範囲だけ描く', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      // 実物の図面にあった値：305度から235度まで（290度ぶん。70度あいている）
      { type: 'ellipse', layer: '0', color: '#000', cx: 50, cy: 30,
        rx: 20, ry: 10, rotation: 90, startAngle: 305, endAngle: 235 },
    ],
  };
  renderDrawing(ctx, drawing, vp, {});
  const call = ctx.calls.find((c) => c[0] === 'ellipse');
  const sweepDeg = (Math.abs(call[7] - call[6]) * 180) / Math.PI;
  assert.ok(
    Math.abs(sweepDeg - 290) < 1e-6,
    `回り幅が290度になっていない（実際は ${sweepDeg}度）`
  );
});

// ============================================================
// 文字の縦位置に、Canvasが知らない名前を渡さない
//
// 【実際に起きた不具合】
// 'baseline' という名前を渡していたが、**Canvasにその名前は存在しない。**
// 存在しない名前を渡すと、ブラウザは黙って無視する。
// 無視されると直前に描いた文字の縦位置がそのまま残り、文字がずれて出る。
// ブラウザの記録に警告が出続けていたが、画面には出ないので気づきにくかった。
// ============================================================

// Canvasが受け付ける縦位置の名前は、この6つだけ
const CANVAS_BASELINES = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];

test('文字の縦位置は、必ずCanvasが受け付ける名前になる', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });

  // 'baseline' は存在しない名前。これがそのまま渡ってはいけない。
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'text', layer: '0', color: '#000', x: 50, y: 30, height: 10,
        rotation: 0, text: 'あ', hAlign: 'left', vAlign: 'baseline' },
    ],
  };
  renderDrawing(ctx, drawing, vp, {});
  assert.ok(
    CANVAS_BASELINES.includes(ctx.textBaseline),
    `Canvasが知らない名前を渡している：「${ctx.textBaseline}」。` +
      'ブラウザに無視され、直前の文字の縦位置が残って文字がずれる'
  );
});

test('知らない名前が来ても、いちばん普通の縦位置に落ち着く', () => {
  const ctx = makeFakeCtx(1000, 600);
  const vp = createViewport(1000, 600);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const drawing = {
    ...SAMPLE,
    entities: [
      { type: 'text', layer: '0', color: '#000', x: 50, y: 30, height: 10,
        rotation: 0, text: 'あ', vAlign: 'なにこれ' },
    ],
  };
  renderDrawing(ctx, drawing, vp, {});
  assert.equal(ctx.textBaseline, 'alphabetic');
});

test('中央ぞろえ（寸法の数字）は、そのまま中央のまま', () => {
  // 直しすぎて、寸法の数字の位置まで変えてしまわないことの確認
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
  assert.equal(ctx.textBaseline, 'middle');
  assert.equal(ctx.textAlign, 'center');
});

// ============================================================
// 点（POINT）（開発ルール38章）
// ============================================================

test('点は、小さな丸として塗られる', () => {
  // CADは $PDMODE が 0 のとき、点を小さな丸で表示する
  const ctx = makeFakeCtx(400, 300);
  const vp = createViewport(400, 300);
  fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
  const drawing = {
    units: 'mm', bounds: null, layers: [],
    entities: [{ type: 'point', layer: '0', color: '#ff0000', x: 50, y: 50 }],
    unsupported: { count: 0, kinds: {} }, source: 'dxf',
  };
  const { drawn } = renderDrawing(ctx, drawing, vp, { dpr: 1 });
  assert.equal(drawn, 1, '点が描かれていない');
  const 丸 = ctx.calls.filter((c) => c[0] === 'arc');
  assert.equal(丸.length, 1, '丸を描いていない');
  assert.ok(丸[0][3] > 0, `丸の大きさが0以下（${丸[0][3]}）`);
  assert.ok(ctx.calls.some((c) => c[0] === 'fill'), '塗っていない（線だけでは見えない）');
});

test('点の大きさは、線の太さに合わせて変わる', () => {
  // 画面でも紙でも、ちょうどよい大きさになるようにするため
  const 半径 = (lineWidth) => {
    const ctx = makeFakeCtx(400, 300);
    const vp = createViewport(400, 300);
    fitToBounds(vp, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    renderDrawing(ctx, {
      units: 'mm', bounds: null, layers: [],
      entities: [{ type: 'point', layer: '0', color: '#000000', x: 50, y: 50 }],
      unsupported: { count: 0, kinds: {} }, source: 'dxf',
    }, vp, { dpr: 1, lineWidth });
    return ctx.calls.find((c) => c[0] === 'arc')[3];
  };
  assert.ok(半径(4) > 半径(1), '線を太くしても点の大きさが変わらない');
});

// ============================================================
// 白黒で表示する（開発ルール53章）
//
// お客様の図面は、配管が画層（レイヤ）ごと赤で描かれている。
// 白黒プリンターでは赤が薄い灰色になって読みにくいので、黒一色にできるようにした。
// ============================================================

/** 線や文字を描いたときの色を、順番に記録するCanvasのふり。 */
function makeColorRecordingCtx(pixelWidth, pixelHeight) {
  const ctx = makeFakeCtx(pixelWidth, pixelHeight);
  const 使った色 = [];
  const もとのstroke = ctx.stroke;
  const もとのfill = ctx.fill;
  const もとのfillText = ctx.fillText;
  ctx.stroke = (...a) => { 使った色.push(ctx.strokeStyle); もとのstroke(...a); };
  ctx.fill = (...a) => { 使った色.push(ctx.fillStyle); もとのfill(...a); };
  ctx.fillText = (...a) => { 使った色.push(ctx.fillStyle); もとのfillText(...a); };
  ctx.使った色 = 使った色;
  return ctx;
}

const 色つきの図面 = {
  units: 'mm',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  contentBounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  layers: [],
  entities: [
    { type: 'line', layer: 'PIPE', color: '#ff0000', x1: 0, y1: 0, x2: 100, y2: 60 },
    { type: 'arc', layer: 'PIPE', color: '#ff0000', cx: 50, cy: 30, r: 10, startAngle: 0, endAngle: 350 },
    { type: 'circle', layer: 'PIPE', color: '#ff0000', cx: 20, cy: 20, r: 5 },
    { type: 'ellipse', layer: 'PIPE', color: '#ff0000', cx: 70, cy: 20, rx: 8, ry: 4, rotation: 0, startAngle: 0, endAngle: 360 },
    { type: 'polyline', layer: 'PIPE', color: '#ff0000', points: [[0, 0], [10, 10]], closed: false },
    { type: 'point', layer: 'PIPE', color: '#ff0000', x: 30, y: 30 },
    { type: 'text', layer: 'PIPE', color: '#ff0000', x: 10, y: 40, height: 8, rotation: 0, text: 'A' },
  ],
  unsupported: { count: 0, kinds: {} },
  source: 'dxf',
};

test('白黒にしないときは、赤い配管が赤いまま出る', () => {
  const ctx = makeColorRecordingCtx(800, 480);
  const vp = createViewport(800, 480);
  fitToBounds(vp, 色つきの図面.bounds);

  renderDrawing(ctx, 色つきの図面, vp, { dpr: 1 });

  assert.ok(ctx.使った色.length >= 7, '図形が描かれていない');
  assert.ok(ctx.使った色.every((c) => c === '#ff0000'), `赤以外が混ざった: ${ctx.使った色.join()}`);
});

test('白黒にすると、7種類ぜんぶが黒で描かれる', () => {
  // 種類を1つでも通し忘れると、**その種類だけ色が残る。**
  // 実物の図面には線も円弧も楕円も文字もあるので、まとめて確かめる。
  const ctx = makeColorRecordingCtx(800, 480);
  const vp = createViewport(800, 480);
  fitToBounds(vp, 色つきの図面.bounds);

  renderDrawing(ctx, 色つきの図面, vp, { dpr: 1, monochrome: true });

  assert.equal(ctx.使った色.length, 7, '描かれた図形の数が合わない');
  assert.ok(ctx.使った色.every((c) => c === '#000000'), `黒でないものがある: ${ctx.使った色.join()}`);
});

test('白黒にしても、書き足した文字は選んだ色のまま出る', () => {
  const 図面 = {
    ...色つきの図面,
    entities: [
      { type: 'line', layer: 'PIPE', color: '#ff0000', x1: 0, y1: 0, x2: 100, y2: 60 },
      { type: 'text', layer: '__書き足した文字__', color: '#c81e1e', isNote: true,
        x: 10, y: 40, height: 8, rotation: 0, text: 'ここ直す' },
    ],
  };
  const ctx = makeColorRecordingCtx(800, 480);
  const vp = createViewport(800, 480);
  fitToBounds(vp, 図面.bounds);

  renderDrawing(ctx, 図面, vp, { dpr: 1, monochrome: true });

  assert.deepEqual(ctx.使った色, ['#000000', '#c81e1e']);
});
