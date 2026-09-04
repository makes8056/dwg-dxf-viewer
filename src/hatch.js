// hatch.js — ハッチング（塗りつぶし・斜線）を、ふつうの線に直す係（開発ルール38章）
//
// 【ハッチングとは】
//   CADで「この範囲を斜線で埋める」と指定したもの。
//   断面や壁を表すのに使う。DXFの中では **HATCH** という種類で入っている。
//
// 【この係の役目】
//   HATCHの中身（囲いの形と、模様の決まり）を読み取って、
//   **ふつうの線の並びに直す**だけ。
//   線に直してしまえば、あとは画面も紙（PDF）も、いつもの道で描ける。
//   新しい図形の種類を増やさずに済む（drawing.js の決まりを変えない）。
//
// 【模様の数字は、そのまま使ってよい】
//   HATCHには「模様の角度・間隔」が入っているが、これは
//   **すでに拡大率と回転を掛けたあとの値**である（実物の図面で確認した）。
//   コード52（角度）や41（拡大率）を重ねて掛けてはいけない。
//
// 【この係は画面に触らない】
//   ぜんぶ「数を入れて、数が返る」だけの関数なので、そのまま試験できる。

/** 1つのハッチで作る線の数の上限。壊れた図面で画面が固まるのを防ぐ安全装置。 */
export const MAX_HATCH_LINES = 4000;

/** 円弧・楕円弧を、何本の直線に分けるか（1周あたり）。 */
const ARC_STEPS = 48;

const rad = (deg) => (deg * Math.PI) / 180;

// ------------------------------------------------------------
// 囲いの形を、点の並び（多角形）に直す
// ------------------------------------------------------------

/**
 * 円弧を点の並びにする。
 * @param {number} cx 中心X
 * @param {number} cy 中心Y
 * @param {number} r 半径
 * @param {number} startDeg 始まりの角度
 * @param {number} endDeg 終わりの角度
 * @param {boolean} ccw 反時計回りか
 */
export function arcPoints(cx, cy, r, startDeg, endDeg, ccw = true) {
  let sweep = endDeg - startDeg;
  if (ccw) {
    while (sweep <= 0) sweep += 360;
  } else {
    while (sweep >= 0) sweep -= 360;
  }
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) / 360) * ARC_STEPS));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = rad(startDeg + (sweep * i) / steps);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/**
 * 楕円弧を点の並びにする（HATCHの囲いに出てくる形）。
 *
 * DXFの決まり：
 *   中心(cx,cy)、**長いほうの軸の先端（中心からの差）**(mx,my)、
 *   短い軸÷長い軸の比 ratio、始まりと終わりの角度。
 *   角度は「楕円をつぶす前の円」で測る（媒介変数）。
 */
export function ellipseArcPoints(cx, cy, mx, my, ratio, startDeg, endDeg, ccw = true) {
  const major = Math.hypot(mx, my);
  const minor = major * (ratio || 1);
  const tilt = Math.atan2(my, mx);
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  let sweep = endDeg - startDeg;
  if (ccw) {
    while (sweep <= 0) sweep += 360;
  } else {
    while (sweep >= 0) sweep -= 360;
  }
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) / 360) * ARC_STEPS));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = rad(startDeg + (sweep * i) / steps);
    const x = major * Math.cos(a);
    const y = minor * Math.sin(a);
    out.push([cx + x * cosT - y * sinT, cy + x * sinT + y * cosT]);
  }
  return out;
}

/**
 * 「ふくらみ（bulge）」つきの2点を、点の並びにする。
 * LWPOLYLINEと同じ決まり。ふくらみは「円弧の開き角の1/4のタンジェント」。
 */
export function bulgePoints(x1, y1, x2, y2, bulge) {
  if (!bulge) return [[x1, y1]];
  const theta = 4 * Math.atan(bulge);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const 弦 = Math.hypot(dx, dy);
  if (!(弦 > 0)) return [[x1, y1]];
  const r = 弦 / (2 * Math.sin(Math.abs(theta) / 2));
  // 弦の中点から、中心までの距離
  const h = Math.sqrt(Math.max(0, r * r - (弦 / 2) * (弦 / 2)));
  const 向き = bulge > 0 ? 1 : -1;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const ux = -dy / 弦;
  const uy = dx / 弦;
  const 中心x = mx + 向き * ux * h * (Math.abs(theta) > Math.PI ? -1 : 1);
  const 中心y = my + 向き * uy * h * (Math.abs(theta) > Math.PI ? -1 : 1);
  const a1 = Math.atan2(y1 - 中心y, x1 - 中心x);
  const steps = Math.max(2, Math.ceil((Math.abs(theta) / (2 * Math.PI)) * ARC_STEPS));
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = a1 + (theta * i) / steps;
    out.push([中心x + r * Math.cos(a), 中心y + r * Math.sin(a)]);
  }
  return out;
}

// ------------------------------------------------------------
// 模様の線を作って、囲いの中だけ残す
// ------------------------------------------------------------

/**
 * 多角形の集まりの、外側を囲む四角を求める。
 * @param {Array<Array<Array<number>>>} polygons
 */
