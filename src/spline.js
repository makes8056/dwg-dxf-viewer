// spline.js — 自由曲線（SPLINE）を、ふつうの折れ線に直す係（開発ルール45章）
//
// 【自由曲線（SPLINE）とは】
//   CADで「なめらかな曲線」を引いたもの。DXFの中では **SPLINE** という種類で入っている。
//   円弧のように半径が一定ではなく、数式（NURBS＝ナーブス）で形が決まる。
//
// 【この係の役目】
//   曲線の式を読み取って、**細かい直線をつないだ折れ線（polyline）に直す**だけ。
//   折れ線に直してしまえば、あとは画面も紙（PDF）も、いつもの道で描ける。
//   **新しい図形の種類は増やさない。**（ハッチング38章・注記43章と同じやり方）
//
//   種類を増やすと、画面・印刷の絵・PDFの3か所すべてに描き方を足すことになり、
//   1つ忘れると「画面には出るのに紙に出ない」が起きる（開発ルール36.2・43.1）。
//
// 【言葉の意味】
//   制御点（control point）… 曲線を引っぱる「磁石」のような点。曲線は通らないことが多い
//   通過点（fit point）    … 曲線が**実際に通る**点
//   次数（degree）         … 曲線のなめらかさ。1なら折れ線、3ならふつうのなめらかな曲線
//   ノット（knot）         … 制御点の効き目が切り替わる目盛り。数の並びで区間が決まる
//   重み（weight）         … 磁石の強さ。全部同じなら「有理でない」ふつうの曲線
//
// 【この係は画面に触らない】
//   ぜんぶ「数を入れて、数が返る」だけの関数なので、そのまま試験できる。

/**
 * 自由曲線1本を、いくつの点まで細かく分けてよいかの上限。
 *
 * 実務図面には数万本の線がある。細かく分けすぎるとiPadが固まる。
 * hatch.js の MAX_HATCH_LINES と同じ考えの安全装置で、**当たらないのが正常。**
 */
export const MAX_SPLINE_POINTS = 400;

/** ノットの区間1つを、何本の直線に分けるか。 */
const SEGMENTS_PER_SPAN = 16;

/** 端どうしがくっついているとみなす近さ（曲線の大きさに対する割合）。 */
const CLOSE_RATIO = 1e-6;

// ------------------------------------------------------------
// ノット（目盛り）の用意
// ------------------------------------------------------------

/**
 * ノットの数が合っているか。
 * 決まりでは「制御点の数 ＋ 次数 ＋ 1」でなければならない。
 */
function knotCountOk(knots, ctrlCount, degree) {
  return Array.isArray(knots) && knots.length === ctrlCount + degree + 1;
}

/**
 * 両端で止まる（クランプされた）ノットを作る。
 *
 * ノットが書かれていない・数が合わない壊れたDXFのときに使う。
 * これを使うと、曲線は最初の制御点から始まり、最後の制御点で終わる。
 */
function makeClampedKnots(ctrlCount, degree) {
  const knots = [];
  const inner = ctrlCount - degree; // 内側の区間の数
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let i = 1; i < inner; i++) knots.push(i / inner);
  for (let i = 0; i <= degree; i++) knots.push(1);
  return knots;
}

/**
 * 両端で止まっている（クランプされている）ノットかどうか。
 *
 * 閉じた曲線には2通りの書かれ方がある。
 *   - クランプ式 … 制御点の先頭が末尾にも書いてあり、そのまま描けば閉じる
 *   - 周期式     … 制御点は1周ぶんだけ。こちらは自分で1周させないと閉じない
 * 見分けるために、両端のノットが重なっているかを見る。
 */
function isClamped(knots, ctrlCount, degree) {
  const eps = 1e-9;
  const 先頭 = Math.abs(knots[degree] - knots[0]) < eps;
  const 末尾 = Math.abs(knots[ctrlCount + degree] - knots[ctrlCount]) < eps;
  return 先頭 && 末尾;
}

// ------------------------------------------------------------
// 曲線の式（de Boor の計算）
// ------------------------------------------------------------

