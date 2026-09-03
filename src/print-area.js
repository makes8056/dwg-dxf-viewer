// print-area.js — 囲まれた範囲から、印刷用の絵を作る（開発ルール26章）
//
// 【この係の役目】
//   画面で指で囲んだ範囲（図面座標）を受け取り、
//   - 印刷用の絵（Canvas）を何ピクセルで作るか決める（computePrintSize）
//   - 図面データから、その絵を実際に描き直す（renderPrintCanvas）
//   - 印刷に使えるPNG画像（データURL）を作る（createPrintImage）
//   - 範囲が印刷できる大きさかどうかを判定する（isAreaBigEnough）
//   の4つだけを行う。指で囲む画面そのもの（src/ui/print-ui.js）は担当しない。
//
// 【向きの注意（開発ルール10.6）】
//   図面座標→画面（Canvas）座標の変換は viewport.js の中だけで行う決まりなので、
//   ここでは自分でY軸をひっくり返したりせず、createViewport() と fitToBounds() を
//   使って表示状態（viewport）を作り、それを render.js の renderDrawing() に渡すだけにする。
//
// 【「用紙いっぱいに収める」（開発ルール26.2・26.6）は誰の仕事か】
//   紙の向き（横/縦）は、囲んだ範囲の縦横比で決める（26.6）。この判定はここで行う。
//   ただし「実際の紙の上でA4いっぱいに拡大縮小して表示する」処理そのものは、
//   印刷画面を組み立てる src/ui/print-ui.js 側（@page とCSSでの表示）に任せる想定にした。
//   理由：もしこの絵の大きさ自体をA4用紙のピクセル数（200dpiで 2212×1528点ほど）に
//   合わせて縮めてしまうと、どんな範囲を囲んでも出来上がる絵は常にその大きさ以下になり、
//   26.5の上限（長い辺4000点・全体1200万点）に絶対に届かなくなってしまう
//   （実測10m角の敷地図でも、A4に収まるよう縮めた時点で 2212×1528 を超えない計算になる）。
//   それでは上限が「安全装置」として機能しない。そのため、この絵の大きさは
//   「囲んだ範囲を実寸のまま200dpiで描いたら何ピクセルになるか」を素直に計算し、
//   大きくなりすぎたときだけ上限で縮める、という作りにした。
//   ※ここは司令塔の設計意図と食い違う可能性があるので、つなぎ込み時に確認してほしい。

import { createViewport, fitToBounds } from './viewport.js';
import { renderDrawing } from './render.js';

// ------------------------------------------------------------
// 定数（開発ルール26.5・26.7の数値）
// ------------------------------------------------------------

const MM_PER_INCH = 25.4;

// 「印刷したとき1インチあたり200点」（26.5）。
// 1mmが画面（Canvas）の何ピクセルになるかを、この一定の比で決める。
//   200[点/インチ] ÷ 25.4[mm/インチ] ≒ 7.874016 [点/mm]
const TARGET_DPI = 200;
const PX_PER_MM = TARGET_DPI / MM_PER_INCH; // ≒ 7.874016

// A4用紙の大きさ（mm）と余白（26.6）。
// 絵の大きさは「囲んだ範囲の実寸」ではなく、**この紙の大きさ**から決める（下の説明を参照）。
const A4_LONG_MM = 297;
const A4_SHORT_MM = 210;
const PAGE_MARGIN_MM = 8;
// 紙のうち、実際に印刷できる範囲
const PRINTABLE_LONG_MM = A4_LONG_MM - PAGE_MARGIN_MM * 2; // 281mm
const PRINTABLE_SHORT_MM = A4_SHORT_MM - PAGE_MARGIN_MM * 2; // 194mm

// 上限（26.5）。iPadで絵が大きすぎて落ちるのを防ぐ安全装置。
// 紙の大きさから決めるかぎり、ふつうはここに当たらない。**当たらないのが正常。**
const MAX_LONG_SIDE_PX = 4000; // 長いほうの辺の最大
const MAX_TOTAL_PX = 12_000_000; // 全体の点の数の最大（1200万点）

// 線の太さ：印刷したとき0.25mm程度になるように換算する（26.5）。
//   0.25[mm] × 7.874016[点/mm] ≒ 1.968503... 点（およそ2点）
// 画面用の既定値（src/render.js の DEFAULT_LINE_WIDTH = 1.2）とは別の値になる。
const PRINT_LINE_WIDTH_MM = 0.25;
const PRINT_LINE_WIDTH_PX = PX_PER_MM * PRINT_LINE_WIDTH_MM; // ≒ 1.9685

// 範囲が小さすぎるときの目安（26.7）。短いほうの辺がこれ未満なら「指が滑っただけ」とみなす。
const MIN_AREA_SCREEN_PX = 20;

const ERROR_CANNOT_CREATE = '印刷用の画像を作れませんでした。範囲を狭くしてもう一度お試しください。';
const ERROR_NO_DRAWING = '図面がありません。図面を開いてからお試しください。';
const ERROR_BAD_AREA = '印刷する範囲が正しくありません。範囲を囲み直してください。';
const ERROR_TOO_SMALL = '範囲が小さすぎます。もう少し広く囲んでください。';

