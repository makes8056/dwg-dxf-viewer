// tests/print-area.test.js — 印刷用の絵作り（src/print-area.js）のテスト
//
// nodeにはCanvasが無いので、tests/render.test.js と同じ手で
// 「Canvasのふりをする入れ物」を作り、呼ばれた命令を記録して確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePrintSize,
  renderPrintCanvas,
  createPrintImage,
  isAreaBigEnough,
} from '../src/print-area.js';

// ============================================================
// Canvasのふりをする入れ物（tests/render.test.js と同じ作り方）
// ============================================================

/** ctx（描く先）のふり。呼ばれた命令をすべて記録するだけ。 */
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
    rect: record('rect'),
    clip: record('clip'),
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

/**
 * canvas（Canvas要素）のふり。getContext と toDataURL を持つ。
 * @param {number} width
 * @param {number} height
 * @param {object} [opts] { toDataURL, noToDataURL }
 */
function makeFakeCanvas(width, height, opts = {}) {
  const ctx = makeFakeCtx(width, height);
  const canvas = {
    width,
    height,
    ctx, // テストから覗けるように
    getContext: () => ctx,
  };
  if (opts.noToDataURL) {
    // toDataURL 自体が無い（Canvasが壊れている想定）
  } else if (opts.toDataURL) {
    canvas.toDataURL = opts.toDataURL;
  } else {
    canvas.toDataURL = () => `data:image/png;base64,FAKE_${width}x${height}`;
  }
  return canvas;
}

function makeCreateCanvas(store, opts) {
  return (w, h) => {
    const canvas = makeFakeCanvas(w, h, opts);
    store.push(canvas);
    return canvas;
  };
}

