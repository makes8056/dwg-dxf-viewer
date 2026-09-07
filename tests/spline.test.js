// tests/spline.test.js — 自由曲線を折れ線に直す係（src/spline.js）のテスト
//
// 動かし方：  node --test
//
// この係は「数を入れて、数が返る」だけなので、画面を出さずに検算できる。
// ここで確かめている値は、司令塔が手で検算したものです。
// 「今そう出るから」ではなく「そうでなければ図面が間違って表示される」値を書いています。

import test from 'node:test';
import assert from 'node:assert/strict';
import { splineToPolyline, MAX_SPLINE_POINTS } from '../src/spline.js';

/** 小数の誤差を許して比べる。 */
const near = (actual, expected, message, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < eps, `${message}（実際は ${actual}、正しくは ${expected}）`);
};

// ============================================================
// いちばん基本：両端を必ず通る
// ============================================================

test('両端で止まる曲線は、最初と最後の制御点をきっちり通る', () => {
  // ここがずれると、つながっているはずの線が図面上で離れて見える
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [10, 30], [30, 30], [40, 0]],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  });
  assert.ok(r, '曲線が作れていない');
  near(r.points[0][0], 0, '始点のX');
  near(r.points[0][1], 0, '始点のY');
  near(r.points.at(-1)[0], 40, '終点のX');
  near(r.points.at(-1)[1], 0, '終点のY');
  assert.equal(r.closed, false);
});

test('曲線は、制御点をつないだ形（凸包）の外へ出ない', () => {
  // 外へ出るのは計算を間違えている証拠。図面では線がはみ出して見える
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [10, 100], [30, 100], [40, 0]],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  });
  for (const [x, y] of r.points) {
    assert.ok(x >= -1e-9 && x <= 40 + 1e-9, `Xが外へ出ている（${x}）`);
    assert.ok(y >= -1e-9 && y <= 100 + 1e-9, `Yが外へ出ている（${y}）`);
  }
  // まん中はふくらんでいる（直線で結んでいないことの確認）
  const まん中 = r.points[Math.floor(r.points.length / 2)];
  assert.ok(まん中[1] > 50, `曲がっていない。直線で結んでいるだけ（Y=${まん中[1]}）`);
});

// ============================================================
// 重み（41）— ここを読み落とすと形が変わる
// ============================================================

test('重み付き（有理）の曲線は、ぴったり円弧になる', () => {
  // 制御点3つ・次数2・まん中の重みを cos45度 にすると、
  // **数学的にぴったり四分円**になる。だから半径で1点ずつ検算できる。
  const r = splineToPolyline({
    degree: 2,
    controlPoints: [[100, 0], [100, 100], [0, 100]],
    knots: [0, 0, 0, 1, 1, 1],
    weights: [1, Math.cos(Math.PI / 4), 1],
  });
  for (const [x, y] of r.points) {
    near(Math.hypot(x, y), 100, '半径100の円の上に乗っていない');
  }
});

test('重みを読み落とすと形が変わることを、テスト自身が確かめる', () => {
  // 上のテストが「重みを見ている」ことの裏取り。
  // 重みを外すと、同じ制御点でも円にはならない。
  const 重みなし = splineToPolyline({
    degree: 2,
    controlPoints: [[100, 0], [100, 100], [0, 100]],
    knots: [0, 0, 0, 1, 1, 1],
  });
  const まん中 = 重みなし.points[Math.floor(重みなし.points.length / 2)];
  const ずれ = Math.abs(Math.hypot(まん中[0], まん中[1]) - 100);
  assert.ok(ずれ > 1, `重みが無くても円になってしまい、上のテストが何も守っていない（ずれ ${ずれ}）`);
});

test('数の合わない重みは、信用せずに無視する', () => {
  // 壊れたDXFで重みが足りないと、落ちるか、でたらめな形になる。どちらも困る
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [10, 30], [30, 30], [40, 0]],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
    weights: [1, 2], // 制御点は4つなのに2つしかない
  });
  assert.ok(r, '落ちてしまっている');
  near(r.points[0][0], 0, '始点のX');
  near(r.points.at(-1)[0], 40, '終点のX');
});