// ------------------------------------------------------------
// 内部の小道具
// ------------------------------------------------------------

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 範囲を、必ず数として扱える形に直す（壊れた値が来ても落ちないようにする保険）。
 * min > max のときは入れ替える。
 */
function normalizeArea(area) {
  const minXraw = numberOr(area && area.minX, 0);
  const minYraw = numberOr(area && area.minY, 0);
  const maxXraw = numberOr(area && area.maxX, minXraw);
  const maxYraw = numberOr(area && area.maxY, minYraw);
  return {
    minX: Math.min(minXraw, maxXraw),
    minY: Math.min(minYraw, maxYraw),
    maxX: Math.max(minXraw, maxXraw),
    maxY: Math.max(minYraw, maxYraw),
  };
}

/**
 * 標準のCanvasを作る（ブラウザの本物のCanvas）。
 * テストではこれを使わず、options.createCanvas に差し替える。
 */
function defaultCreateCanvas(widthPx, heightPx) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('この環境ではCanvasを作れません');
  }
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  return canvas;
}

// ------------------------------------------------------------
// 公開する関数
// ------------------------------------------------------------

/**
 * 印刷用の絵の大きさを決める。
 * @param {object} area 図面座標での範囲 { minX, minY, maxX, maxY }
 * @returns {{ widthPx:number, heightPx:number, orientation:'landscape'|'portrait',
 *             scale:number, limited:boolean }}
 *   scale … 図面1単位が何ピクセルになるか
 *   limited … 上限に当たって小さくしたなら true
 */
export function computePrintSize(area) {
  const a = normalizeArea(area);
  const areaWmm = a.maxX - a.minX;
  const areaHmm = a.maxY - a.minY;

  // 26.6：横長なら横向き、縦長なら縦向き。同じ（正方形）なら横向き扱いにする
  const orientation = areaWmm >= areaHmm ? 'landscape' : 'portrait';

  // ------------------------------------------------------------
  // 【いちばん大事な計算。ここを間違えると紙がぼやけます】
  //
  // このアプリの印刷は「**用紙に合わせて自動で拡大縮小**」です（26.2）。
  // 囲んだ範囲が何ミリだろうと、最後は紙いっぱいに引き伸ばして印刷されます。
  //
  // そのため、絵の大きさは「囲んだ範囲の実寸」ではなく、
  // **紙の大きさ**から決めなければいけません。
  //
  // 実寸で決めると、こうなります（実際に測った数字）：
  //   100mm×60mm の小さな部分を囲む → 絵は 787×472点
  //   → それを紙（横281mm）いっぱいに引き伸ばす → **紙の上では71dpi。ぼやける**
  // 「この部分だけ印刷したい」という**いちばんよくある使い方**で、ぼやけてしまいます。
  //
  // 紙の大きさから決めれば、囲んだ範囲の大小にかかわらず、
  // いつでも紙の上で200dpiになります。
  // ------------------------------------------------------------

  // 紙のうち印刷できる範囲を、点の数に直す
  const paperWmm = orientation === 'landscape' ? PRINTABLE_LONG_MM : PRINTABLE_SHORT_MM;
  const paperHmm = orientation === 'landscape' ? PRINTABLE_SHORT_MM : PRINTABLE_LONG_MM;
  const paperWpx = paperWmm * PX_PER_MM;
  const paperHpx = paperHmm * PX_PER_MM;

  // 囲んだ範囲の縦横の比を保ったまま、紙の中にぴったり収まる大きさを求める。
  // （紙の比とちょうど同じでないかぎり、上下か左右に余りが出る。それでよい）
  const areaRatio = areaWmm > 0 && areaHmm > 0 ? areaWmm / areaHmm : 1;
  const paperRatio = paperWpx / paperHpx;

  let widthPx;
  let heightPx;
  if (areaRatio >= paperRatio) {
    // 囲んだ範囲のほうが横長 → 紙の横幅いっぱいに合わせる
    widthPx = paperWpx;
    heightPx = paperWpx / areaRatio;
  } else {
    // 囲んだ範囲のほうが縦長 → 紙の高さいっぱいに合わせる
    heightPx = paperHpx;
    widthPx = paperHpx * areaRatio;
  }

  // 範囲がほぼ点（幅か高さが実質0）のときの保険。0ピクセルの絵は作れない
  if (!(widthPx > 0)) widthPx = 1;
  if (!(heightPx > 0)) heightPx = 1;

  // 図面1単位が何ピクセルになるか
  let scale = areaWmm > 0 ? widthPx / areaWmm : PX_PER_MM;

  let limited = false;

  // 上限1：長いほうの辺が4000点を超えない
  const longSide = Math.max(widthPx, heightPx);
  if (longSide > MAX_LONG_SIDE_PX) {
    const factor = MAX_LONG_SIDE_PX / longSide;
    widthPx *= factor;
    heightPx *= factor;
    scale *= factor;
    limited = true;
  }

  // 上限2：全体の点の数が1200万点を超えない（上限1だけでは足りない場合がある。
  // 例：正方形に近い範囲は、長い辺を4000点まで許すと 4000×4000=1600万点になり、
  // 1200万点の上限を超えてしまう）
  const totalPx = widthPx * heightPx;
  if (totalPx > MAX_TOTAL_PX) {
    const factor = Math.sqrt(MAX_TOTAL_PX / totalPx);
    widthPx *= factor;
    heightPx *= factor;
    scale *= factor;
    limited = true;
  }

  // ここまでの計算は小数のまま進め、最後にピクセル数として丸める。
  // 丸めで1200万点をわずかに超えないよう、切り捨てる
  widthPx = Math.max(1, Math.floor(widthPx));
  heightPx = Math.max(1, Math.floor(heightPx));

  return { widthPx, heightPx, orientation, scale, limited };
}