const SAMPLE_DRAWING = {
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

// ============================================================
// computePrintSize — 大きさと向きの決め方
// ============================================================

test('横長の範囲は landscape（横向きの紙）になる', () => {
  const size = computePrintSize({ minX: 0, minY: 0, maxX: 100, maxY: 60 });
  assert.equal(size.orientation, 'landscape');
});

test('縦長の範囲は portrait（縦向きの紙）になる', () => {
  const size = computePrintSize({ minX: 0, minY: 0, maxX: 60, maxY: 100 });
  assert.equal(size.orientation, 'portrait');
});

test('ふつうの範囲では上限に当たらず、縮まない（limited が false）', () => {
  // 100mm×60mm 程度の、ごくふつうの大きさの範囲
  const size = computePrintSize({ minX: 0, minY: 0, maxX: 100, maxY: 60 });
  assert.equal(size.limited, false);
  assert.ok(size.widthPx <= 4000);
  assert.ok(size.heightPx <= 4000);
  assert.ok(size.widthPx * size.heightPx <= 12_000_000);
});

test('どんな大きさの範囲でも、紙の上で200dpiになる', () => {
  // 【いちばん大事なテスト】
  // このアプリの印刷は「用紙に合わせて自動で拡大縮小」なので、
  // 絵の大きさは**囲んだ範囲の実寸ではなく、紙の大きさ**から決めなければいけない。
  //
  // 実寸で決めると、100mm×60mm の小さな部分を囲んだとき絵が 787×472点にしかならず、
  // 紙いっぱいに引き伸ばすと **71dpi でぼやける**。
  // 「この部分だけ印刷したい」という、いちばんよくある使い方で困る。
  const 例 = [
    { minX: 0, minY: 0, maxX: 100, maxY: 60 },      // 小さい部分を拡大（よくある）
    { minX: 0, minY: 0, maxX: 800, maxY: 500 },     // 中くらい
    { minX: 0, minY: 0, maxX: 5000, maxY: 3000 },   // 図面まるごと
    { minX: 0, minY: 0, maxX: 300, maxY: 900 },     // 縦長
    { minX: 0, minY: 0, maxX: 500, maxY: 500 },     // 正方形
    { minX: 0, minY: 0, maxX: 500000, maxY: 300000 }, // とても大きい図面
  ];
  for (const area of 例) {
    const size = computePrintSize(area);
    // 絵はA4用紙1枚ぶん（開発ルール29章）。紙ぜんたいの大きさで測る
    const 紙幅mm = size.orientation === 'landscape' ? 297 : 210;
    const 紙高mm = size.orientation === 'landscape' ? 210 : 297;
    const dpi = Math.max(size.widthPx / 紙幅mm, size.heightPx / 紙高mm) * 25.4;
    assert.ok(
      Math.abs(dpi - 200) < 2,
      `紙の上の細かさが200dpiになっていない（${Math.round(dpi)}dpi）。範囲=${JSON.stringify(area)}`
    );
  }
});

test('紙の大きさから決めるので、ふつうは上限に当たらない', () => {
  // 上限（長辺4000点・全体1200万点）は「iPadで落ちないための安全装置」。
  // **当たらないのが正常。** 当たるようなら、大きさの決め方が間違っている。
  const 例 = [
    { minX: 0, minY: 0, maxX: 100, maxY: 60 },
    { minX: 0, minY: 0, maxX: 500, maxY: 500 },
    { minX: 0, minY: 0, maxX: 10000, maxY: 10 },
    { minX: 0, minY: 0, maxX: 500000, maxY: 300000 },
  ];
  for (const area of 例) {
    const size = computePrintSize(area);
    assert.equal(
      size.limited,
      false,
      `上限に当たっている。大きさの決め方がおかしい: ${JSON.stringify(area)}`
    );
    assert.ok(size.widthPx <= 4000 && size.heightPx <= 4000, '長い辺が4000点を超えている');
    assert.ok(size.widthPx * size.heightPx <= 12_000_000, '全体が1200万点を超えている');
  }
});

test('範囲が点のように小さくても（幅・高さが0でも）落ちない', () => {
  const size = computePrintSize({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  assert.ok(size.widthPx >= 1);
  assert.ok(size.heightPx >= 1);
  assert.ok(Number.isFinite(size.widthPx));
  assert.ok(Number.isFinite(size.heightPx));
});

test('印刷する絵は、A4用紙1枚とぴったり同じ形になっている', () => {
  // 【実機で起きた本番不具合（v0.2.2）／開発ルール29章】
  // 前は「囲んだ範囲の形をした絵」を渡していた。A4とは形が違う。
  // iPadのプリント画面はその絵を紙いっぱいに引き伸ばすので、絵が紙からはみ出し、
  // プリンターが印刷できない紙の縁（3〜5mm）で**図面の左右が切れて**出てきた。
  //
  // 絵をA4と同じ形にしておけば、引き伸ばされても位置がずれず、
  // 縁で失われるのは白い余白だけになる。
  const 例 = [
    { minX: 0, minY: 0, maxX: 100, maxY: 60 },
    { minX: 0, minY: 0, maxX: 5000, maxY: 100 },   // 極端に横長
    { minX: 0, minY: 0, maxX: 100, maxY: 5000 },   // 極端に縦長
    { minX: 0, minY: 0, maxX: 500, maxY: 500 },    // 正方形
  ];
  const A4比 = 297 / 210;
  for (const area of 例) {
    const size = computePrintSize(area);
    const 比 = size.orientation === 'landscape'
      ? size.widthPx / size.heightPx
      : size.heightPx / size.widthPx;
    assert.ok(
      Math.abs(比 - A4比) < 0.01,
      `絵の形がA4と違う（${比.toFixed(3)} ≠ ${A4比.toFixed(3)}）。紙の縁で図面が切れる。範囲=${JSON.stringify(area)}`
    );
  }
});

test('図面は、紙の縁から8mm内側にだけ描く（白い余白を残す）', () => {
  // 余白が無いと、プリンターが印刷できない紙の縁に図面がかかって切れる。
  const size = computePrintSize({ minX: 0, minY: 0, maxX: 100, maxY: 60 });
  const 余白px = (size.widthPx - size.innerWidthPx) / 2;
  const 余白mm = 余白px / (200 / 25.4);
  assert.ok(
    余白mm >= 5,
    `余白が ${余白mm.toFixed(1)}mm しかない。プリンターの縁（3〜5mm）で図面が切れる`
  );
  assert.ok(size.innerWidthPx < size.widthPx, '横の余白が無い');
  assert.ok(size.innerHeightPx < size.heightPx, '縦の余白が無い');
});

// ============================================================
// renderPrintCanvas — 実際に描く
// ============================================================

test('renderPrintCanvas は computePrintSize と同じ大きさのキャンバスを作る', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const expected = computePrintSize(area);
  const created = [];
  const result = renderPrintCanvas(SAMPLE_DRAWING, area, {
    createCanvas: makeCreateCanvas(created),
  });
  assert.equal(result.widthPx, expected.widthPx);
  assert.equal(result.heightPx, expected.heightPx);
  assert.equal(created.length, 1);
  assert.equal(created[0].width, expected.widthPx);
  assert.equal(created[0].height, expected.heightPx);
});

test('図面は紙の縁ぎりぎりまで描かれない（実際に描いた線の位置で確かめる）', () => {
  // 【これが「横が切れている」の再発防止テスト（開発ルール29章）】
  // 大きさの計算だけでなく、**本当に描かれた線**が紙の縁から
  // 8mm以上内側に収まっていることを、描画命令の座標で確かめる。
  const PX_PER_MM = 200 / 25.4;
  const 例 = [
    { w: 1000, h: 400 },   // 横長
    { w: 400, h: 1000 },   // 縦長
    { w: 500, h: 500 },    // 正方形
    { w: 5000, h: 100 },   // 極端に横長
  ];
  for (const { w, h } of 例) {
    const drawing = {
      units: 'mm',
      bounds: { minX: 0, minY: 0, maxX: w, maxY: h },
      contentBounds: { minX: 0, minY: 0, maxX: w, maxY: h },
      layers: [],
      entities: [
        { type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: w, y2: 0 },
        { type: 'line', layer: '0', color: '#000000', x1: w, y1: 0, x2: w, y2: h },
        { type: 'line', layer: '0', color: '#000000', x1: w, y1: h, x2: 0, y2: h },
        { type: 'line', layer: '0', color: '#000000', x1: 0, y1: h, x2: 0, y2: 0 },
      ],
      unsupported: { count: 0, kinds: {} },
      source: 'dxf',
    };
    const area = { minX: 0, minY: 0, maxX: w, maxY: h };
    const created = [];
    const r = renderPrintCanvas(drawing, area, { createCanvas: makeCreateCanvas(created) });

    // moveTo / lineTo に渡された座標を全部集める
    const 点 = created[0].ctx.calls
      .filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')
      .map((c) => [c[1], c[2]]);
    assert.ok(点.length > 0, '線が1本も描かれていない');

    const xs = 点.map((p) => p[0]);
    const ys = 点.map((p) => p[1]);
    const 左 = Math.min(...xs) / PX_PER_MM;
    const 右 = (r.widthPx - Math.max(...xs)) / PX_PER_MM;
    const 上 = Math.min(...ys) / PX_PER_MM;
    const 下 = (r.heightPx - Math.max(...ys)) / PX_PER_MM;
    const 最小余白 = Math.min(左, 右, 上, 下);
    assert.ok(
      最小余白 >= 7.5,
      `図面が紙の縁から ${最小余白.toFixed(1)}mm しか離れていない。` +
        `プリンターの縁で切れる。範囲=${w}×${h}`
    );
  }
});

test('紙の余白は広げすぎない（図面が小さく印刷されないように）', () => {
  // 画面用の fitToBounds は5%のすき間を付ける。それをそのまま使うと
  // A4横で左右が20.8mmになり、**紙がもったいない**（実測）。
  // 紙では8mmだけにする。
  const PX_PER_MM = 200 / 25.4;
  const w = 1000;
  const h = 400;
  const drawing = {
    units: 'mm',
    bounds: { minX: 0, minY: 0, maxX: w, maxY: h },
    contentBounds: { minX: 0, minY: 0, maxX: w, maxY: h },
    layers: [],
    entities: [
      { type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: w, y2: 0 },
      { type: 'line', layer: '0', color: '#000000', x1: 0, y1: h, x2: w, y2: h },
    ],
    unsupported: { count: 0, kinds: {} },
    source: 'dxf',
  };
  const created = [];
  const r = renderPrintCanvas(drawing, { minX: 0, minY: 0, maxX: w, maxY: h }, {
    createCanvas: makeCreateCanvas(created),
  });
  const xs = created[0].ctx.calls
    .filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')
    .map((c) => c[1]);
  const 左mm = Math.min(...xs) / PX_PER_MM;
  assert.ok(
    左mm <= 9,
    `左の余白が ${左mm.toFixed(1)}mm もある。図面が必要以上に小さく印刷される`
  );
  void r;
});

test('renderPrintCanvas は図面データから描き直す（drawn が図形の数だけ増える）', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const created = [];
  const result = renderPrintCanvas(SAMPLE_DRAWING, area, {
    createCanvas: makeCreateCanvas(created),
  });
  assert.equal(result.drawn, 2, 'SAMPLE_DRAWING の線2本が描かれていない');
});

test('線の太さは、画面用(1.2)ではなく印刷用に換算した太さで渡される', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const created = [];
  renderPrintCanvas(SAMPLE_DRAWING, area, { createCanvas: makeCreateCanvas(created) });

  const usedLineWidth = created[0].ctx.lineWidth;
  // 200dpiのとき 1mm ≒ 200/25.4 ≒ 7.874点。0.25mm ≒ 1.9685点（およそ2点）
  const expected = (200 / 25.4) * 0.25;

  assert.notEqual(usedLineWidth, 1.2, '画面用の太さ(1.2)のまま渡ってしまっている');
  assert.ok(
    Math.abs(usedLineWidth - expected) < 1e-6,
    `印刷用の太さ(約${expected.toFixed(3)})になっていない: ${usedLineWidth}`
  );
});

