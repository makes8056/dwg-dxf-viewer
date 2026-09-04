// measure.js — 図面の上で長さを測る計算（開発ルール39章）
//
// 【この係の役目】
//   - 指でタップした場所の近くにある「きりのよい点」を探す（吸い付き＝スナップ）
//   - 2点の間の長さ・向きを求める
//   - 画面に出す文字にする
//   の3つだけ。画面には一切触らないので、そのまま試験できる。
//
// 【なぜ「吸い付き」が要るのか】
//   指で正確な位置をタップするのは無理である。
//   1ミリずれただけで、測った長さも1ミリ狂う。**それでは現場で使えない。**
//   そこで、タップした場所の近くにある
//     線の端・線の真ん中・円の中心・円周の上下左右・点
//   のうち、いちばん近いものへ吸い付かせる。
//   これで「線の端から端まで」を正確に測れる。

/** 吸い付く範囲（画面のピクセル）。指の太さを考えて、少し広めにとる。 */
export const SNAP_RADIUS_PX = 34;

/**
 * DXFの $INSUNITS の数字を、このアプリの単位名にする（開発ルール39.2）。
 *
 * 0（単位なし）や、知らない数字のときは 'mm' とみなす。
 * 日本の建築・設備の図面はミリで描くのがふつうで、実物の図面もそうだった。
 */
export function insunitsToUnits(code) {
  switch (Number(code)) {
    case 1: return 'inch';
    case 2: return 'feet';
    case 4: return 'mm';
    case 5: return 'cm';
    case 6: return 'm';
    default: return 'mm';
  }
}

/** 単位の見せ方。 */
export function unitLabel(units) {
  switch (units) {
    case 'inch': return 'インチ';
    case 'feet': return 'フィート';
    case 'cm': return 'cm';
    case 'm': return 'm';
    default: return 'mm';
  }
}

/**
 * 長さを、読みやすい文字にする。
 * 大きい数は3桁ごとに区切り、細かさは大きさに合わせて変える。
 */
export function formatLength(value, units = 'mm') {
  if (!Number.isFinite(value)) return '—';
  const 桁 = Math.abs(value) >= 100 ? 1 : 2;
  const 丸めた = Number(value.toFixed(桁));
  const [整数部, 小数部] = 丸めた.toFixed(桁).split('.');
  const 区切り = 整数部.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const 数 = 小数部 && Number(小数部) !== 0 ? `${区切り}.${小数部}` : 区切り;
  return `${数} ${unitLabel(units)}`;
}

/** 角度を、0〜360度の読みやすい文字にする。 */
export function formatAngle(deg) {
  if (!Number.isFinite(deg)) return '—';
  const a = ((deg % 360) + 360) % 360;
  return `${a.toFixed(1)}°`;
}

/**
 * 2点の間の長さと向きを求める。
 * @returns {{distance:number, dx:number, dy:number, angleDeg:number}}
 */
export function measureBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    distance: Math.hypot(dx, dy),
    dx,
    dy,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

// ------------------------------------------------------------
// 吸い付く先の点を探す
// ------------------------------------------------------------

/**
 * 1つの図形について、吸い付く先になる点を1つずつ渡す。
 *
 * 何を吸い付く先にするかは、CADの「オブジェクトスナップ」に合わせている。
 *   線     … 両端と真ん中
 *   折れ線 … すべての角
 *   円     … 中心と、上下左右の4点
 *   円弧   … 中心と両端
 *   楕円   … 中心
 *   点     … その点
 *   文字   … 吸い付かない（形が無いため）
 */
export function forEachSnapPoint(e, fn) {
  if (!e || !e.type) return;
  switch (e.type) {
    case 'line':
      fn(e.x1, e.y1, '端');
      fn(e.x2, e.y2, '端');
      fn((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, '真ん中');
      return;
    case 'polyline':
      if (!Array.isArray(e.points)) return;
      for (const p of e.points) fn(p[0], p[1], '角');
      return;
    case 'circle':
      fn(e.cx, e.cy, '中心');
      fn(e.cx + e.r, e.cy, '円周');
      fn(e.cx - e.r, e.cy, '円周');
      fn(e.cx, e.cy + e.r, '円周');
      fn(e.cx, e.cy - e.r, '円周');
      return;
    case 'arc': {
      fn(e.cx, e.cy, '中心');
      const rad = (d) => (d * Math.PI) / 180;
      fn(e.cx + e.r * Math.cos(rad(e.startAngle)), e.cy + e.r * Math.sin(rad(e.startAngle)), '端');
      fn(e.cx + e.r * Math.cos(rad(e.endAngle)), e.cy + e.r * Math.sin(rad(e.endAngle)), '端');
      return;
    }
    case 'ellipse':
      fn(e.cx, e.cy, '中心');
      return;
    case 'point':
      fn(e.x, e.y, '点');
      return;
    default:
      // 文字などは吸い付かない
  }
}

/**
 * タップした場所のいちばん近くにある「きりのよい点」を探す。
 *
 * 見つからなければ null を返す。**そのときは吸い付かせず、
 * タップした場所をそのまま使う**（呼び出し側の判断）。
 *
 * 図形の数が多い図面でも重くならないよう、
 * まず「探す四角」の外にある図形をざっと外してから調べる。
 *
 * @param {Array<object>} entities 図形
 * @param {number} x タップした場所（図面の座標）
 * @param {number} y
 * @param {number} maxDist 吸い付く範囲（図面の座標での長さ）
 * @returns {{x:number, y:number, kind:string}|null}
 */
export function findSnapPoint(entities, x, y, maxDist) {
  if (!Array.isArray(entities) || !(maxDist > 0)) return null;
  let best = null;
  let bestD2 = maxDist * maxDist;

  for (const e of entities) {
    if (!近くにあるか(e, x, y, maxDist)) continue;
    forEachSnapPoint(e, (px, py, kind) => {
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      const d2 = (px - x) * (px - x) + (py - y) * (py - y);
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = { x: px, y: py, kind };
      }
    });
  }
  return best;
}

/** その図形は、探す四角の近くにあるか（重い計算をする前のふるい分け）。 */
function 近くにあるか(e, x, y, r) {
  const 入る = (x1, y1, x2, y2) =>
    Math.min(x1, x2) - r <= x && Math.max(x1, x2) + r >= x &&
    Math.min(y1, y2) - r <= y && Math.max(y1, y2) + r >= y;

  switch (e.type) {
    case 'line': return 入る(e.x1, e.y1, e.x2, e.y2);
    case 'polyline': {
      if (!Array.isArray(e.points) || !e.points.length) return false;
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [px, py] of e.points) {
        if (px < a) a = px; if (px > c) c = px;
        if (py < b) b = py; if (py > d) d = py;
      }
      return 入る(a, b, c, d);
    }
    case 'circle':
    case 'arc': {
      const rr = Math.abs(e.r || 0);
      return 入る(e.cx - rr, e.cy - rr, e.cx + rr, e.cy + rr);
    }
    case 'ellipse': return 入る(e.cx, e.cy, e.cx, e.cy);
    case 'point': return 入る(e.x, e.y, e.x, e.y);
    default: return false;
  }
}
