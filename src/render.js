// render.js — 図面をCanvasに描く（開発ルール9.5）
//
// 【開発ルール2.4】描く係は、データを自分で取りに行かない。
//   呼び出す側（src/ui/app.js など）が drawing（図形データ）と viewport（表示状態）を
//   計算して渡す。このファイルは受け取ったものをそのまま描くだけで、
//   ファイルを読んだり、状態を覚えたりしない。
//
// 【向きの注意（開発ルール10.6）】
//   図面の座標→画面の座標の変換（Y軸の反転）は viewport.js の中だけで行う。
//   このファイルでは viewport.toScreen() の結果をそのまま使い、
//   自分でY座標を反転させたり、符号を直したりしない。

import { computeBounds } from './drawing.js';
import { toScreen, visibleBounds } from './viewport.js';

const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_LINE_WIDTH = 1.2; // 画面上のピクセル数。拡大縮小しても変わらない太さ
const DEFAULT_DPR = 1;
const MIN_READABLE_TEXT_PX = 5; // これより小さい文字は描かない（読めない黒つぶれを防ぐ。仕様書より）

/**
 * 図面をキャンバスに描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} drawing  src/drawing.js の形の図形データ
 * @param {object} viewport src/viewport.js の表示状態
 * @param {object} [options] { background, lineWidth, dpr }
 * @returns {{drawn:number, skipped:number}} 描いた数・省いた数
 */
/**
 * 画面の細かさ（何倍で描くか）を、キャンバス自身から読み取る。
 *
 * 【iPadで起きた本番不具合。ここを1倍に決め打ちしてはいけない】
 *
 * iPadの画面は細かいので、キャンバスは「見た目の大きさ × 2倍」の点数で作られます。
 * ところがここで1倍と決めつけて描くと、**2倍の広さに1倍で描く**ことになり、
 * 図面が画面の**左上4分の1にだけ縮こまって**表示されます。実際にそうなりました。
 *
 * パソコンの画面はたいてい1倍なので、**この不具合はパソコンでは絶対に再現しません。**
 *
 * 呼び出す側が倍率を渡し忘れても正しく描けるよう、
 * ここでキャンバスの実際の点数と見た目の大きさから計算して求めます。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} viewport
 * @returns {number} 倍率（ふつうは1か2、または3）
 */
function inferDpr(ctx, viewport) {
  const canvasPixels = ctx && ctx.canvas ? ctx.canvas.width : 0;
  const cssWidth = viewport && viewport.width;
  if (canvasPixels > 0 && cssWidth > 0) {
    const ratio = canvasPixels / cssWidth;
    // ありえない値（キャンバスの大きさがまだ決まっていない等）は使わない
    if (ratio > 0.1 && ratio < 8) return ratio;
  }
  return DEFAULT_DPR;
}

export function renderDrawing(ctx, drawing, viewport, options = {}) {
  const background = options.background || DEFAULT_BACKGROUND;
  const lineWidthPx = options.lineWidth || DEFAULT_LINE_WIDTH;
  const dpr = options.dpr || inferDpr(ctx, viewport);

  const cssWidth = viewport.width;
  const cssHeight = viewport.height;

  ctx.save();
  // iPadなどの高精細画面（devicePixelRatio）に対応する。
  // canvas の実ピクセル数（ctx.canvas.width/height）は呼び出し側が
  // すでに cssサイズ×dpr にしてある前提で、ここではCSSピクセル単位で描けるように
  // 変換だけを掛ける（＝ぼやけない）。
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 背景（白）。CADの白い線を黒に変換済みなので、白背景で線が消えない（drawing.js参照）
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  let drawn = 0;
  let skipped = 0;

  const entities = drawing && Array.isArray(drawing.entities) ? drawing.entities : [];
  if (entities.length === 0) {
    ctx.restore();
    return { drawn, skipped };
  }

  const view = visibleBounds(viewport);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidthPx;

  for (const entity of entities) {
    // 画面の外にある図形は描かない（実務図面は数万本の線があり、ここを省かないと固まる）
    if (!intersectsView(entity, view)) {
      skipped += 1;
      continue;
    }

    const didDraw = drawEntity(ctx, entity, viewport, lineWidthPx);
    if (didDraw) {
      drawn += 1;
    } else {
      skipped += 1;
    }
  }

  ctx.restore();
  return { drawn, skipped };
}

/**
 * 図形のおおよその範囲が、見えている範囲と重なっているか。
 * drawing.js の computeBounds を1つの図形にそのまま使い回す（境界の計算式を二重に持たない）。
 */
function intersectsView(entity, view) {
  const bounds = computeBounds([entity]);
  if (!bounds) return false;
  return (
    bounds.maxX >= view.minX &&
    bounds.minX <= view.maxX &&
    bounds.maxY >= view.minY &&
    bounds.minY <= view.maxY
  );
}

function drawEntity(ctx, entity, viewport, lineWidthPx) {
  switch (entity.type) {
    case 'line':
      return drawLine(ctx, entity, viewport);
    case 'polyline':
      return drawPolyline(ctx, entity, viewport);
    case 'circle':
      return drawCircle(ctx, entity, viewport);
    case 'arc':
      return drawArc(ctx, entity, viewport);
    case 'ellipse':
      return drawEllipse(ctx, entity, viewport);
    case 'text':
      return drawText(ctx, entity, viewport);
    default:
      return false; // drawing.js の決まりに無い種類。ここには来ない想定だが、念のため
  }
}