/**
 * 目盛り u が、何番目の区間に入っているかを探す。
 * @param {number} n 制御点の数 - 1
 * @param {number} p 次数
 * @param {number} u 目盛り
 * @param {number[]} U ノットの並び
 */
function findSpan(n, p, u, U) {
  if (u >= U[n + 1]) return n;
  if (u <= U[p]) return p;
  let low = p;
  let high = n + 1;
  let mid = Math.floor((low + high) / 2);
  while (u < U[mid] || u >= U[mid + 1]) {
    if (u < U[mid]) high = mid;
    else low = mid;
    const next = Math.floor((low + high) / 2);
    if (next === mid) break; // 壊れたノットで止まらなくならないように
    mid = next;
  }
  return mid;
}

/**
 * 曲線の上の1点を求める（de Boor のやり方）。
 *
 * 重み（weight）がある場合にも対応するため、いったん
 * (x*w, y*w, w) の3つ組で計算し、最後に w で割って戻す。
 * こうすると、重みのある曲線（円や楕円をぴったり表せる形）も正しく出る。
 */
function evaluate(span, p, U, P, W, u) {
  const d = [];
  for (let j = 0; j <= p; j++) {
    const i = span - p + j;
    const w = W ? W[i] : 1;
    d.push([P[i][0] * w, P[i][1] * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = span - p + j;
      const denom = U[i + p - r + 1] - U[i];
      const a = denom === 0 ? 0 : (u - U[i]) / denom;
      d[j] = [
        (1 - a) * d[j - 1][0] + a * d[j][0],
        (1 - a) * d[j - 1][1] + a * d[j][1],
        (1 - a) * d[j - 1][2] + a * d[j][2],
      ];
    }
  }
  const [x, y, w] = d[p];
  return w === 0 ? [x, y] : [x / w, y / w];
}

/**
 * 曲線ぜんたいを、点の並びにする。
 *
 * ふだんはノットの区間ごとに同じ本数へ分ける。区間の幅がばらばらな曲線でも、
 * どこかだけ粗くなることがない。
 *
 * 【必ず上限に収める】
 *   点の数は、どんな曲線でも MAX_SPLINE_POINTS を超えてはいけない。
 *   区間が多すぎて「1区間1本」でも収まらない曲線（制御点が何百個もあるもの）は、
 *   区間を無視して、目盛りを端から端まで等間隔に割る。
 *   **上限を超えるくらいなら、粗くなるほうがよい。** iPadが固まるほうが困る。
 */
function samplePoints(p, U, P, W) {
  const n = P.length - 1;

  // 幅のある区間だけを集める（同じ値が続くところは飛ばす）
  const spans = [];
  for (let i = p; i <= n; i++) {
    if (U[i + 1] > U[i]) spans.push([U[i], U[i + 1]]);
  }
  if (spans.length === 0) return [];

  const out = [];
  const push = (u) => {
    const span = findSpan(n, p, u, U);
    out.push(evaluate(span, p, U, P, W, u));
  };

  const 始まり = spans[0][0];
  const 終わり = spans[spans.length - 1][1];

  // 区間ごとに1本ずつでも上限を超えるなら、端から端まで等間隔で割る
  if (spans.length + 1 > MAX_SPLINE_POINTS) {
    const 本数 = MAX_SPLINE_POINTS - 1;
    push(始まり);
    for (let k = 1; k <= 本数; k++) {
      push(始まり + ((終わり - 始まり) * k) / 本数);
    }
    return out;
  }

  let perSpan = SEGMENTS_PER_SPAN;
  if (spans.length * perSpan + 1 > MAX_SPLINE_POINTS) {
    perSpan = Math.max(1, Math.floor((MAX_SPLINE_POINTS - 1) / spans.length));
  }

  push(始まり);
  for (const [u0, u1] of spans) {
    for (let k = 1; k <= perSpan; k++) {
      push(u0 + ((u1 - u0) * k) / perSpan);
    }
  }
  return out;
}

// ------------------------------------------------------------
// 入口
// ------------------------------------------------------------

/**
 * SPLINE を折れ線に直す。
 *
 * @param {object} spline
 * @param {number} spline.degree 次数（71）
 * @param {Array<Array<number>>} spline.controlPoints 制御点（10,20）
 * @param {number[]} [spline.knots] ノット（40）
 * @param {number[]} [spline.weights] 重み（41）。数が合わないときは無視する
 * @param {Array<Array<number>>} [spline.fitPoints] 通過点（11,21）
 * @param {boolean} [spline.closed] 閉じた曲線か（70の1のくらい）
 * @returns {{points:Array<Array<number>>, closed:boolean}|null}
 *          描けないときは null（呼んだ側が「表示できませんでした」に数える）
 */
export function splineToPolyline(spline) {
  const ctrl = (spline && spline.controlPoints) || [];
  const fit = (spline && spline.fitPoints) || [];
  const closedFlag = spline ? spline.closed === true : false;

  // 制御点が足りないときは、通過点（曲線が実際に通る点）をそのままつなぐ。
  // なめらかさは出ないが、**何も出ないよりはるかによい**（10.5：黙って捨てない）。
  if (ctrl.length < 2) {
    if (fit.length >= 2) return finish(fit, closedFlag);
    return null;
  }

  // 次数は、制御点の数を超えられない（壊れたDXF対策）
  let p = Math.floor(Number(spline.degree));
  if (!Number.isFinite(p) || p < 1) p = 3;
  p = Math.min(p, ctrl.length - 1);

  // 次数1は、そのまま制御点を結んだ折れ線と同じ
  if (p === 1) return finish(ctrl, closedFlag);

  let P = ctrl;
  let U = spline.knots;
  let W = spline.weights;

  if (W && W.length !== P.length) W = null; // 数が合わない重みは信用しない
  if (W && W.every((w) => w === W[0])) W = null; // 全部同じ重みは無いのと同じ（計算を軽くする）

  if (!knotCountOk(U, P.length, p)) {
    // ノットが書かれていない・数が合わないDXFは実際にある。
    // 両端で止まるノットを自分で作って、最初と最後の制御点を通す形にする。
    U = makeClampedKnots(P.length, p);
  } else if (closedFlag && !isClamped(U, P.length, p)) {
    // 【周期式の閉じた曲線】制御点が1周ぶんしか書かれていない書き方。
    // 先頭の次数ぶんを後ろにつなぎ足し、等間隔のノットを作り直して1周させる。
    P = P.concat(P.slice(0, p));
    if (W) W = W.concat(W.slice(0, p));
    U = Array.from({ length: P.length + p + 1 }, (_, i) => i);
  }

  const points = samplePoints(p, U, P, W);
  if (points.length < 2) return null;
  return finish(points, closedFlag);
}

/**
 * 仕上げ：同じ場所が続く点をまとめ、端どうしがくっついていれば「閉じた折れ線」にする。
 *
 * 端が重なったまま closed を立てると、長さ0の線が1本残る。
 * 画面では見えないが、範囲（bounds）や印刷の切り取り判定に無駄な点が混ざる。
 */
function finish(points, closedFlag) {
  const 幅 = extent(points);
  const eps = Math.max(幅 * CLOSE_RATIO, 1e-9);

  const out = [];
  for (const pt of points) {
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return null;
    const 前 = out[out.length - 1];
    if (前 && Math.abs(前[0] - pt[0]) < eps && Math.abs(前[1] - pt[1]) < eps) continue;
    out.push([pt[0], pt[1]]);
  }
  if (out.length < 2) return null;

  let closed = closedFlag;
  const 先 = out[0];
  const 後 = out[out.length - 1];
  if (Math.abs(先[0] - 後[0]) < eps && Math.abs(先[1] - 後[1]) < eps) {
    out.pop(); // 重なった終点は落とし、閉じる線は描く側にまかせる
    closed = true;
    if (out.length < 2) return null;
  }
  return { points: out, closed };
}

/** 点の並びの、いちばん長い辺の長さ（誤差の基準に使う）。 */
function extent(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.max(maxX - minX, maxY - minY);
}