test('renderPrintCanvas は dpr:1 で描く（印刷用キャンバスは等倍）', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const created = [];
  renderPrintCanvas(SAMPLE_DRAWING, area, { createCanvas: makeCreateCanvas(created) });
  const setTransformCall = created[0].ctx.calls.find((c) => c[0] === 'setTransform');
  assert.ok(setTransformCall, 'setTransform が呼ばれていない');
  assert.equal(setTransformCall[1], 1, 'dpr が1で渡っていない');
});

test('図形が空の図面でも落ちない（drawn は0）', () => {
  const emptyDrawing = { ...SAMPLE_DRAWING, entities: [] };
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const created = [];
  const result = renderPrintCanvas(emptyDrawing, area, {
    createCanvas: makeCreateCanvas(created),
  });
  assert.equal(result.drawn, 0);
});

// ============================================================
// createPrintImage — 画像（データURL）を作る／失敗の扱い
// ============================================================

test('createPrintImage は成功すると dataUrl を返す', async () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const created = [];
  const result = await createPrintImage(SAMPLE_DRAWING, area, {
    createCanvas: makeCreateCanvas(created),
  });
  assert.ok(result.dataUrl, 'dataUrl が返っていない');
  assert.ok(result.dataUrl.startsWith('data:'));
  assert.equal(result.orientation, 'landscape');
  assert.equal(typeof result.widthPx, 'number');
  assert.equal(typeof result.heightPx, 'number');
  assert.equal(result.limited, false);
});

