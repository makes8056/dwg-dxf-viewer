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
// 【この絵は「A4用紙1枚そのもの」です（開発ルール29章）】
//   作る絵は、囲んだ範囲の形ではなく**A4用紙1枚の形**にしている。
//   外周8mmは白い余白で、図面はその内側にだけ描く。
//
//   理由：iPadのプリント画面は、渡された絵を紙いっぱいに引き伸ばす。
//   絵と紙の形が違うと、そのときに絵が紙からはみ出す。
//   プリンターは紙の端3〜5mmには物理的に印刷できないので、
//   はみ出した部分＝図面の左右が切れて出てくる（実機で発生。v0.2.2の不具合）。
//   絵と紙の形を同じにしておけば、引き伸ばされても位置がずれず、
//   紙の縁で失われるのは白い余白だけになる。
//
//   絵の細かさは、紙の上で200dpi（26.5）。A4なので 2338×1653点、約386万点。
//   囲んだ範囲が何ミリでも紙の上では必ず200dpiになる（範囲の実寸から決めてはいけない）。

import { createViewport, fitToBounds, setSize, toScreen } from './viewport.js';
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
 *
 * 【v0.2.3で変えたところ ／ 実機で「横が切れる」不具合が出たため（開発ルール29章）】
 *   前は「囲んだ範囲の形をした絵」を作っていた。A4用紙とは形が違う。
 *   その絵をiPadのプリント画面に渡すと、**紙いっぱいに引き伸ばされ**、
 *   プリンターが物理的に印刷できない紙の端（ふつう上下左右3〜5mm）に
 *   絵がはみ出して、左右が切れて出てきた。
 *
 *   そこで**絵そのものをA4用紙1枚の形**にした。
 *   絵の外周8mmは白い余白で、図面はその内側にだけ描く。
 *   絵と紙の形が同じなので引き伸ばされても位置がずれず、
 *   はみ出す部分は白い余白なので、図面は絶対に切れない。
 *
 * @param {object} area 図面座標での範囲 { minX, minY, maxX, maxY }
 * @returns {{ widthPx:number, heightPx:number, innerWidthPx:number, innerHeightPx:number,
 *             orientation:'landscape'|'portrait', scale:number, limited:boolean }}
 *   widthPx / heightPx … 絵ぜんたい（＝A4用紙1枚）の点の数
 *   innerWidthPx / innerHeightPx … 白い余白の内側、図面を描いてよい所の点の数
 *   scale … 図面1単位が何ピクセルになるか（おおよそ。余白の付け方で少し変わる）
 *   limited … 上限に当たって小さくしたなら true
 */
