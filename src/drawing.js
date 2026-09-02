// drawing.js — 図形データの「形」の決まりごと（開発ルール10章）
//
// このアプリでいちばん大事なファイルです。
//
// DXFを読む係（dxf-parse.js）と、DWGを読む係（dwg-parse.js）は、
// どちらも **このファイルに書かれた同じ形** のデータを返します。
// 描く係（render.js）・印刷する係（print-area.js）・寸法を測る係（measure.js）は、
// 元がDXFだったかDWGだったかを一切知りません。
//
// こうしておく理由：
//   - DWG読み込み（GPLの部品を使う部分）を、後から丸ごと外せる
//   - 片方の形式が壊れても、もう片方は動き続ける
//   - 描く側を単純に保てる（単純なほど事故が少ない）
//
// 【形（v1）】
//   {
//     units: 'mm',
//     bounds: { minX, minY, maxX, maxY },   // 図面全体の範囲。図形が無いときは null
//     layers: [ { name, color } ],          // レイヤー一覧（v1では表示切替はしない）
//     entities: [ ...下の ENTITY_TYPES のどれか... ],
//     unsupported: { count, kinds },        // 表示できなかった図形の数と種類（10.5）
//     source: 'dxf' | 'dwg',                // どちらから読んだか（画面表示と不具合調査用）
//   }

// ------------------------------------------------------------
// 図形の種類。ここに無いものは entities に入れず、unsupported に数える（開発ルール10.5）。
//
//   line     … 直線            { x1, y1, x2, y2 }
//   polyline … 折れ線          { points: [[x,y], ...], closed }
//   arc      … 円弧            { cx, cy, r, startAngle, endAngle }  角度は度。反時計回り
//   circle   … 円              { cx, cy, r }
//   ellipse  … 楕円            { cx, cy, rx, ry, rotation, startAngle, endAngle }
//              rx … 長いほうの半径   ry … 短いほうの半径
//              rotation … 長いほうの軸が何度傾いているか（度）
//              startAngle/endAngle … 楕円のどこからどこまで描くか（度）
//   text     … 文字            { x, y, height, rotation, text, hAlign, vAlign }
//              hAlign … 書き出す点の左端/中央/右端のどこに置くか left|center|right
//              vAlign … 上/中/下のどこに置くか top|middle|bottom|baseline
//              寸法の数字は中央ぞろえ。無視すると寸法線から数字がずれる
//
// すべての図形が共通して持つもの： type, layer, color
//   layer … レイヤー名（文字列）
//   color … CSS の色文字列。**白い背景で見える色にすでに変換済み**（下の aciToCss を参照）
// ------------------------------------------------------------
export const ENTITY_TYPES = ['line', 'polyline', 'arc', 'circle', 'ellipse', 'text'];

// ------------------------------------------------------------
// 色の変換
//
// CADの色は「色番号（1〜255）」で指定されます。
// CADの画面は背景が黒なので、番号7は「白」です。
// このアプリは背景を白にします（紙に印刷する前提で、屋外でも見やすいため）。
// そのまま白で描くと**線が消えてしまう**ので、白は黒に置き換えます。
//
// 番号1〜9と250〜255は、CADで昔から決まっている色をそのまま使います。
// 番号10〜249は、色相をぐるっと24等分した表になっており、
// ここでは同じ考え方で計算して近い色を作ります（完全一致ではありません）。
// 図面を「見る」用途では線の色の細かな差より、線がはっきり見えることを優先します。
// ------------------------------------------------------------

// 番号0〜9（CADで固定されている基本色）
const ACI_BASIC = {
  0: '#000000', // BYBLOCK（親のブロックに従う）。展開後は黒として扱う
  1: '#ff0000', // 赤
  2: '#ffff00', // 黄 → 白背景では見づらいので下で暗くする
  3: '#00ff00', // 緑 → 同上
  4: '#00ffff', // 水色 → 同上
  5: '#0000ff', // 青
  6: '#ff00ff', // 紫
  7: '#000000', // CADでは白。白背景では見えないので黒にする
  8: '#808080', // 濃い灰
  9: '#c0c0c0', // 薄い灰
};