function drawLine(ctx, e, vp) {
  const [sx1, sy1] = toScreen(vp, e.x1, e.y1);
  const [sx2, sy2] = toScreen(vp, e.x2, e.y2);
  ctx.strokeStyle = e.color || '#000000';
  ctx.beginPath();
  ctx.moveTo(sx1, sy1);
  ctx.lineTo(sx2, sy2);
  ctx.stroke();
  return true;
}

function drawPolyline(ctx, e, vp) {
  const points = e.points;
  if (!Array.isArray(points) || points.length === 0) return false;
  ctx.strokeStyle = e.color || '#000000';
  ctx.beginPath();
  points.forEach((p, i) => {
    const [sx, sy] = toScreen(vp, p[0], p[1]);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  if (e.closed) ctx.closePath();
  ctx.stroke();
  return true;
}

function drawCircle(ctx, e, vp) {
  const [sx, sy] = toScreen(vp, e.cx, e.cy);
  const radiusPx = e.r * vp.scale;
  if (!(radiusPx > 0)) return false;
  ctx.strokeStyle = e.color || '#000000';
  ctx.beginPath();
  ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
  return true;
}

// 円弧の角度は「度・反時計回り」（drawing.js）。
// CanvasのarcはラジアンでY軸が下向きのため、角度の符号を反転させる必要がある
// （viewport.js が図面→画面でY軸を反転させているのと同じ理由）。
// ここを間違えると、90度の円弧が左下に出るなど向きが逆になる。
function drawArc(ctx, e, vp) {
  const [sx, sy] = toScreen(vp, e.cx, e.cy);
  const radiusPx = e.r * vp.scale;
  if (!(radiusPx > 0)) return false;

  const toRad = (deg) => (deg * Math.PI) / 180;
  // 図面の角度θ（反時計回り・Y上向き）は、画面（Y下向き）では -θ になる。
  // Canvasのarcは「角度が増える向き＝時計回りに見える」ので、
  // 反時計回り（開始→終了、角度が増える向き）で描くために anticlockwise=true を使う。
  const canvasStart = -toRad(e.startAngle);
  const canvasEnd = -toRad(e.endAngle);

  ctx.strokeStyle = e.color || '#000000';
  ctx.beginPath();
  ctx.arc(sx, sy, radiusPx, canvasStart, canvasEnd, true);
  ctx.stroke();
  return true;
}

/**
 * 楕円を描く。
 *
 * 角度の向きの扱いは円弧（drawArc）とまったく同じ理由で反転させる。
 * 図面のY軸は上向き、画面のY軸は下向きなので、そのまま渡すと上下が逆の楕円になる。
 * 傾き（rotation）も同じく反転が必要。
 */
function drawEllipse(ctx, e, vp) {
  const [sx, sy] = toScreen(vp, e.cx, e.cy);
  const rxPx = e.rx * vp.scale;
  const ryPx = e.ry * vp.scale;
  if (!(rxPx > 0) || !(ryPx > 0)) return false;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const start = e.startAngle || 0;

  // 【落とし穴】始まりと終わりが同じなら「ぐるっと一周」の意味。
  // 角度は 0〜360度 に直してあるので、一周の楕円は 0度→0度 になる。
  // そのまま描くと**何も描かれない**（長さ0の弧になる）。
  // 実物の図面には一周の楕円が100個以上あるので、ここは必ず必要。
  let sweep = (e.endAngle === undefined ? 360 : e.endAngle) - start;
  sweep = ((sweep % 360) + 360) % 360;
  if (sweep === 0) sweep = 360;
  const end = start + sweep;

  ctx.strokeStyle = e.color || '#000000';
  ctx.beginPath();
  // 角度の向きは円弧（drawArc）と同じ理由で反転させる
  ctx.ellipse(sx, sy, rxPx, ryPx, -toRad(e.rotation || 0), -toRad(start), -toRad(end), true);
  ctx.stroke();
  return true;
}

function drawText(ctx, e, vp) {
  const fontPx = (e.height || 0) * vp.scale;
  // 小さすぎて読めない文字は描かない（読めない文字で画面が真っ黒になるのを防ぐ）
  if (!(fontPx >= MIN_READABLE_TEXT_PX)) return false;

  const [sx, sy] = toScreen(vp, e.x, e.y);
  const rotationDeg = e.rotation || 0;

  ctx.save();
  ctx.fillStyle = e.color || '#000000';
  ctx.font = `${fontPx}px sans-serif`;
  // 文字を書き出す点の、どこに文字を置くか（drawing.js の hAlign / vAlign）。
  // 寸法の数字は「中央ぞろえ」で置かれるので、ここを左端に決め打ちすると
  // 数字が寸法線からずれて見える。
  ctx.textAlign = e.hAlign || 'left';
  ctx.textBaseline = e.vAlign || 'alphabetic';
  ctx.translate(sx, sy);
  // 回転も、円弧と同じ理由で符号を反転させる（図面の反時計回り→画面では逆向き）
  ctx.rotate(-((rotationDeg * Math.PI) / 180));
  ctx.fillText(String(e.text || ''), 0, 0);
  ctx.restore();

  return true;
}