export function computePrintSize(area) {
  const a = normalizeArea(area);
  const areaWmm = a.maxX - a.minX;
  const areaHmm = a.maxY - a.minY;

  // 26.6：横長なら横向き、縦長なら縦向き。同じ（正方形）なら横向き扱いにする
  const orientation = areaWmm >= areaHmm ? 'landscape' : 'portrait';

  // ------------------------------------------------------------
  // 【いちばん大事な計算。ここを間違えると紙がぼやけたり切れたりします】
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
  //
  // さらに、絵の**形**もA4用紙1枚と同じにします（29章）。
  // 形が違うと、iPadが紙に合わせて引き伸ばしたときに端がはみ出し、
  // プリンターが印刷できない紙の縁で切れてしまうためです。
  // ------------------------------------------------------------

  // 絵ぜんたい ＝ A4用紙1枚
  const pageWmm = orientation === 'landscape' ? A4_LONG_MM : A4_SHORT_MM;
  const pageHmm = orientation === 'landscape' ? A4_SHORT_MM : A4_LONG_MM;
  let widthPx = pageWmm * PX_PER_MM;
  let heightPx = pageHmm * PX_PER_MM;

  // 図面を描いてよい所 ＝ 外周8mmの白い余白を除いた内側
  let innerWidthPx = (pageWmm - PAGE_MARGIN_MM * 2) * PX_PER_MM;
  let innerHeightPx = (pageHmm - PAGE_MARGIN_MM * 2) * PX_PER_MM;

  // 図面1単位が何ピクセルになるか（内側にちょうど収まる大きさ）
  let scale = PX_PER_MM;
  if (areaWmm > 0 && areaHmm > 0) {
    scale = Math.min(innerWidthPx / areaWmm, innerHeightPx / areaHmm);
  }

  let limited = false;

  // 上限（26.5）。A4・200dpiなら 2338×1653点＝約386万点なので、ここには当たらない。
  // **当たらないのが正常。** 将来もっと大きな紙や高い細かさにしたときの安全装置として残す。
  const longSide = Math.max(widthPx, heightPx);
  if (longSide > MAX_LONG_SIDE_PX) {
    const factor = MAX_LONG_SIDE_PX / longSide;
    widthPx *= factor;
    heightPx *= factor;
    innerWidthPx *= factor;
    innerHeightPx *= factor;
    scale *= factor;
    limited = true;
  }

  const totalPx = widthPx * heightPx;
  if (totalPx > MAX_TOTAL_PX) {
    const factor = Math.sqrt(MAX_TOTAL_PX / totalPx);
    widthPx *= factor;
    heightPx *= factor;
    innerWidthPx *= factor;
    innerHeightPx *= factor;
    scale *= factor;
    limited = true;
  }

  // ここまでの計算は小数のまま進め、最後にピクセル数として丸める。
  // 丸めで1200万点をわずかに超えないよう、切り捨てる
  widthPx = Math.max(1, Math.floor(widthPx));
  heightPx = Math.max(1, Math.floor(heightPx));
  innerWidthPx = Math.max(1, Math.floor(innerWidthPx));
  innerHeightPx = Math.max(1, Math.floor(innerHeightPx));

  return { widthPx, heightPx, innerWidthPx, innerHeightPx, orientation, scale, limited };
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
  const { widthPx, heightPx, innerWidthPx, innerHeightPx, orientation, limited } = size;

  const createCanvas = options.createCanvas || defaultCreateCanvas;
  // 絵ぜんたいはA4用紙1枚ぶん。外周は白い余白になる（開発ルール29章）
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');

  // 表示状態（viewport）を作る。Y軸の反転などは viewport.js に任せる（開発ルール10.6）
  //
  // 手順は2つ：
  //   1. まず「白い余白の内側」の大きさで作り、そこに囲んだ範囲を収める
  //   2. そのあと紙ぜんたいの大きさに広げる（setSize は拡大率を変えず、
  //      真ん中を保ったまま外側を広げるので、そこが白い余白になる）
  // fitToBounds は画面用に、まわりへ5%のすき間を付ける（padBounds(0.05)＝縦横とも1.1倍）。
  // 画面では見やすくてよいが、紙では**そのぶん図面が小さく印刷されてしまう**
  // （A4横だと左右が8mmではなく20.8mmになった。実測）。
  // 紙にはすでに8mmの白い余白があるので、ここでは1.1倍しておいて打ち消す。
  const FIT_PAD = 1.1;
  const vp = createViewport(innerWidthPx * FIT_PAD, innerHeightPx * FIT_PAD);
  const a = normalizeArea(area);
  fitToBounds(vp, { minX: a.minX, minY: a.minY, maxX: a.maxX, maxY: a.maxY });
  setSize(vp, widthPx, heightPx);

  // まず紙ぜんたいを白で塗る。
  // このあと囲まれた範囲の中だけに描くので、外側は白い余白として残る。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  // 【囲んだ範囲の外は描かない（開発ルール29章）】
  // 描く先は紙1枚ぶんに広がったので、何もしないと**囲んだ範囲の外にある図形**まで
  // 余白に描かれてしまう。それでは：
  //   - 「この範囲を印刷」と言いながら、範囲外のものが出てしまう
  //   - せっかくの白い余白に線が来て、プリンターの縁でまた切れる
  // ので、囲まれた範囲の四角の中だけに描くようにする。
  // 範囲→画面(Canvas)の座標変換は、決まりどおり viewport.js に任せる（10.6）。
  const [clipX1, clipY1] = toScreen(vp, a.minX, a.maxY); // 範囲の左上
  const [clipX2, clipY2] = toScreen(vp, a.maxX, a.minY); // 範囲の右下
  // 線の太さのぶんだけ外へ広げる。ちょうど境目にある線が半分だけ消えるのを防ぐ。
  const にじみ = PRINT_LINE_WIDTH_PX;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    clipX1 - にじみ,
    clipY1 - にじみ,
    clipX2 - clipX1 + にじみ * 2,
    clipY2 - clipY1 + にじみ * 2
  );
  ctx.clip();

  // 画面の絵をそのまま引き伸ばすのではなく、図面データから描き直す（26.5）
  const { drawn } = renderDrawing(ctx, drawing, vp, {
    lineWidth: PRINT_LINE_WIDTH_PX, // 画面用(1.2)ではなく、印刷用に換算した太さ
    dpr: 1, // 印刷用のキャンバスは widthPx×heightPx がそのまま実ピクセル数なので等倍
    // 白で塗りつぶすのは上で紙ぜんたいに済ませてある。
    // ここで塗ると囲みの中だけになるので、透明な余白ができてしまう
    background: 'transparent',
  });

  ctx.restore();

  return { canvas, widthPx, heightPx, innerWidthPx, innerHeightPx, orientation, drawn, limited };
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

    // iPadへ渡すための「ファイルとしての絵」も作る（開発ルール28.2）。
    // 共有メニューはファイルを受け取る決まりなので、データURLだけでは渡せない。
    // 作れなくても印刷の確認画面は出せるので、失敗しても止めない。
    let blob = null;
    try {
      blob = dataUrlToBlob(dataUrl);
    } catch (err) {
      blob = null;
    }

    return { dataUrl, blob, widthPx, heightPx, orientation, limited };
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
/**
 * データURL（`data:image/png;base64,...`）を、ファイルとして扱える形に直す。
 *
 * iPadの共有メニューは「ファイル」を受け取る決まりなので、この変換が要る。
 * Canvas の toBlob() を使う手もあるが、あちらは待ち時間が入る。
 * **待ち時間が入ると、iPadが共有メニューを開かせないことがある**（開発ルール28.3）ため、
 * 待ち時間の要らないこちらのやり方を使う。
 *
 * @param {string} dataUrl
 * @returns {Blob}
 */
export function dataUrlToBlob(dataUrl) {
  const カンマ = String(dataUrl).indexOf(',');
  if (カンマ < 0) throw new Error('絵のデータの形がおかしい');
  const 見出し = dataUrl.slice(0, カンマ);
  const 中身 = dataUrl.slice(カンマ + 1);

  const 種類 = (見出し.match(/data:([^;,]+)/) || [])[1] || 'image/png';
  if (!/;base64/i.test(見出し)) {
    return new Blob([decodeURIComponent(中身)], { type: 種類 });
  }

  const 生 = atob(中身);
  const bytes = new Uint8Array(生.length);
  for (let i = 0; i < 生.length; i++) bytes[i] = 生.charCodeAt(i);
  return new Blob([bytes], { type: 種類 });
}

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