// 番号250〜255（灰色の段階）
const ACI_GRAY = {
  250: '#333333',
  251: '#505050',
  252: '#696969',
  253: '#828282',
  254: '#bebebe',
  255: '#ffffff', // 白 → 黒にする
};

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// 明るすぎる色を、白い背景でも見えるところまで暗くする。
// 人の目の感じ方に合わせた明るさ（輝度）で判定する。
function darkenForWhiteBackground(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const LIMIT = 0.62; // これより明るいと白背景で見えにくい
  if (luminance <= LIMIT || luminance === 0) return hex;
  const scale = LIMIT / luminance;
  const to = (n) => Math.round(n * scale).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * CADの色番号を、白い背景で見えるCSSの色文字列に変換する。
 * @param {number} aci 色番号（0〜255）
 * @returns {string} 例 '#ff0000'
 */
export function aciToCss(aci) {
  const n = Number(aci);
  if (!Number.isFinite(n)) return '#000000';
  if (n === 7 || n === 255) return '#000000'; // CADの白は黒にする
  if (ACI_BASIC[n] !== undefined) return darkenForWhiteBackground(ACI_BASIC[n]);
  if (ACI_GRAY[n] !== undefined) return darkenForWhiteBackground(ACI_GRAY[n]);
  if (n >= 10 && n <= 249) {
    const group = Math.floor((n - 10) / 10);   // 0〜23：色相のグループ
    const step = (n - 10) % 10;                // 0〜9：明るさと鮮やかさの段階
    const hue = (group * 15) % 360;
    const saturation = step % 2 === 0 ? 1.0 : 0.5;
    const value = [1.0, 1.0, 0.75, 0.75, 0.55, 0.55, 0.4, 0.4, 0.28, 0.28][step];
    return darkenForWhiteBackground(hsvToRgb(hue, saturation, value));
  }
  return '#000000';
}

/**
 * 24ビットのRGB値（DXFのtrue color・DWGのtrue color）をCSSの色文字列にする。
 * @param {number} rgb 例 0xff0000
 */
export function rgbToCss(rgb) {
  const n = Number(rgb) & 0xffffff;
  const hex = `#${n.toString(16).padStart(6, '0')}`;
  return darkenForWhiteBackground(hex);
}

// ------------------------------------------------------------
// 図形データの入れ物を作る・仕上げる
// ------------------------------------------------------------

/**
 * からっぽの図形データを作る。読み込み係はこれに entities を足していく。
 * @param {'dxf'|'dwg'} source
 */
export function createDrawing(source) {
  return {
    units: 'mm',
    bounds: null,
    layers: [],
    entities: [],
    unsupported: { count: 0, kinds: {} },
    source,
  };
}

/**
 * 表示できなかった図形を数える（開発ルール10.5：黙って捨てない）。
 * @param {object} drawing
 * @param {string} kind 元の図形の名前（例 'SPLINE'）
 */
export function countUnsupported(drawing, kind) {
  drawing.unsupported.count += 1;
  const key = String(kind || '不明');
  drawing.unsupported.kinds[key] = (drawing.unsupported.kinds[key] || 0) + 1;
}

/**
 * 読み込みの最後に呼ぶ。図面の範囲を計算して入れる。
 * @param {object} drawing
 * @returns {object} 同じ drawing（呼び出し側が続けて使えるように返す）
 */
export function finishDrawing(drawing) {
  drawing.bounds = computeBounds(drawing.entities);
  const content = computeContentBounds(drawing.entities);
  drawing.contentBounds = content.bounds;
  drawing.outliers = content.outliers;
  return drawing;
}

/**
 * 図形1つが占める範囲を求める。
 * @param {object} e
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}|null}
 */
export function entityBounds(e) {
  return computeBounds([e]);
}

/**
 * 「図面の本体」がある範囲を求める。
 *
 * 【実際の図面で起きた不具合】
 * お客様の参考図.dxf には、図面本体から**とんでもなく離れた場所に図形**が
 * いくつかありました（本体は X 684〜2186 なのに、X = -141489 に図形がある）。
 * CADの図面ではよくあることです（消し忘れた線、別の用紙の名残など）。
 *
 * 全部を画面に収めようとすると、そのはぐれ図形に引っぱられて
 * **図面本体が5ピクセルほどの点になり、真っ白にしか見えません。** 実際にそうなりました。
 *
 * そこで「多くの図形が集まっている場所」を図面の本体とみなします。
 * 判定はとても控えめにしてあります：
 *   - 98%の図形が収まる距離を測り、**その10倍より遠いものだけ**を、はぐれ図形とする
 *   - 図面枠のように4隅にしかない図形を、うっかり切り落とさないための余裕です
 *
 * @param {Array} entities
 * @returns {{bounds:object|null, outliers:number}} 本体の範囲と、はぐれ図形の数
 */
export function computeContentBounds(entities) {
  const boxes = [];
  for (const e of entities) {
    const b = computeBounds([e]);
    if (b) boxes.push(b);
  }
  if (boxes.length === 0) return { bounds: null, outliers: 0 };

  const centers = boxes.map((b) => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
  const mid = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const cx = mid(centers.map((c) => c[0]));
  const cy = mid(centers.map((c) => c[1]));

  // 図面の真ん中から、縦横どちらかで何マス離れているか
  const dists = centers.map((c) => Math.max(Math.abs(c[0] - cx), Math.abs(c[1] - cy)));
  const sorted = [...dists].sort((a, b) => a - b);
  const d98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];

  // 「98%が収まる距離」の10倍より遠いものだけを、はぐれ図形とみなす（かなり控えめ）
  const limit = d98 * 10;

  const kept = [];
  let outliers = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (dists[i] <= limit) kept.push(boxes[i]);
    else outliers++;
  }
  if (kept.length === 0) return { bounds: computeBounds(entities), outliers: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of kept) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { bounds: { minX, minY, maxX, maxY }, outliers };
}

