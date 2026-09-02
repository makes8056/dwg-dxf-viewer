// viewport.js — 図面の座標と画面の座標の変換、拡大縮小・移動の状態（開発ルール9.5・10.6）
//
// 【この1ファイルだけの役目（開発ルール10.6）】
//   CADの図面はY軸が上向き、Canvasの画面はY軸が下向き。
//   この向きの反転（Y軸のひっくり返し）は、このファイルの中だけで行う。
//   他のファイル（render.js など）では、画面の座標を作るのに必ずこのファイルの
//   toScreen / toDrawing を通すこと。自分でY座標を反転させない。
//
// 【表示の状態（viewport）の考え方】
//   { width, height, scale, offsetX, offsetY }
//   - width, height … 画面（canvasのCSSピクセル）の大きさ
//   - scale         … 図面の1単位が画面の何ピクセルになるか
//   - offsetX       … 画面の左上（sx=0）に対応する、図面のX座標
//   - offsetY       … 画面の左上（sy=0）に対応する、図面のY座標
//                      （Y軸が上下逆なので、画面の「上」は図面としては「offsetYより上＝大きいY」）
//
//   変換式（ここが唯一の反転ポイント）：
//     sx = (x - offsetX) * scale
//     sy = (offsetY - y) * scale        ← ここでY軸をひっくり返している
//
// ------------------------------------------------------------

// drawing.js は「読むだけ」で使う（司令塔の指示：fitToBounds は padBounds で余白を付ける）。
import { padBounds } from './drawing.js';

// 拡大縮小の上限・下限。無いと指の操作でいくらでも拡大縮小できてしまい、
// 図面が見えなくなったり、数値が壊れたりして操作不能になる。
export const MIN_SCALE = 1e-6;
export const MAX_SCALE = 1e6;

function clampScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) return MIN_SCALE;
  if (scale < MIN_SCALE) return MIN_SCALE;
  if (scale > MAX_SCALE) return MAX_SCALE;
  return scale;
}

/**
 * 表示の状態を作る。
 * @param {number} width  画面（canvas）の幅。CSSピクセル
 * @param {number} height 画面（canvas）の高さ。CSSピクセル
 */
export function createViewport(width, height) {
  return {
    width,
    height,
    scale: 1,
    offsetX: 0,
    offsetY: height, // 図面の (0,0) が画面の左下あたりに来るようにしておく（何もしなくても妥当な初期表示）
  };
}

/**
 * キャンバスの大きさが変わったとき（画面回転など）に呼ぶ。
 * 画面の中心に映っている図面の場所を保ったまま、大きさだけ合わせる。
 * @param {object} vp
 * @param {number} width  新しい幅
 * @param {number} height 新しい高さ
 */
export function setSize(vp, width, height) {
  // 変更前の画面中心が、図面のどこを指していたかを覚えておく
  const [cx, cy] = toDrawing(vp, vp.width / 2, vp.height / 2);

  vp.width = width;
  vp.height = height;

  // 新しい画面でも、同じ図面の場所が中心に来るように offset を合わせ直す
  vp.offsetX = cx - (vp.width / 2) / vp.scale;
  vp.offsetY = cy + (vp.height / 2) / vp.scale;
}

/**
 * 図面全体が画面に収まるようにする（初期表示・「全体表示」ボタン）。
 * bounds が null（図形が無い図面）でも落ちない。
 * @param {object} vp
 * @param {{minX:number,minY:number,maxX:number,maxY:number}|null} bounds
 */
export function fitToBounds(vp, bounds) {
  if (!bounds) return; // 図形が無い。今の表示状態のまま何もしない（落とさない）

  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;

  // 幅・高さが0（線1本や点だけの図面）でも余白は付く（drawing.js の padBounds が保証する）
  const padded = padBoundsSafely(bounds);
  const pw = padded.maxX - padded.minX;
  const ph = padded.maxY - padded.minY;

  const scaleX = pw > 0 ? vp.width / pw : MAX_SCALE;
  const scaleY = ph > 0 ? vp.height / ph : MAX_SCALE;
  const scale = clampScale(Math.min(scaleX, scaleY));

  const scaledW = pw * scale;
  const scaledH = ph * scale;
  const marginX = (vp.width - scaledW) / 2;
  const marginY = (vp.height - scaledH) / 2;

  vp.scale = scale;
  vp.offsetX = padded.minX - marginX / scale;
  vp.offsetY = padded.maxY + marginY / scale;

  // 幅・高さの両方が0（点1つだけ）の場合の保険。上のw/hは使っていないが、
  // 将来ここを読む人のために意図を残しておく（widthを直接使わない設計）。
  void w; void h;
}

function padBoundsSafely(bounds) {
  return padBounds(bounds, 0.05);
}

/**
 * 図面の座標 → 画面の座標。
 * @param {object} vp
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]} [sx, sy]
 */
export function toScreen(vp, x, y) {
  const sx = (x - vp.offsetX) * vp.scale;
  const sy = (vp.offsetY - y) * vp.scale; // ここでY軸を反転（CADは上向き→Canvasは下向き）
  return [sx, sy];
}

/**
 * 画面の座標 → 図面の座標。
 * @param {object} vp
 * @param {number} sx
 * @param {number} sy
 * @returns {[number, number]} [x, y]
 */
export function toDrawing(vp, sx, sy) {
  const x = sx / vp.scale + vp.offsetX;
  const y = vp.offsetY - sy / vp.scale; // toScreen の逆変換
  return [x, y];
}

/**
 * 指でなぞった分だけ動かす（画面のピクセル数で渡す）。
 * 指を右に動かしたら、図面も右へついてくる（掴んで動かす感覚）。
 * @param {object} vp
 * @param {number} dxScreen 画面上でのX方向の移動量（ピクセル）
 * @param {number} dyScreen 画面上でのY方向の移動量（ピクセル）
 */
export function panBy(vp, dxScreen, dyScreen) {
  vp.offsetX -= dxScreen / vp.scale;
  vp.offsetY += dyScreen / vp.scale;
}

/**
 * ある画面の点を中心に拡大縮小する。ピンチの中心を動かさないために使う。
 * @param {object} vp
 * @param {number} sx 画面のX座標（ピンチの中心など）
 * @param {number} sy 画面のY座標
 * @param {number} factor 拡大率（1より大きいと拡大、小さいと縮小）
 */
export function zoomAt(vp, sx, sy, factor) {
  // 指定した画面の点が指している「図面の場所」を、拡大縮小の前後で変えない
  const [dx, dy] = toDrawing(vp, sx, sy);

  const newScale = clampScale(vp.scale * factor);
  vp.scale = newScale;

  // 同じ図面の場所 (dx, dy) が、また同じ画面の点 (sx, sy) に来るように offset を作り直す
  vp.offsetX = dx - sx / newScale;
  vp.offsetY = dy + sy / newScale;
}

/**
 * 今画面に見えている範囲を図面の座標で返す。描画を速くするために使う
 * （画面の外にある図形を描かずに省ける）。
 * @param {object} vp
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
export function visibleBounds(vp) {
  const [x1, y1] = toDrawing(vp, 0, 0);
  const [x2, y2] = toDrawing(vp, vp.width, vp.height);
  return {
    minX: Math.min(x1, x2),
    minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2),
    maxY: Math.max(y1, y2),
  };
}