test('toDataURL が例外を投げても、createPrintImage は例外を投げず日本語のerrorを返す', async () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const created = [];
  const throwingCreateCanvas = makeCreateCanvas(created, {
    toDataURL: () => {
      throw new Error('容量不足（テスト用にわざと起こした失敗）');
    },
  });

  // 例外が外に漏れないことそのものを確認する（await が reject しない）
  const result = await createPrintImage(SAMPLE_DRAWING, area, {
    createCanvas: throwingCreateCanvas,
  });

  assert.equal(typeof result.error, 'string', 'errorが日本語の文字列で返っていない');
  assert.ok(result.error.length > 0);
  assert.ok(/[぀-ヿ一-鿿]/.test(result.error), '日本語になっていない');
});

test('toDataURL が使えない（Canvasが壊れている）ときも例外を投げず日本語のerrorを返す', async () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const created = [];
  const brokenCreateCanvas = makeCreateCanvas(created, { noToDataURL: true });

  const result = await createPrintImage(SAMPLE_DRAWING, area, {
    createCanvas: brokenCreateCanvas,
  });

  assert.equal(typeof result.error, 'string');
});

test('createCanvas 自体が例外を投げても、createPrintImage は例外を投げない', async () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const result = await createPrintImage(SAMPLE_DRAWING, area, {
    createCanvas: () => {
      throw new Error('Canvasを作れない（テスト用にわざと起こした失敗）');
    },
  });
  assert.equal(typeof result.error, 'string');
});

test('図面が無い（null）ときは日本語のerrorを返す', async () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const result = await createPrintImage(null, area, {});
  assert.equal(typeof result.error, 'string');
  assert.ok(/[぀-ヿ一-鿿]/.test(result.error));
});

test('範囲がおかしい（幅も高さも0）ときは日本語のerrorを返す', async () => {
  const result = await createPrintImage(SAMPLE_DRAWING, { minX: 5, minY: 5, maxX: 5, maxY: 5 }, {});
  assert.equal(typeof result.error, 'string');
});

test('範囲が無い（null）ときも例外を投げず日本語のerrorを返す', async () => {
  const result = await createPrintImage(SAMPLE_DRAWING, null, {});
  assert.equal(typeof result.error, 'string');
});

// ============================================================
// isAreaBigEnough — 小さすぎる範囲の判定
// ============================================================

test('短いほうの辺が20ピクセル未満なら、範囲が小さすぎると判定する', () => {
  const result = isAreaBigEnough({ width: 200, height: 19 });
  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  assert.ok(/[぀-ヿ一-鿿]/.test(result.reason), '理由が日本語になっていない');
});

test('短いほうの辺がちょうど20ピクセルなら、範囲は十分な大きさと判定する', () => {
  const result = isAreaBigEnough({ width: 200, height: 20 });
  assert.equal(result.ok, true);
});

test('縦横どちらが短くても判定できる', () => {
  const result = isAreaBigEnough({ width: 10, height: 500 });
  assert.equal(result.ok, false);
});

test('壊れた値（NaNなど）が来ても落ちずに「小さすぎる」扱いにする', () => {
  const result = isAreaBigEnough({ width: NaN, height: 100 });
  assert.equal(result.ok, false);
});