/**
 * 図形の集まりが占める範囲を求める。
 * 図面全体を画面に収めるとき（初期表示）と、印刷範囲の計算に使う。
 * @param {Array} entities
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}|null} 図形が無ければ null
 */
export function computeBounds(entities) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const put = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const e of entities) {
    switch (e.type) {
      case 'line':
        put(e.x1, e.y1); put(e.x2, e.y2);
        break;
      case 'polyline':
        for (const p of e.points) put(p[0], p[1]);
        break;
      case 'circle':
        put(e.cx - e.r, e.cy - e.r); put(e.cx + e.r, e.cy + e.r);
        break;
      case 'arc':
        // 円弧は、両端の点と、円弧が実際に通る 0/90/180/270 度の点だけを見れば範囲が決まる。
        // 円まるごとで計算すると範囲が広くなりすぎ、図面が小さく表示されてしまう。
        for (const p of arcExtremePoints(e)) put(p[0], p[1]);
        break;
      case 'ellipse':
        // 楕円は、輪郭の上の点をいくつか拾って範囲を決める。
        // きっちり計算する式もあるが、傾いた楕円だと複雑になるうえ、
        // 用途（全体表示と、画面の外にあるかの判定）には点を拾えば十分。
        for (const p of ellipsePoints(e)) put(p[0], p[1]);
        break;
      case 'text':
        // 文字は、書き出しの点と、おおよその文字幅ぶんを範囲に入れる。
        put(e.x, e.y);
        put(e.x + (e.height || 0) * String(e.text || '').length * 0.7, e.y + (e.height || 0));
        break;
      default:
        break;
    }
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * 円弧の範囲を決める点を集める（両端 ＋ 実際に通る 0/90/180/270 度の点）。
 * @param {object} arc { cx, cy, r, startAngle, endAngle } 角度は度、反時計回り
 * @returns {Array<Array<number>>}
 */
export function arcExtremePoints(arc) {
  const { cx, cy, r } = arc;
  const rad = (d) => (d * Math.PI) / 180;
  const at = (d) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))];

  const start = normalizeAngle(arc.startAngle);
  const end = normalizeAngle(arc.endAngle);
  const points = [at(start), at(end)];

  // start から end へ反時計回りに進む間に通る 0/90/180/270 度を拾う
  const sweep = normalizeAngle(end - start) || 360;
  for (const d of [0, 90, 180, 270]) {
    const offset = normalizeAngle(d - start);
    if (offset <= sweep) points.push(at(d));
  }
  return points;
}

/**
 * 楕円の輪郭の上の点を、等間隔に拾う。
 *
 * 範囲の計算（全体表示・画面の外かの判定）に使う。
 * きっちりした式もあるが、傾いた楕円では複雑になり、間違えたときに気づきにくい。
 * 用途からすると点を拾えば十分な精度が出るので、こちらにしている。
 *
 * @param {object} e { cx, cy, rx, ry, rotation, startAngle, endAngle } 角度は度
 * @param {number} steps いくつに分けるか
 * @returns {Array<Array<number>>}
 */
export function ellipsePoints(e, steps = 48) {
  const points = [];
  const start = normalizeAngle(e.startAngle);
  // 始まりと終わりが同じなら、ぐるっと一周（まるごとの楕円）
  const sweep = normalizeAngle(e.endAngle - e.startAngle) || 360;

  const rot = ((e.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rx = e.rx || 0;
  const ry = e.ry || 0;

  for (let i = 0; i <= steps; i++) {
    const t = ((start + (sweep * i) / steps) * Math.PI) / 180;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    // 傾きぶん回してから、中心の位置へずらす
    points.push([e.cx + x * cos - y * sin, e.cy + x * sin + y * cos]);
  }
  return points;
}

/** 角度を 0〜360 度の範囲に直す。 */
export function normalizeAngle(deg) {
  let d = Number(deg) % 360;
  if (d < 0) d += 360;
  return d;
}

/**
 * 範囲に余白を足す。図面全体を表示するとき、画面の端にくっつかないようにする。
 * @param {object} bounds
 * @param {number} ratio 余白の割合（0.05 なら5%）
 */
export function padBounds(bounds, ratio = 0.05) {
  if (!bounds) return null;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  // 幅か高さが0（線1本だけの図面など）でも余白が付くように、最低値を用意する
  const px = (w || h || 1) * ratio;
  const py = (h || w || 1) * ratio;
  return {
    minX: bounds.minX - px,
    minY: bounds.minY - py,
    maxX: bounds.maxX + px,
    maxY: bounds.maxY + py,
  };
}