// ============================================================
// ノット（40）が無い・数が合わない
// ============================================================

test('ノットが無くても、自分で目盛りを作って描く', () => {
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [10, 30], [30, 30], [40, 0]],
  });
  assert.ok(r, 'ノットが無いだけで捨ててしまっている');
  near(r.points[0][0], 0, '始点のX');
  near(r.points.at(-1)[0], 40, '終点のX');
});

test('ノットの数が合わなくても、自分で作り直して描く', () => {
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [10, 30], [30, 30], [40, 0]],
    knots: [0, 0, 1, 1], // 本当は 4+3+1=8 個 必要
  });
  assert.ok(r, 'ノットの数が合わないだけで捨ててしまっている');
  near(r.points[0][1], 0, '始点のY');
  near(r.points.at(-1)[1], 0, '終点のY');
});

test('制御点が5つ以上でも、内側に目盛りを作って通しで描ける', () => {
  // 内側の目盛りを作り忘れると、区間が1つも無くなって何も出なくなる
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [10, 40], [20, -40], [30, 40], [40, -40], [50, 0]],
  });
  assert.ok(r, '曲線が作れていない');
  assert.ok(r.points.length >= 30, `点が ${r.points.length} 個しかない。区間が作れていない`);
  near(r.points[0][0], 0, '始点のX');
  near(r.points.at(-1)[0], 50, '終点のX');
});

// ============================================================
// 閉じた曲線
// ============================================================

test('周期式（制御点が1周ぶん）の閉じた曲線が、ちゃんと1周する', () => {
  // 1周させないと、輪の一部が欠けたまま出る。
  // 正方形の制御点なら、できる形は上下左右つりあっていなければならない。
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [100, 0], [100, 100], [0, 100]],
    knots: [-3, -2, -1, 0, 1, 2, 3, 4], // 等間隔＝両端が止まっていない
    closed: true,
  });
  assert.ok(r, '閉じた曲線が作れていない');
  assert.equal(r.closed, true);

  const xs = r.points.map((p) => p[0]);
  const ys = r.points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  near(minX, minY, '左端と下端がつりあっていない');
  near(maxX, maxY, '右端と上端がつりあっていない');
  near(minX + maxX, 100, '左右がまん中でつりあっていない');
  near(minY + maxY, 100, '上下がまん中でつりあっていない');
});

test('閉じた曲線に、長さ0の線が1本残らない', () => {
  // 終点が始点と重なったまま closed を立てると、無駄な点が範囲や切り取り判定に混ざる
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [100, 0], [100, 100], [0, 100]],
    knots: [-3, -2, -1, 0, 1, 2, 3, 4],
    closed: true,
  });
  const 先 = r.points[0];
  const 後 = r.points.at(-1);
  assert.ok(Math.hypot(先[0] - 後[0], 先[1] - 後[1]) > 1e-6, '始点と終点が重なったまま残っている');
});

test('クランプ式の閉じた曲線は、1周させ直さない', () => {
  // 制御点の先頭が末尾にも書いてある書き方。もう一度1周させると形が別物になる。
  //
  // 【ここを「はみ出していないか」だけで見てはいけない】
  //   もう一度1周させても、点はぜんぶ制御点の四角の中に収まる（曲線の性質）。
  //   だから範囲を見るだけのテストは、間違いを見逃す（43.6の「ゆるいテスト」）。
  //   クランプ式は**最初の制御点をきっちり通る**ので、そこで見分ける。
  const r = splineToPolyline({
    degree: 2,
    controlPoints: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    knots: [0, 0, 0, 1, 2, 3, 3, 3],
    closed: true,
  });
  assert.ok(r, '曲線が作れていない');
  assert.equal(r.closed, true);

  // クランプ式なら、曲線は最初の制御点そのものから始まる。
  // 誤って1周させると、ここが辺のまん中あたりへずれる
  near(r.points[0][0], 0, '始点のX（1周させ直してしまっている）');
  near(r.points[0][1], 0, '始点のY（1周させ直してしまっている）');

  for (const [x, y] of r.points) {
    assert.ok(x >= -1e-9 && x <= 10 + 1e-9, `Xが制御点の外へ出ている（${x}）`);
    assert.ok(y >= -1e-9 && y <= 10 + 1e-9, `Yが制御点の外へ出ている（${y}）`);
  }
});