export function polygonsBounds(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * まっすぐな線を、多角形の集まりで切り取る。
 *
 * 「線が囲いの辺を何回またいだか」で内と外を決める（偶数なら外、奇数なら中）。
 * CADのハッチングも同じ考え方なので、穴のあいた形（ドーナツ）も正しく抜ける。
 *
 * @param {{x:number,y:number}} origin 線の通る点
 * @param {{x:number,y:number}} dir 線の向き（長さ1）
 * @param {Array<Array<Array<number>>>} polygons 囲い
 * @returns {Array<Array<number>>} 中に入っている区間の [はじまり, おわり]（線の上の距離）
 */
export function clipLineByPolygons(origin, dir, polygons) {
  const ts = [];
  for (const poly of polygons) {
    const n = poly.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      // 線から見て、辺の両端がどちら側にあるか（外積の符号）
      const sa = dir.x * (a[1] - origin.y) - dir.y * (a[0] - origin.x);
      const sb = dir.x * (b[1] - origin.y) - dir.y * (b[0] - origin.x);
      // 「片方が線より下、もう片方が線の上か線上」のときだけ1回と数える。
      // こうしないと、頂点がちょうど線に乗ったときに2回数えてしまう
      const 交わる = (sa < 0 && sb >= 0) || (sb < 0 && sa >= 0);
      if (!交わる) continue;
      const 割合 = sa / (sa - sb);
      const x = a[0] + (b[0] - a[0]) * 割合;
      const y = a[1] + (b[1] - a[1]) * 割合;
      ts.push((x - origin.x) * dir.x + (y - origin.y) * dir.y);
    }
  }
  if (ts.length < 2) return [];
  ts.sort((p, q) => p - q);
  const spans = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    if (ts[i + 1] - ts[i] > 1e-9) spans.push([ts[i], ts[i + 1]]);
  }
  return spans;
}

/**
 * 区間を、破線の決まりで細切れにする。
 * 決まり：正の数＝描く長さ、負の数＝あけ、0＝点。
 */
export function applyDashes(span, dashes, phase = 0) {
  const [start, end] = span;
  if (!dashes || dashes.length === 0) return [[start, end]];
  const 一周 = dashes.reduce((a, d) => a + Math.abs(d) || a, 0);
  if (!(一周 > 0)) return [[start, end]];

  const out = [];
  // 区間の始まりが、模様のどこに当たるかを求める
  let 位置 = start;
  let ずれ = ((phase % 一周) + 一周) % 一周;
  let i = 0;
  // 模様の途中から始める
  while (ずれ > 0 && i < 1000) {
    const 長さ = Math.abs(dashes[i % dashes.length]) || 0;
    if (ずれ < 長さ) break;
    ずれ -= 長さ;
    i++;
  }
  let 残り = (Math.abs(dashes[i % dashes.length]) || 0) - ずれ;
  let 安全 = 0;
  while (位置 < end && 安全++ < 20000) {
    const 描く = (dashes[i % dashes.length] || 0) >= 0;
    const 次 = Math.min(end, 位置 + (残り > 0 ? 残り : 0.0001));
    if (描く && 次 > 位置) out.push([位置, 次]);
    位置 = 次;
    i++;
    残り = Math.abs(dashes[i % dashes.length]) || 0.0001;
  }
  return out;
}

/**
 * ハッチング1つぶんの線を作る。
 *
 * @param {Array<Array<Array<number>>>} polygons 囲い（点の並びの集まり）
 * @param {Array<object>} patternLines 模様の決まり
 *        { angleDeg, baseX, baseY, offsetAlong, offsetAcross, dashes }
 * @param {object} [options] { maxLines }
 * @returns {Array<Array<number>>} [x1, y1, x2, y2] の並び
 */
export function hatchToLines(polygons, patternLines, options = {}) {
  const maxLines = options.maxLines || MAX_HATCH_LINES;
  const bounds = polygonsBounds(polygons);
  if (!bounds || !Array.isArray(patternLines) || patternLines.length === 0) return [];

  // 囲いをすっぽり覆う円の半径（どの向きの線でも、これだけあれば足りる）
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const 半径 = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2 + 1;

  const out = [];
  for (const pat of patternLines) {
    const a = rad(pat.angleDeg || 0);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // 線と直角の向き
    const nx = -uy;
    const ny = ux;

    // 線と線の間隔（直角方向）。0だと無限に線ができるので必ず確かめる
    const 間隔 = Math.abs(pat.offsetAcross || 0);
    if (!(間隔 > 1e-9)) continue;

    // 基準の線から見て、囲いの中心はどれだけ直角方向に離れているか
    const 中心のずれ = (cx - (pat.baseX || 0)) * nx + (cy - (pat.baseY || 0)) * ny;
    const 符号 = (pat.offsetAcross || 0) >= 0 ? 1 : -1;
    const k中央 = Math.round((中心のずれ / 間隔) * 符号);
    const k幅 = Math.ceil(半径 / 間隔) + 1;

    for (let k = k中央 - k幅; k <= k中央 + k幅; k++) {
      if (out.length >= maxLines) return out;
      // k本目の線が通る点
      const ox = (pat.baseX || 0) + k * ((pat.offsetAlong || 0) * ux + (pat.offsetAcross || 0) * nx);
      const oy = (pat.baseY || 0) + k * ((pat.offsetAlong || 0) * uy + (pat.offsetAcross || 0) * ny);
      const spans = clipLineByPolygons({ x: ox, y: oy }, { x: ux, y: uy }, polygons);
      for (const span of spans) {
        const 細切れ = applyDashes(span, pat.dashes, 0);
        for (const [t1, t2] of 細切れ) {
          if (out.length >= maxLines) return out;
          out.push([ox + ux * t1, oy + uy * t1, ox + ux * t2, oy + uy * t2]);
        }
      }
    }
  }
  return out;
}