/**
 * 囲まれた範囲を、印刷用のキャンバスに描く。
 * @param {object} drawing src/drawing.js の形の図形データ
 * @param {object} area 図面座標での範囲 { minX, minY, maxX, maxY }
 * @param {object} [options] { createCanvas } … テスト用に差し替えられるようにする
 * @returns {{ canvas:object, widthPx:number, heightPx:number,
 *             orientation:string, drawn:number, limited:boolean }}
 */
export function renderPrintCanvas(drawing, area, options = {}) {
  const size = computePrintSize(area);
  const { widthPx, heightPx, orientation, limited } = size;

  const createCanvas = options.createCanvas || defaultCreateCanvas;
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');

  // 表示状態（viewport）を作る。Y軸の反転などは viewport.js に任せる（開発ルール10.6）
  const vp = createViewport(widthPx, heightPx);
  const a = normalizeArea(area);
  fitToBounds(vp, { minX: a.minX, minY: a.minY, maxX: a.maxX, maxY: a.maxY });

  // 画面の絵をそのまま引き伸ばすのではなく、図面データから描き直す（26.5）
  const { drawn } = renderDrawing(ctx, drawing, vp, {
    lineWidth: PRINT_LINE_WIDTH_PX, // 画面用(1.2)ではなく、印刷用に換算した太さ
    dpr: 1, // 印刷用のキャンバスは widthPx×heightPx がそのまま実ピクセル数なので等倍
  });

  return { canvas, widthPx, heightPx, orientation, drawn, limited };
}

/**
 * 図面や範囲が、印刷用の絵を作れる状態かどうかを確かめる。
 * @returns {{ok:boolean, error?:string}}
 */
function validateInputs(drawing, area) {
  if (!drawing || typeof drawing !== 'object') {
    return { ok: false, error: ERROR_NO_DRAWING };
  }
  if (!area || typeof area !== 'object') {
    return { ok: false, error: ERROR_BAD_AREA };
  }
  const { minX, minY, maxX, maxY } = area;
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) {
    return { ok: false, error: ERROR_BAD_AREA };
  }
  const w = Math.abs(maxX - minX);
  const h = Math.abs(maxY - minY);
  if (w <= 0 || h <= 0) {
    return { ok: false, error: ERROR_TOO_SMALL };
  }
  return { ok: true };
}

/**
 * 囲まれた範囲から、印刷に使う画像（PNGのデータURL）を作る。
 * 失敗したときは例外を投げず、日本語の理由つきで { error: '…' } を返す（開発ルール26.7）。
 * @returns {Promise<{ dataUrl:string, widthPx:number, heightPx:number,
 *                      orientation:string, limited:boolean } | { error:string }>}
 */
export async function createPrintImage(drawing, area, options = {}) {
  try {
    const validation = validateInputs(drawing, area);
    if (!validation.ok) {
      return { error: validation.error };
    }

    const { canvas, widthPx, heightPx, orientation, limited } = renderPrintCanvas(
      drawing,
      area,
      options
    );

    if (!canvas || typeof canvas.toDataURL !== 'function') {
      return { error: ERROR_CANNOT_CREATE };
    }

    const dataUrl = canvas.toDataURL('image/png');
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return { error: ERROR_CANNOT_CREATE };
    }

    return { dataUrl, widthPx, heightPx, orientation, limited };
  } catch (err) {
    // 容量不足などでCanvasやtoDataURLが失敗しても、ここで必ず受け止めて日本語で返す。
    // 黙って何も起きないのがいちばん困る（開発ルール26.7）
    return { error: ERROR_CANNOT_CREATE };
  }
}

/**
 * 囲まれた範囲が、印刷してよい大きさかどうか。
 * @param {object} areaScreen 画面上の四角 { width, height }（ピクセル）
 * @returns {{ ok:boolean, reason:string }} reason は日本語
 */
export function isAreaBigEnough(areaScreen) {
  const w = areaScreen && Number(areaScreen.width);
  const h = areaScreen && Number(areaScreen.height);

  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    return { ok: false, reason: ERROR_TOO_SMALL };
  }

  const shortSide = Math.min(Math.abs(w), Math.abs(h));
  if (shortSide < MIN_AREA_SCREEN_PX) {
    return { ok: false, reason: ERROR_TOO_SMALL };
  }

  return { ok: true, reason: '' };
}