// ============================================================
// 安全装置（点の数の上限）
// ============================================================

test('点の数は、必ず上限に収まる', () => {
  // 実務図面は数万本の線がある。細かく分けすぎるとiPadが固まる。
  // 制御点1000個の曲線でも、上限を超えてはいけない。
  const controlPoints = [];
  for (let i = 0; i < 1000; i++) controlPoints.push([i, (i % 2) * 10]);
  const r = splineToPolyline({ degree: 3, controlPoints });
  assert.ok(r, '曲線が作れていない');
  assert.ok(
    r.points.length <= MAX_SPLINE_POINTS,
    `上限 ${MAX_SPLINE_POINTS} を超えて ${r.points.length} 個の点ができている`
  );
  // 上限に当てても、形はちゃんと端から端まである
  near(r.points[0][0], 0, '始点のX');
  near(r.points.at(-1)[0], 999, '終点のX');
});

test('ふつうの大きさの曲線では、上限に当たらない', () => {
  // 上限は安全装置であって、ふだんは当たらないのが正常（38.3(e)と同じ考え）
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [[0, 0], [10, 30], [30, 30], [40, 0]],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  });
  assert.ok(r.points.length < MAX_SPLINE_POINTS / 4, `ふつうの曲線で ${r.points.length} 個は多すぎる`);
  assert.ok(r.points.length >= 8, `${r.points.length} 個ではカクカクに見える`);
});

// ============================================================
// 壊れたもの・描けないもの
// ============================================================

test('制御点も通過点も無いときは、描けないと答える（黙って捨てない）', () => {
  assert.equal(splineToPolyline({ degree: 3, controlPoints: [] }), null);
  assert.equal(splineToPolyline({ degree: 3, controlPoints: [[0, 0]] }), null);
  assert.equal(splineToPolyline({}), null);
  assert.equal(splineToPolyline(null), null);
});

test('制御点が無くても、通過点があればつないで出す', () => {
  // なめらかさは出ないが、何も出ないよりはるかによい
  const r = splineToPolyline({
    degree: 3,
    controlPoints: [],
    fitPoints: [[0, 0], [50, 50], [100, 0]],
  });
  assert.deepEqual(r.points, [[0, 0], [50, 50], [100, 0]]);
});

test('次数が制御点の数を超えていても、落ちずに描く', () => {
  // 壊れたDXFで起きる。落ちると図面ぜんたいが開けなくなる
  const r = splineToPolyline({
    degree: 10,
    controlPoints: [[0, 0], [10, 10], [20, 0]],
  });
  assert.ok(r, '落ちてしまっている');
  near(r.points[0][0], 0, '始点のX');
  near(r.points.at(-1)[0], 20, '終点のX');
});

test('次数1は、制御点をそのまま結んだ折れ線になる', () => {
  const r = splineToPolyline({
    degree: 1,
    controlPoints: [[0, 0], [10, 10], [20, 0]],
  });
  assert.deepEqual(r.points, [[0, 0], [10, 10], [20, 0]]);
});

test('同じ場所が続く点は、まとめて1つにする', () => {
  const r = splineToPolyline({
    degree: 1,
    controlPoints: [[0, 0], [0, 0], [10, 10], [10, 10], [20, 0]],
  });
  assert.deepEqual(r.points, [[0, 0], [10, 10], [20, 0]]);
});

test('全部同じ場所の制御点は、描けないと答える', () => {
  // 点1つになってしまうものを折れ線として出すと、範囲の計算がおかしくなる
  assert.equal(splineToPolyline({ degree: 1, controlPoints: [[5, 5], [5, 5], [5, 5]] }), null);
});
