// dxf-parse.js — DXF（文字形式）を読んで、drawing.js の形の図形データにする係
//
// この係が知っているのはDXFの決まりごとだけ。
// 描く・印刷する・寸法を測る側は、この係の中身を一切知らない（開発ルール10.1）。
//
// 大まかな流れ：
//   1. 行の並び（グループコード・値のペア）に分ける
//   2. TABLES（レイヤー一覧）・BLOCKS（部品の定義）・ENTITIES（実際の図形）を拾う
//   3. INSERT（部品の配置）は、その場で line / arc などに展開する（開発ルール10.4）
//   4. 色は drawing.js の aciToCss() / rgbToCss() だけを使う（色の表はここでは作らない）
//
// 対応できない図形（SPLINE・HATCHなど）は countUnsupported() で数える（10.5：黙って捨てない）。

import {
  createDrawing,
  finishDrawing,
  countUnsupported,
  aciToCss,
  rgbToCss,
  normalizeAngle,
} from './drawing.js';
import {
  arcPoints,
  ellipseArcPoints,
  bulgePoints,
  hatchToLines,
} from './hatch.js';

// ============================================================
// 文字コードの変換（バイト列 → 文字列）
// ============================================================

/**
 * DXFファイルのバイト列を、正しい文字コードで文字列にする。
 *
 * 【実際の図面で起きた不具合。ここを間違えると日本語が全部化けます】
 *
 * DXFのヘッダーには「この図面の文字コードは何か」を書く欄（$DWGCODEPAGE）があります。
 * ところが **新しいAutoCADは、ここに ANSI_932（Shift-JIS）と書いたまま、
 * 中身をUTF-8で保存します。** 申告と中身が違うのです。
 * お客様の参考図.dxf がまさにこれで、申告を信じた結果
 * レイヤー名「図面枠」が「蝗ｳ髱｢譫」のように化けました。
 *
 * そこで、申告を鵜呑みにせず、次の順で決めます。
 *   1. DXFの版が AC1021（AutoCAD 2007）以降なら、**決まりとしてUTF-8**。申告は見ない
 *   2. それより古い版でも、バイト列がUTF-8として矛盾なく読めるならUTF-8
 *      （日本語のShift-JISは、UTF-8として読むとほぼ必ず矛盾が出るため見分けられます）
 *   3. UTF-8として読めないなら、Shift-JISとして読む
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
export function decodeDxfBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // 壊れた文字をそのまま置き換えて読む版（判定と、最後の頼みの綱に使う）
  const lossyUtf8 = new TextDecoder('utf-8').decode(bytes);

  // 1. 版が新しければ、無条件にUTF-8
  if (isUtf8ByVersion(lossyUtf8)) return lossyUtf8;

  // 2. バイト列がUTF-8として矛盾なく読めるか厳しく確かめる
  let strictUtf8 = null;
  try {
    strictUtf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    strictUtf8 = null; // UTF-8としては読めない＝別の文字コード
  }
  if (strictUtf8 !== null) return strictUtf8;

  // 3. UTF-8として読めなかった。申告がShift-JISなら、あるいは申告が無くても
  //    日本語の古い図面はShift-JISのことがほとんどなので、Shift-JISとして読む
  const codepage = findCodepage(lossyUtf8);
  if (!codepage || isShiftJisCodepage(codepage)) {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return lossyUtf8; // Shift-JISが使えない環境なら諦める
    }
  }
  return lossyUtf8;
}

// DXFの版（$ACADVER）が AC1021（AutoCAD 2007）以降かどうか。
// この版から、DXFの文字は必ずUTF-8で書かれる決まりになった。
// $DWGCODEPAGE の欄は残っているが、中身と食い違うことがあるので信用しない。
function isUtf8ByVersion(text) {
  const m = text.match(/\$ACADVER\s*[\r\n]+\s*1\s*[\r\n]+\s*AC(\d{4})/);
  if (!m) return false;
  return Number(m[1]) >= 1021;
}

// $DWGCODEPAGE の値（例 "ANSI_932"）をヘッダーの中から探す。
// まだ正式にトークン分けする前の、ざっくりした文字列検索でよい
// （$DWGCODEPAGE の値には日本語が混ざりようがないため、UTF-8のまま読んでも壊れない）。
function findCodepage(text) {
  const m = text.match(/\$DWGCODEPAGE\s*[\r\n]+\s*3\s*[\r\n]+\s*([A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

function isShiftJisCodepage(codepage) {
  // ANSI_932 が日本語Windows（Shift-JIS）の合図
  return /^ANSI_932$/i.test(codepage);
}

// ============================================================
// 行の並び（グループコード・値のペア）に分ける
// ============================================================

// バイナリDXF（今回は非対応）の目印
const BINARY_DXF_MARKER = 'AutoCAD Binary DXF';

function isBinaryDxf(text) {
  // バイナリDXFはファイルの先頭がこの文字列（+ 改行 + 制御バイト）で始まる
  return text.slice(0, BINARY_DXF_MARKER.length) === BINARY_DXF_MARKER;
}

/**
 * 文字形式のDXFを「グループコード・値」のペアの並びにする。
 * 壊れている／途中で切れている場合は、読めたところまでを返す。
 * @param {string} text
 * @returns {Array<[number, string]>}
 */
function tokenize(text) {
  // \r\n と \r 単独（古いMac形式）の両方を \n に揃える（落とし穴3）
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');

  const pairs = [];
  // 末尾に空行が残っていても無視できるよう、2行ずつ組みにできる分だけ読む
  const pairCount = Math.floor(rawLines.length / 2);
  for (let i = 0; i < pairCount; i++) {
    const codeLine = rawLines[i * 2].trim();
    const code = parseInt(codeLine, 10);
    if (!Number.isFinite(code)) {
      // グループコードとして読めない行が出てきたら、ここでファイルが壊れている。
      // それまで読めた分だけを返す（落とし穴7：落ちずにそこまで返す）。
      break;
    }
    const value = rawLines[i * 2 + 1];
    pairs.push([code, value]);
  }
  return pairs;
}

// ============================================================
// 数値の取り出し
// ============================================================

function num(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// ============================================================
// 1つの「レコード」（0で始まり、次の0の手前まで）を読む
// ============================================================

/**
 * pairs[idx] が (0, 種類名) を指している前提で、そのレコードの中身をまとめて読む。
 * @returns {{ type:string, groups:Array<[number,string]>, nextIndex:number }}
 */
function readRecord(pairs, idx) {
  const type = String(pairs[idx][1]).trim();
  const groups = [];
  let i = idx + 1;
  while (i < pairs.length && pairs[i][0] !== 0) {
    groups.push(pairs[i]);
    i++;
  }
  return { type, groups, nextIndex: i };
}

// groups の中から、指定コードの最初の値を返す（無ければ undefined）
function firstValue(groups, code) {
  for (const [c, v] of groups) {
    if (c === code) return v;
  }
  return undefined;
}

// ============================================================
// セクション（SECTION〜ENDSEC）を仕分ける
// ============================================================

/**
 * DXF全体を読んで、レイヤー一覧・ブロック定義・ENTITIESセクションの生レコードを集める。
 * @param {Array<[number,string]>} pairs
 */
function collectSections(pairs) {
  const layers = new Map(); // name -> { name, color }
  const blocks = new Map(); // name -> { name, base:{x,y}, records: [...] }
  const topEntityRecords = [];

  let i = 0;
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && String(value).trim() === 'SECTION') {
      i++;
      let sectionName = '';
      if (i < pairs.length && pairs[i][0] === 2) {
        sectionName = String(pairs[i][1]).trim();
        i++;
      }
      if (sectionName === 'TABLES') {
        i = parseTablesSection(pairs, i, layers);
      } else if (sectionName === 'BLOCKS') {
        i = parseBlocksSection(pairs, i, blocks);
      } else if (sectionName === 'ENTITIES') {
        i = parseEntitiesSection(pairs, i, topEntityRecords);
      } else {
        i = skipToEndSec(pairs, i);
      }
    } else if (code === 0 && String(value).trim() === 'EOF') {
      break;
    } else {
      i++;
    }
  }

  return { layers, blocks, topEntityRecords };
}

function skipToEndSec(pairs, i) {
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && String(value).trim() === 'ENDSEC') return i + 1;
    i++;
  }
  return i; // 途中で切れていた
}

function parseTablesSection(pairs, i, layers) {
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && String(value).trim() === 'ENDSEC') return i + 1;

    if (code === 0 && String(value).trim() === 'TABLE') {
      i++;
      let tableName = '';
      if (i < pairs.length && pairs[i][0] === 2) {
        tableName = String(pairs[i][1]).trim();
        i++;
      }
      if (tableName === 'LAYER') {
        i = parseLayerTable(pairs, i, layers);
      } else {
        i = skipToEndTab(pairs, i);
      }
      continue;
    }
    i++;
  }
  return i;
}

function skipToEndTab(pairs, i) {
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && String(value).trim() === 'ENDTAB') return i + 1;
    i++;
  }
  return i;
}

function parseLayerTable(pairs, i, layers) {
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && String(value).trim() === 'ENDTAB') return i + 1;
    if (code === 0 && String(value).trim() === 'LAYER') {
      const rec = readRecord(pairs, i);
      const name = firstValue(rec.groups, 2);
      if (name !== undefined) {
        const colorRaw = firstValue(rec.groups, 62);
        const trueColor = firstValue(rec.groups, 420);
        let color;
        if (trueColor !== undefined) {
          color = rgbToCss(num(trueColor));
        } else {
          // マイナスの色番号＝レイヤーを非表示にする合図。色そのものは絶対値を使う
          const colorNumber = colorRaw === undefined ? 7 : Math.abs(num(colorRaw, 7));
          color = aciToCss(colorNumber);
        }
        // レイヤーが画面に出るかどうか。CADで消してあるものは、ここでも出さない。
        //   - 色番号がマイナス … そのレイヤーは「非表示（OFF）」
        //   - 70の1のビットが立っている … そのレイヤーは「凍結（FROZEN）」
        // どちらもCADの画面には出ないので、このアプリでも出さない。
        const layerFlags = num(firstValue(rec.groups, 70), 0);
        const isOff = colorRaw !== undefined && num(colorRaw, 7) < 0;
        const isFrozen = (layerFlags & 1) === 1;
        const visible = !isOff && !isFrozen;

        // 前後の空白を取り除いてから登録する。
        // 図形の側（getLayerName）も取り除いた名前で引くので、両方そろえないと
        // **色も表示・非表示も引けなくなる**（図面が真っ黒になる／消えるはずのものが出る）。
        const key = String(name).trim();
        // off と frozen を分けて覚えておく。
        // あとで「全部のレイヤーが非表示」というありえない状態を直すのに使う（34章）
        layers.set(key, { name: key, color, visible, off: isOff, frozen: isFrozen });
      }
      i = rec.nextIndex;
      continue;
    }
    i++;
  }
  return i;
}

/**
 * 【全部のレイヤーが「非表示」になっている図面を直す（開発ルール34章）】
 *
 * DXFでは、レイヤーの色番号（62）がマイナスなら「そのレイヤーは非表示」という決まり。
 * ところが**DWGから変換したDXFでは、全部のレイヤーの色がマイナスで出てくる。**
 *
 *   同じ図面で実際に比べた結果：
 *     AutoCADが書き出したDXF … 0番=7  DIM=3  PIPE=1  （全部プラス）
 *     DWGから変換したDXF     … 0番=-7 DIM=-3 PIPE=-1（全部マイナス。色の値は同じ）
 *
 * 全部のレイヤーが非表示の図面は**ありえない**（何も映らない紙と同じ）。
 * そういうときは、マイナスの符号は当てにならないと判断して、表示扱いに戻す。
 *
 * 一部だけマイナスなら、それは本当に消してあるレイヤーなので、そのまま尊重する。
 *
 * 凍結（FROZEN・コード70の1のビット）は別の情報なので、こちらは必ず尊重する。
 */
function fixAllLayersOff(layers) {
  const list = Array.from(layers.values());
  if (list.length === 0) return;
  // 混ざっているなら、その情報は正しい。触らない
  if (!list.every((layer) => layer.off)) return;

  for (const layer of list) {
    layer.off = false;
    layer.visible = !layer.frozen;
  }
}

function parseBlocksSection(pairs, i, blocks) {
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && String(value).trim() === 'ENDSEC') return i + 1;

    if (code === 0 && String(value).trim() === 'BLOCK') {
      const header = readRecord(pairs, i);
      const name = firstValue(header.groups, 2) || '';
      const baseX = num(firstValue(header.groups, 10), 0);
      const baseY = num(firstValue(header.groups, 20), 0);
      i = header.nextIndex;

      const records = [];
      while (i < pairs.length) {
        const [c2, v2] = pairs[i];
        if (c2 === 0 && String(v2).trim() === 'ENDBLK') {
          const endRec = readRecord(pairs, i);
          i = endRec.nextIndex;
          break;
        }
        if (c2 === 0) {
          const rec = readRecord(pairs, i);
          records.push(rec);
          i = rec.nextIndex;
        } else {
          i++;
        }
      }
      blocks.set(name, { name, base: { x: baseX, y: baseY }, records });
      continue;
    }
    i++;
  }
  return i;
}

function parseEntitiesSection(pairs, i, out) {
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && String(value).trim() === 'ENDSEC') return i + 1;
    if (code === 0) {
      const rec = readRecord(pairs, i);
      out.push(rec);
      i = rec.nextIndex;
    } else {
      i++;
    }
  }
  return i;
}

// ============================================================
// 2D アフィン変換（ブロックの展開に使う。位置・拡大率・回転をまとめて持ち運ぶ）
//   変換後の点 = (a*x + c*y + e, b*x + d*y + f)
// ============================================================

const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function applyMatrix(m, x, y) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

// combined(p) = outer(inner(p)) となる行列を作る
function composeMatrix(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

// INSERTの「配置」を表す行列を作る（部品の中の座標 → 置き先の座標）
function makeInsertMatrix({ baseX, baseY, scaleX, scaleY, rotationDeg, insertX, insertY }) {
  const toOrigin = { a: 1, b: 0, c: 0, d: 1, e: -baseX, f: -baseY };
  const scale = { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 };
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const toInsert = { a: 1, b: 0, c: 0, d: 1, e: insertX, f: insertY };

  let m = composeMatrix(scale, toOrigin);
  m = composeMatrix(rotate, m);
  m = composeMatrix(toInsert, m);
  return m;
}

// ============================================================
// 押し出し方向（グループコード210系）。Zが-1なら左右反転（落とし穴4）
// ============================================================

function isExtrusionFlippedX(groups) {
  const z = firstValue(groups, 230);
  if (z === undefined) return false;
  return num(z, 1) <= -0.5;
}

function flipXIf(flip, x) {
  return flip ? -x : x;
}

// X反転（鏡映）のもとでは、CCWの向きそのものが逆転するため、
// 角度は (180 - 角度) に置き換えたうえで start と end を入れ替える。
function mirrorArcAngles(flip, startAngle, endAngle) {
  if (!flip) return [startAngle, endAngle];
  return [180 - endAngle, 180 - startAngle];
}

function mirrorRotation(flip, rotationDeg) {
  return flip ? 180 - rotationDeg : rotationDeg;
}

// ============================================================
// 色の決めごと（開発ルール・落とし穴5）
//   62 が無い/256 → BYLAYER（レイヤーの色）
//   62 が 0        → BYBLOCK（ブロックを展開しているときはINSERT側の色を継承）
//   420 があれば    → 24ビットの色（rgbToCssを使う）
// ============================================================

function resolveColor(groups, layerName, layerColorMap, inheritedColor) {
  const trueColor = firstValue(groups, 420);
  if (trueColor !== undefined) {
    return rgbToCss(num(trueColor));
  }
  const colorRaw = firstValue(groups, 62);
  const colorNumber = colorRaw === undefined ? 256 : num(colorRaw, 256);

  if (colorNumber === 0) {
    // BYBLOCK
    return inheritedColor;
  }
  if (colorNumber === 256) {
    // BYLAYER
    const layer = layerColorMap.get(layerName);
    return layer ? layer.color : aciToCss(7);
  }
  return aciToCss(colorNumber);
}

function getLayerName(groups) {
  const v = firstValue(groups, 8);
  return v === undefined ? '0' : String(v).trim();
}

/**
 * その図形が「実際に」属するレイヤー名を求める。
 *
 * 【AutoCADの大事な決まり。これを知らないと色が変わってしまいます】
 *
 * ブロック（部品）の中身がレイヤー「0」に描かれている場合、
 * その中身は **その部品を置いた側のレイヤーに従います。**
 *
 * 実物の図面（参考図.dxf）がまさにこれでした：
 *   - エルボの部品を置いた場所 … レイヤー PIPE（赤）
 *   - 部品の中身が描かれている場所 … レイヤー 0（黒）
 * CADではエルボは赤く出ます。ところがこの決まりを知らないと、
 * レイヤー0の黒で描いてしまい、**配管が赤いのにエルボだけ黒**になります。
 * 実際にそうなっていました。
 *
 * レイヤー0以外に描かれている中身は、そのレイヤーのままです（決まりどおり）。
 *
 * @param {Array<[number,string]>} groups その図形のグループコード
 * @param {object} ctx 展開中の状態（insertLayer に、置いた側のレイヤー名が入っている）
 */
function effectiveLayer(groups, ctx) {
  const own = getLayerName(groups);
  if (own === '0' && ctx && ctx.insertLayer) return ctx.insertLayer;
  return own;
}

// ============================================================
// bulge（ふくらみ）付きの区間を円弧にする
//
// bulge = tan(区間の中心角 ÷ 4)。正なら反時計回り、負なら時計回り（DXFの決まり）。
// 導出の確認は tests/dxf-parse.test.js で、
// 「変換した円弧の始点・終点が、元の2点に戻ること」を実際に計算して確かめている。
// ============================================================

function bulgeToArc(x1, y1, x2, y2, bulge) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d === 0) return null;

  const theta = 4 * Math.atan(bulge); // ラジアン。符号つき
  const halfTheta = theta / 2;
  const sinHalf = Math.sin(halfTheta);
  if (Math.abs(sinHalf) < 1e-12) return null; // ほぼ直線（bulgeがほぼ0）

  const r = d / (2 * sinHalf); // 符号つき半径
  const ux = dx / d;
  const uy = dy / d;
  // 進行方向を反時計回りに90度回した向き
  const nx = -uy;
  const ny = ux;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const h = r * Math.cos(halfTheta);
  const cx = mx + h * nx;
  const cy = my + h * ny;

  const thetaDeg = (theta * 180) / Math.PI;
  const a1 = (Math.atan2(y1 - cy, x1 - cx) * 180) / Math.PI;

  // a2 = a1 + thetaDeg が必ず成り立つ（bulgeの定義そのもの）。
  // drawing.jsの円弧は「startAngleからendAngleへ反時計回り」で決まっているので、
  // thetaDegが負（時計回り）のときは start/end を入れ替えて、反時計回りの掃引量が
  // |thetaDeg| になるようにする。
  const startAngle = a1 + Math.min(thetaDeg, 0);
  const endAngle = a1 + Math.max(thetaDeg, 0);

  return { cx, cy, r: Math.abs(r), startAngle, endAngle };
}

// ============================================================
// LWPOLYLINE / 旧形式POLYLINE の頂点列 → line/arc の並びに展開する
//
// bulge（ふくらみ）が付いた区間は円弧になる。直線でつなぐと図面が変わってしまうため
// （司令塔からの指示）、区間ごとに line か arc の実体として出す。
// ============================================================

/**
 * @param {Array<{x:number,y:number,bulge:number}>} vertices 反転・変換前のローカル座標
 * @param {boolean} closed
 * @param {function} emitSegment (x1,y1,x2,y2,bulge) => void
 */
function walkPolylineSegments(vertices, closed, emitSegment) {
  const n = vertices.length;
  if (n < 2) return;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % n];
    emitSegment(p1.x, p1.y, p2.x, p2.y, p1.bulge || 0);
  }
}

// ============================================================
// 図形（レコード）を drawing.entities に積む
// ============================================================

function emitLine(drawing, ctx, layer, color, x1, y1, x2, y2) {
  const [X1, Y1] = applyMatrix(ctx.transform, x1, y1);
  const [X2, Y2] = applyMatrix(ctx.transform, x2, y2);
  drawing.entities.push({ type: 'line', layer, color, x1: X1, y1: Y1, x2: X2, y2: Y2 });
}

function emitArc(drawing, ctx, layer, color, cx, cy, r, startAngle, endAngle) {
  const [CX, CY] = applyMatrix(ctx.transform, cx, cy);
  drawing.entities.push({
    type: 'arc',
    layer,
    color,
    cx: CX,
    cy: CY,
    r: r * ctx.scale,
    startAngle: normalizeAngle(startAngle + ctx.rotationDeg),
    endAngle: normalizeAngle(endAngle + ctx.rotationDeg),
  });
}

function emitCircle(drawing, ctx, layer, color, cx, cy, r) {
  const [CX, CY] = applyMatrix(ctx.transform, cx, cy);
  drawing.entities.push({ type: 'circle', layer, color, cx: CX, cy: CY, r: r * ctx.scale });
}

function emitPolyline(drawing, ctx, layer, color, points, closed) {
  const pts = points.map(([x, y]) => applyMatrix(ctx.transform, x, y));
  drawing.entities.push({ type: 'polyline', layer, color, points: pts, closed });
}

function emitText(drawing, ctx, layer, color, x, y, height, rotation, text, align) {
  // 【実物の図面で分かったこと】中身が空っぽの文字は、CADでも何も見えません。
  //
  // お客様の参考図.dxf には、書式の指定（`\A1;` など）だけが入っていて
  // 肝心の文字が無いMTEXTがありました。CADの画面には何も出ません。
  // ところがこのアプリは「文字がそこにある」として扱っていたため、
  // 図面の遠くに見えない文字があることになり、
  // **「図面から遠く離れた場所に図形があります」と、見えないものを報告していました。**
  // お客様がCADで探しても見つからなくて当然でした。
  //
  // 見えないものは、最初から作りません。
  const shown = String(text ?? '').trim();
  if (shown === '') return;

  const [X, Y] = applyMatrix(ctx.transform, x, y);
  drawing.entities.push({
    type: 'text',
    layer,
    color,
    x: X,
    y: Y,
    height: height * ctx.scale,
    rotation: rotation + ctx.rotationDeg,
    text,
    // 文字を書き出す点の、どこに文字を置くか（左端／中央／右端・上／中／下）。
    // 寸法の数字は「中央ぞろえ」で置かれるので、ここを無視すると線からずれる。
    hAlign: (align && align.h) || 'left',
    // 'baseline' ではなく 'alphabetic'。
    // **'baseline' はCanvasに存在しない値**で、指定してもブラウザに無視される。
    // 無視されると、直前に描いた文字の縦位置がそのまま残り、文字がずれて出る。
    vAlign: (align && align.v) || 'alphabetic',
  });
}

// 折れ線（bulgeを含む）を line / arc として積む。分割しても図面上は1本の折れ線に見える。
function emitPolylineWithBulge(drawing, ctx, layer, color, vertices, closed) {
  walkPolylineSegments(vertices, closed, (x1, y1, x2, y2, bulge) => {
    if (bulge) {
      const arc = bulgeToArc(x1, y1, x2, y2, bulge);
      if (arc) {
        emitArc(drawing, ctx, layer, color, arc.cx, arc.cy, arc.r, arc.startAngle, arc.endAngle);
        return;
      }
    }
    emitLine(drawing, ctx, layer, color, x1, y1, x2, y2);
  });
}

// ============================================================
// エンティティ種類ごとの変換
// ============================================================

function convertLine(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const x1 = flipXIf(flip, num(firstValue(g, 10)));
  const y1 = num(firstValue(g, 20));
  const x2 = flipXIf(flip, num(firstValue(g, 11)));
  const y2 = num(firstValue(g, 21));
  emitLine(drawing, ctx, layer, color, x1, y1, x2, y2);
}

/**
 * 楕円（ELLIPSE）を読む。
 *
 * 配管の図面では、**斜めから見た管の口**や、だ円の記号によく使われます。
 * 実物の参考図.dxf にも2個あり、v0.1.5まで表示できていませんでした。
 *
 * DXFでの書かれ方：
 *   10,20 … 中心
 *   11,21 … 長いほうの軸の端（**中心からの相対位置**。ここが分かりにくい）
 *   40    … 短い半径 ÷ 長い半径 の比
 *   41,42 … どこからどこまで描くか（ラジアン。0〜2πで一周）
 */
function convertEllipse(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);

  const cx = flipXIf(flip, num(firstValue(g, 10)));
  const cy = num(firstValue(g, 20));

  // 長いほうの軸の端。中心からの相対位置なので、そのまま向きと長さになる
  const majorX = flipXIf(flip, num(firstValue(g, 11)));
  const majorY = num(firstValue(g, 21));

  const rx = Math.hypot(majorX, majorY);
  if (!(rx > 0)) {
    countUnsupported(drawing, 'ELLIPSE（大きさが0）');
    return;
  }
  const ratio = num(firstValue(g, 40), 1);
  const ry = rx * Math.abs(ratio);

  // 長いほうの軸が何度傾いているか
  let rotationDeg = (Math.atan2(majorY, majorX) * 180) / Math.PI;
  if (flip) rotationDeg = 180 - rotationDeg;

  // 41・42 は「ラジアン」。度に直す。省略時は一周。
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const startAngle = toDeg(num(firstValue(g, 41), 0));
  const endAngle = toDeg(num(firstValue(g, 42), Math.PI * 2));

  emitEllipse(drawing, ctx, layer, color, cx, cy, rx, ry, rotationDeg, startAngle, endAngle);
}

function emitEllipse(drawing, ctx, layer, color, cx, cy, rx, ry, rotationDeg, startAngle, endAngle) {
  const [CX, CY] = applyMatrix(ctx.transform, cx, cy);
  drawing.entities.push({
    type: 'ellipse',
    layer,
    color,
    cx: CX,
    cy: CY,
    rx: rx * ctx.scale,
    ry: ry * ctx.scale,
    rotation: normalizeAngle(rotationDeg + ctx.rotationDeg),
    startAngle: normalizeAngle(startAngle),
    endAngle: normalizeAngle(endAngle),
  });
}

function convertCircle(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const cx = flipXIf(flip, num(firstValue(g, 10)));
  const cy = num(firstValue(g, 20));
  const r = num(firstValue(g, 40));
  emitCircle(drawing, ctx, layer, color, cx, cy, r);
}

function convertArc(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const cx = flipXIf(flip, num(firstValue(g, 10)));
  const cy = num(firstValue(g, 20));
  const r = num(firstValue(g, 40));
  let startAngle = num(firstValue(g, 50));
  let endAngle = num(firstValue(g, 51));
  [startAngle, endAngle] = mirrorArcAngles(flip, startAngle, endAngle);
  emitArc(drawing, ctx, layer, color, cx, cy, r, startAngle, endAngle);
}

function convertText(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const x = flipXIf(flip, num(firstValue(g, 10)));
  const y = num(firstValue(g, 20));
  const height = num(firstValue(g, 40), 2.5);
  const rotation = mirrorRotation(flip, num(firstValue(g, 50)));
  const text = expandControlCodes(firstValue(g, 1));
  emitText(drawing, ctx, layer, color, x, y, height, rotation, text);
}

/**
 * MTEXT（長い文字）の傾きを求める。
 *
 * 【実物の図面で見つかった不具合】
 * 寸法の数字だけが、いつも水平に出ていました。
 * CADでは寸法線に沿って傾いているのに、です。
 *
 * ふつうの文字（TEXT）は「何度傾ける」という書き方（コード50）ですが、
 * MTEXTは **「文字がどちらを向いているか」を矢印（ベクトル）で書くことが多い**
 * （コード11がヨコ方向、コード21がタテ方向）。
 * お客様の参考図.dxf には (11, 21) = (0, 1) という寸法がありました。
 * これは「真上を向く」＝90度傾いている、という意味です。
 * この矢印を読まずに水平のままにしていたのが原因でした。
 *
 * @param {Array<[number,string]>} groups
 * @returns {number} 傾き（度）
 */
function mtextRotationDeg(groups) {
  const dx = firstValue(groups, 11);
  const dy = firstValue(groups, 21);
  if (dx !== undefined || dy !== undefined) {
    const x = num(dx, 0);
    const y = num(dy, 0);
    // 矢印の長さが0のときは向きが決まらないので、下の 50 に任せる
    if (x !== 0 || y !== 0) {
      return normalizeAngle((Math.atan2(y, x) * 180) / Math.PI);
    }
  }
  // 矢印が無い図面では、ふつうの文字と同じ「何度」の書き方を使う
  return num(firstValue(groups, 50), 0);
}

function convertMText(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const x = flipXIf(flip, num(firstValue(g, 10)));
  const y = num(firstValue(g, 20));
  const height = num(firstValue(g, 40), 2.5);
  const rotation = mirrorRotation(flip, mtextRotationDeg(g));

  // 長い文字列は 3 が前半、1 が最後の続きになっている（250文字ずつの分割）
  let raw = '';
  for (const [c, v] of g) {
    if (c === 3) raw += v;
  }
  raw += String(firstValue(g, 1) ?? '');

  emitText(drawing, ctx, layer, color, x, y, height, rotation, cleanMText(raw), mtextAlign(g));
}

/**
 * MTEXTの「書き出す点のどこに文字を置くか」（コード71）を読む。
 *
 * 寸法の数字は 5（中央のまん中）で書かれています。
 * ここを読まずに左端から書くと、**数字が寸法線からずれて見えます。**
 *
 *   1:左上   2:中央上   3:右上
 *   4:左中   5:中央中   6:右中
 *   7:左下   8:中央下   9:右下
 */
function mtextAlign(groups) {
  const n = num(firstValue(groups, 71), 1);
  const h = n % 3 === 1 ? 'left' : n % 3 === 2 ? 'center' : 'right';
  const v = n <= 3 ? 'top' : n <= 6 ? 'middle' : 'bottom';
  return { h, v };
}

// MTEXTの書式指定を取り除いて、素の文字だけにする
/**
 * CADの文字に埋め込まれた「記号の書き方」を、本当の記号に置き換える。
 *
 * 【実際の図面で見つかった不具合】
 * お客様の参考図.dxf に「45%%D」という文字がありました。
 * これはCADの決まりで「45度」を表す書き方ですが、そのまま出すと
 * 画面に「45%%D」と出てしまい、現場で読めません。
 *
 * 置き換える記号：
 *   %%d → °（度）    %%c → φ（径）    %%p → ±    %%% → %
 *   %%u %%o → 下線・上線の指示。画面では使わないので取り除く
 *
 * φについて：CADの元の記号は「⌀」ですが、日本の管工事の図面では「φ」で読むのが
 * 普通で、字体によっては「⌀」が四角い箱になって読めないことがあります。
 * 現場で読めることを優先して「φ」にしています。
 *
 * @param {string} raw
 * @returns {string}
 */
export function expandControlCodes(raw) {
  let s = String(raw ?? '');
  // %%nnn（文字コードを数字で指定する書き方）を先に処理する。
  // 例：%%176 は度記号。3桁の数字だけを対象にする。
  s = s.replace(/%%(\d{3})/g, (whole, digits) => {
    const code = Number(digits);
    // 128〜255 はCADの古い文字コード。よく使う度記号(176)だけ確実に直す
    if (code === 176) return '°';
    if (code < 32 || code > 126) return whole; // 分からないものは触らない
    return String.fromCharCode(code);
  });
  s = s.replace(/%%[dD]/g, '°');
  s = s.replace(/%%[cC]/g, 'φ');
  s = s.replace(/%%[pP]/g, '±');
  s = s.replace(/%%[uUoO]/g, ''); // 下線・上線の指示は画面では使わない
  s = s.replace(/%%%/g, '%');
  return s;
}

function cleanMText(raw) {
  let s = String(raw ?? '');
  s = s.replace(/\\P/g, '\n'); // 改行
  s = s.replace(/\\~/g, ' '); // 改行しない空白
  // \f フォント指定、\H \W \C \Q \A \T \S など「英字+値+;」の書式コードを除去
  s = s.replace(/\\[fF][^;]*;/g, '');
  s = s.replace(/\\[A-Za-z][^\\{};]*;/g, '');
  // 単独トグル（\L \l \O \o \K \k）を除去
  s = s.replace(/\\[A-Za-z](?=[^a-zA-Z]|$)/g, '');
  // 中かっこは取り除き、中身だけ残す
  s = s.replace(/[{}]/g, '');
  // エスケープされていた文字を戻す
  s = s.replace(/\\\\/g, '\\');
  // 度・径・±などの記号の書き方を、本当の記号に置き換える
  return expandControlCodes(s);
}

function convertLwpolyline(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const flags = num(firstValue(g, 70), 0);
  const closed = (flags & 1) === 1;

  // 10,20,42 が頂点ごとに繰り返される。出てくる順番どおりに読む必要がある
  const vertices = [];
  let current = null;
  for (const [code, value] of g) {
    if (code === 10) {
      current = { x: flipXIf(flip, num(value)), y: 0, bulge: 0 };
      vertices.push(current);
    } else if (code === 20 && current) {
      current.y = num(value);
    } else if (code === 42 && current) {
      current.bulge = flip ? -num(value) : num(value); // X反転で向きが逆になる
    }
  }

  const hasBulge = vertices.some((v) => v.bulge);
  if (hasBulge) {
    emitPolylineWithBulge(drawing, ctx, layer, color, vertices, closed);
  } else {
    emitPolyline(drawing, ctx, layer, color, vertices.map((v) => [v.x, v.y]), closed);
  }
}

// 旧形式 POLYLINE（+ VERTEX + SEQEND）
function convertOldPolyline(headerRec, vertexRecs, drawing, ctx, layerColorMap) {
  const g = headerRec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const flags = num(firstValue(g, 70), 0);
  const closed = (flags & 1) === 1;

  const vertices = vertexRecs.map((v) => {
    const vg = v.groups;
    return {
      x: flipXIf(flip, num(firstValue(vg, 10))),
      y: num(firstValue(vg, 20)),
      bulge: flip ? -num(firstValue(vg, 42), 0) : num(firstValue(vg, 42), 0),
    };
  });

  const hasBulge = vertices.some((v) => v.bulge);
  if (hasBulge) {
    emitPolylineWithBulge(drawing, ctx, layer, color, vertices, closed);
  } else {
    emitPolyline(drawing, ctx, layer, color, vertices.map((v) => [v.x, v.y]), closed);
  }
}

// SOLID：4点。3点目と4点目が同じなら三角形（開発ルールの指示どおり）
/**
 * HATCH（ハッチング）の中身を読み解く（開発ルール38章）。
 *
 * グループコードは**並び順に意味がある**ので、上から順に歩いて読む。
 *   91 … 囲いの数。そのあと囲いの数だけ「92から始まるかたまり」が続く
 *   78 … 模様の線の種類の数。そのあとその数だけ 53/43/44/45/46/79/49 が続く
 *
 * @returns {{solid:boolean, paths:Array, patternLines:Array}}
 */
function parseHatchGroups(g) {
  let i = 0;
  let solid = false;
  let nPaths = 0;
  const paths = [];
  const patternLines = [];

  // --- 先頭の設定 ---
  for (; i < g.length; i++) {
    const [c, v] = g[i];
    if (c === 70) solid = num(v, 0) === 1;
    if (c === 91) { nPaths = num(v, 0); i++; break; }
  }

  // --- 囲い ---
  for (let p = 0; p < nPaths && i < g.length; p++) {
    while (i < g.length && g[i][0] !== 92) i++;
    if (i >= g.length) break;
    const flags = num(g[i][1], 0);
    i++;
    const pts = [];

    if ((flags & 2) === 2) {
      // 折れ線の囲い（ふくらみが付くことがある）
      let closed = false;
      let nVerts = 0;
      while (i < g.length) {
        const [c, v] = g[i];
        if (c === 73) { closed = num(v, 0) === 1; i++; continue; }
        if (c === 93) { nVerts = num(v, 0); i++; break; }
        if (c === 72) { i++; continue; }
        i++;
      }
      const verts = [];
      for (let k = 0; k < nVerts && i < g.length; k++) {
        while (i < g.length && g[i][0] !== 10) i++;
        if (i >= g.length) break;
        const x = num(g[i][1], 0);
        i++;
        let y = 0;
        let bulge = 0;
        if (i < g.length && g[i][0] === 20) { y = num(g[i][1], 0); i++; }
        if (i < g.length && g[i][0] === 42) { bulge = num(g[i][1], 0); i++; }
        verts.push([x, y, bulge]);
      }
      for (let k = 0; k < verts.length; k++) {
        const a = verts[k];
        const b = verts[(k + 1) % verts.length];
        const 最後 = k === verts.length - 1;
        if (最後 && !closed) { pts.push([a[0], a[1]]); break; }
        if (a[2]) pts.push(...bulgePoints(a[0], a[1], b[0], b[1], a[2]));
        else pts.push([a[0], a[1]]);
      }
    } else {
      // 辺をひとつずつ並べた囲い
      let nEdges = 0;
      while (i < g.length && g[i][0] !== 93) i++;
      if (i < g.length) { nEdges = num(g[i][1], 0); i++; }

      for (let e = 0; e < nEdges && i < g.length; e++) {
        while (i < g.length && g[i][0] !== 72) i++;
        if (i >= g.length) break;
        const 辺の種類 = num(g[i][1], 0);
        i++;

        const 値 = {};
        const 点たち = [];
        while (i < g.length && g[i][0] !== 72 && g[i][0] !== 97 && g[i][0] !== 92) {
          const [c, v] = g[i];
          if (c === 10) 点たち.push([num(v, 0), 0]);
          else if (c === 20 && 点たち.length) 点たち[点たち.length - 1][1] = num(v, 0);
          if (値[c] === undefined) 値[c] = num(v, 0);
          i++;
        }

        if (辺の種類 === 1) {
          // 直線：始まりと終わり
          pts.push([値[10] || 0, 値[20] || 0]);
          pts.push([値[11] || 0, 値[21] || 0]);
        } else if (辺の種類 === 2) {
          // 円弧：中心・半径・角度
          pts.push(
            ...arcPoints(値[10] || 0, 値[20] || 0, 値[40] || 0, 値[50] || 0, 値[51] || 0, 値[73] !== 0)
          );
        } else if (辺の種類 === 3) {
          // 楕円弧：中心・長いほうの軸の先端・比・角度
          pts.push(
            ...ellipseArcPoints(
              値[10] || 0, 値[20] || 0, 値[11] || 0, 値[21] || 0,
              値[40] || 1, 値[50] || 0, 値[51] || 0, 値[73] !== 0
            )
          );
        } else {
          // スプライン（なめらかな曲線）。ここでは通る点をつないだ折れ線で代用する。
          // 正確ではないが、**囲いの形としてはほぼ同じ**になる
          for (const q of 点たち) pts.push([q[0], q[1]]);
        }
      }
    }

    if (pts.length >= 3) paths.push(pts);

    // 97（もとの図形の数）と、そのあとの参照を飛ばす
    while (i < g.length && g[i][0] !== 92 && g[i][0] !== 75 && g[i][0] !== 78) i++;
  }

  // --- 模様の決まり ---
  let nPattern = 0;
  for (let k = 0; k < g.length; k++) {
    if (g[k][0] === 78) { nPattern = num(g[k][1], 0); i = k + 1; break; }
  }
  for (let p = 0; p < nPattern && i < g.length; p++) {
    while (i < g.length && g[i][0] !== 53) i++;
    if (i >= g.length) break;
    const line = { angleDeg: num(g[i][1], 0), baseX: 0, baseY: 0, offsetAlong: 0, offsetAcross: 0, dashes: [] };
    i++;
    let 破線の数 = 0;
    while (i < g.length && g[i][0] !== 53) {
      const [c, v] = g[i];
      if (c === 43) line.baseX = num(v, 0);
      else if (c === 44) line.baseY = num(v, 0);
      else if (c === 45) line.offsetAlong = num(v, 0);
      else if (c === 46) line.offsetAcross = num(v, 0);
      else if (c === 79) 破線の数 = num(v, 0);
      else if (c === 49 && line.dashes.length < 破線の数) line.dashes.push(num(v, 0));
      else if (c === 47 || c === 98) break; // 模様の並びはここで終わり
      i++;
    }
    patternLines.push(line);
  }

  return { solid, paths, patternLines };
}

/**
 * HATCH を、ふつうの線に直して図面に足す（開発ルール38章）。
 *
 * - 模様（斜線など）… 囲いの中だけに線を引く
 * - べた塗り        … 塗りつぶす仕組みが無いので、囲いの形だけ描く
 *                     （SOLIDと同じ扱い。開発ルール38.3）
 */
function convertHatch(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const flip = isExtrusionFlippedX(g);

  const { solid, paths, patternLines } = parseHatchGroups(g);
  if (paths.length === 0) {
    // 囲いが無いハッチング（他の図形にぶら下がっているだけのもの）。
    // 描くものが無いので、**「表示できませんでした」とは数えない**（開発ルール23章）。
    return true;
  }

  const 向きを直す = (pts) => pts.map(([x, y]) => [flipXIf(flip, x), y]);

  if (solid || patternLines.length === 0) {
    // べた塗りは、囲いの形だけ描く（SOLIDと同じ）
    for (const path of paths) {
      emitPolyline(drawing, ctx, layer, color, 向きを直す(path), true);
    }
    return true;
  }

  const lines = hatchToLines(paths.map(向きを直す), patternLines);
  for (const [x1, y1, x2, y2] of lines) {
    emitLine(drawing, ctx, layer, color, x1, y1, x2, y2);
  }
  // 囲いそのものは、CADでは線として出ないので描かない（境界は別の図形が持っている）
  return true;
}

/**
 * POINT（点）を図面に足す。
 *
 * CADの設定 $PDMODE が 0 のとき、点は**小さな丸**として表示される
 * （実物の図面で確認した）。このアプリでも同じように小さな丸を出す。
 * 大きさは線の太さに合わせるので、拡大しても紙に出しても、ちょうどよい大きさになる。
 */
function convertPoint(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const flip = isExtrusionFlippedX(g);
  const x = flipXIf(flip, num(firstValue(g, 10)));
  const y = num(firstValue(g, 20));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const [X, Y] = applyMatrix(ctx.transform, x, y);
  drawing.entities.push({ type: 'point', layer, color, x: X, y: Y });
}

function convertSolid(rec, drawing, ctx, layerColorMap) {
  const g = rec.groups;
  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);
  const p1 = [flipXIf(flip, num(firstValue(g, 10))), num(firstValue(g, 20))];
  const p2 = [flipXIf(flip, num(firstValue(g, 11))), num(firstValue(g, 21))];
  const p3 = [flipXIf(flip, num(firstValue(g, 12))), num(firstValue(g, 22))];
  const p4raw10 = firstValue(g, 13);
  const p4 = p4raw10 === undefined
    ? p3
    : [flipXIf(flip, num(firstValue(g, 13))), num(firstValue(g, 23))];

  let points = [p1, p2, p4, p3]; // SOLIDの頂点順は 1-2-4-3 で四角形になる決まり
  if (p3[0] === p4[0] && p3[1] === p4[1]) {
    points = [p1, p2, p3]; // 3点目と4点目が同じ＝三角形
  }
  emitPolyline(drawing, ctx, layer, color, points, true);
}

// ============================================================
// INSERT（ブロックの配置）を展開する
// ============================================================

const MAX_BLOCK_DEPTH = 20; // 入れ子ブロックの無限ループ対策

/**
 * 寸法（DIMENSION）を展開する。
 *
 * 【実物の図面で調べて分かったこと】
 * CADは寸法を「線・矢印・数字」の集まりとして、図面の中に**部品として持っています**。
 * DIMENSIONという図形は、その部品の名前（例 `*D88`）を指しているだけです。
 *
 * 大事なのは、この部品の中身が **すでに図面と同じ座標で書かれている**ことです。
 * （参考図.dxf で確認：部品の基点は 0,0 で、中身の座標が図面の座標そのものだった）
 * そのため、位置をずらしたり回したりせず、**そのまま展開すれば正しい場所に出ます。**
 *
 * これを飛ばすと、管工事の図面で寸法が1つも見えなくなります。
 * 参考図.dxf では32個の寸法が全部消えていました。
 */
function expandDimension(rec, drawing, ctx, blocks, layerColorMap) {
  const g = rec.groups;
  const raw = firstValue(g, 2);
  const name = raw === undefined ? '' : String(raw).trim();
  const block = blocks.get(name) ?? (raw !== undefined ? blocks.get(raw) : undefined);

  if (!block) {
    // 部品が見つからない寸法は描けない。黙って捨てず数える（開発ルール10.5）
    countUnsupported(drawing, 'DIMENSION（寸法の部品が見つからない）');
    return;
  }
  if (ctx.depth >= MAX_BLOCK_DEPTH) {
    countUnsupported(drawing, 'DIMENSION（入れ子が深すぎるため打ち切り）');
    return;
  }

  const layer = effectiveLayer(g, ctx);
  const color = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);

  const childCtx = {
    // 位置も向きも大きさも変えない。中身がすでに図面の座標で入っているため。
    transform: ctx.transform,
    rotationDeg: ctx.rotationDeg,
    scale: ctx.scale,
    // 部品の中で「親に従う色」が使われていたら、この寸法の色にする
    inheritedColor: color,
    depth: ctx.depth + 1,
    // 部品の中身がレイヤー0に描かれていたら、この寸法のレイヤーに従わせる（AutoCADの決まり）
    insertLayer: layer,
    // ここから下は寸法の内側。中の「目印の点」を数えないための印
    insideDimension: true,
  };

  expandRecords(block.records, drawing, childCtx, blocks, layerColorMap);
}

function expandInsert(rec, drawing, ctx, blocks, layerColorMap) {
  const g = rec.groups;
  const blockName = firstValue(g, 2);
  const block = blockName ? blocks.get(blockName) : undefined;
  if (!block) {
    countUnsupported(drawing, 'INSERT（未定義のブロック）');
    return;
  }
  if (ctx.depth >= MAX_BLOCK_DEPTH) {
    countUnsupported(drawing, 'INSERT（入れ子が深すぎるため打ち切り）');
    return;
  }

  const flip = isExtrusionFlippedX(g);
  const layer = effectiveLayer(g, ctx);
  const insertColor = resolveColor(g, layer, layerColorMap, ctx.inheritedColor);

  const insertX = flipXIf(flip, num(firstValue(g, 10)));
  const insertY = num(firstValue(g, 20));
  const scaleX = num(firstValue(g, 41), 1);
  const scaleY = num(firstValue(g, 42), 1);
  let rotationDeg = num(firstValue(g, 50), 0);
  if (flip) rotationDeg = 180 - rotationDeg;

  const localMatrix = makeInsertMatrix({
    baseX: block.base.x,
    baseY: block.base.y,
    scaleX,
    scaleY,
    rotationDeg,
    insertX,
    insertY,
  });

  const childCtx = {
    transform: composeMatrix(ctx.transform, localMatrix),
    rotationDeg: ctx.rotationDeg + rotationDeg,
    scale: ctx.scale * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2),
    inheritedColor: insertColor,
    depth: ctx.depth + 1,
    // 【AutoCADの決まり】部品の中身がレイヤー0に描かれていたら、
    // その中身は**この部品を置いた側のレイヤー**に従う（effectiveLayer 参照）。
    // これを渡さないと、配管が赤いのにエルボだけ黒、といったことが起きる。
    insertLayer: layer,
    // 寸法の内側かどうかは、その下の部品にも引き継ぐ（矢印は部品として入っている）
    insideDimension: ctx.insideDimension === true,
  };

  // 列（COLUMN）・行（ROW）の繰り返し配置（70,71,44,45）はv1では対応しない。
  // 対応していないと分かるよう、繰り返しがある場合は1個ぶんだけ展開して報告に混ぜない
  // （見た目としては1個でも図形が出るほうが、何も出ないより安全なため）。

  expandRecords(block.records, drawing, childCtx, blocks, layerColorMap);
}

// ============================================================
// レコードの並びを順番に見て、drawing.entities に積んでいく
// （ENTITIESセクションの並びにも、BLOCK定義の中身にも使う）
// ============================================================

/**
 * その図形が「CADの画面に出ないもの」かどうかを判断する。
 *
 * 【実物の図面で分かったこと。ここを読まないと図面がぐちゃぐちゃになります】
 *
 * お客様の参考図.dxf には、**「見えない」指定が付いた図形が805個**ありました。
 * これはAutoCADの「動的ブロック」の仕組みです。
 * ひとつの部品の中に、ありうる形を**全部まとめて持たせておき**、
 * 「今回はこの形を使う」という指定で切り替えます。
 * 使わない形の図形には「見えない」印（コード60 が 1）が付きます。
 *
 * この印を読まずに全部描くと、**切り替えたはずの形が全部重なって出てしまいます。**
 * 実際にそうなっていました。
 *
 * レイヤーが消してある場合（非表示・凍結）も、CADの画面には出ないので出しません。
 */
function isHiddenEntity(rec, layerColorMap, ctx) {
  // コード60 が 1 → この図形は表示しない、という指定
  const invisible = firstValue(rec.groups, 60);
  if (invisible !== undefined && num(invisible, 0) === 1) return true;

  // レイヤーごと消してある場合（非表示OFF・凍結FROZEN）
  const layer = layerColorMap.get(effectiveLayer(rec.groups, ctx));
  if (layer && layer.visible === false) return true;

  return false;
}

function expandRecords(records, drawing, ctx, blocks, layerColorMap) {
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    // CADの画面に出ない図形は、ここで外す。
    // これは「表示できなかった」ではなく「もともと出さないもの」なので、
    // unsupported には数えない（数えると本当に足りない図形が埋もれる）。
    const hidden = isHiddenEntity(rec, layerColorMap, ctx);
    if (hidden) drawing.hiddenCount = (drawing.hiddenCount || 0) + 1;
    try {
      if (rec.type === 'POLYLINE') {
        const vertexRecs = [];
        let j = i + 1;
        while (j < records.length && records[j].type === 'VERTEX') {
          vertexRecs.push(records[j]);
          j++;
        }
        if (j < records.length && records[j].type === 'SEQEND') j++;
        // 「見えない」指定のときは、続きのVERTEXごと飛ばす
        if (!hidden) convertOldPolyline(rec, vertexRecs, drawing, ctx, layerColorMap);
        i = j - 1;
        continue;
      }
      if (rec.type === 'VERTEX' || rec.type === 'SEQEND') {
        continue; // POLYLINEの外に出てきた場合は無視（壊れたファイル対策）
      }
      // ここから下は、見えない指定が付いていたら何もしない
      if (hidden) continue;
      if (rec.type === 'LINE') {
        convertLine(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'LWPOLYLINE') {
        convertLwpolyline(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'ELLIPSE') {
        convertEllipse(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'CIRCLE') {
        convertCircle(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'ARC') {
        convertArc(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'TEXT') {
        convertText(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'MTEXT') {
        convertMText(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'SOLID') {
        convertSolid(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'HATCH') {
        convertHatch(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'POINT' && !ctx.insideDimension) {
        // 寸法の中の点は下で外している。ここは図面に置かれたふつうの点
        convertPoint(rec, drawing, ctx, layerColorMap);
      } else if (rec.type === 'INSERT') {
        expandInsert(rec, drawing, ctx, blocks, layerColorMap);
      } else if (rec.type === 'DIMENSION') {
        expandDimension(rec, drawing, ctx, blocks, layerColorMap);
      } else if (rec.type === 'VIEWPORT') {
        // VIEWPORT は「印刷レイアウトののぞき窓」の設定であって、図面の線ではありません。
        // 「A3の紙のこの位置に、図面のこの範囲を映す」という指定そのものです。
        // これを「表示できませんでした」と数えると、
        // **図面が欠けていないのに欠けたように見えて、無用な心配をかけます。**
        // 実物の図面で4個出て、ユーザーを不安にさせました。そのため数えません。
      } else if (rec.type === 'POINT' && ctx.insideDimension) {
        // 寸法の部品の中に入っている「点」は、CADでも印刷されない目印です
        // （寸法をどこから測ったかを覚えておくためのもの）。
        // これを「表示できませんでした」と数えると、実物の図面では100個近くになり、
        // **本当に足りていない図形が埋もれてしまいます。** そのため数えません。
        // 図面の見た目は何も変わりません。
      } else {
        // SPLINE / 3DFACE / MLINE など
        // → 開発ルール10.5：黙って捨てず、種類ごとに数える
        countUnsupported(drawing, rec.type || '不明');
      }
    } catch {
      // 1つの図形がおかしくても、そこであきらめず残りを読み続ける（落とし穴7）
      countUnsupported(drawing, `${rec.type || '不明'}（読み取り失敗）`);
    }
  }
}

// ============================================================
// 入口
// ============================================================

/**
 * DXFの文字列を読んで図形データにする。
 * @param {string} text DXFファイルの中身
 * @returns {object} src/drawing.js に定義された形の図形データ
 */
export function parseDxf(text) {
  if (isBinaryDxf(text)) {
    throw new Error(
      'このDXFは特殊な形式（バイナリDXF）です。CADで「DXF（文字形式）」として保存し直してください。'
    );
  }

  const drawing = createDrawing('dxf');

  let sections;
  try {
    const pairs = tokenize(text);
    sections = collectSections(pairs);
  } catch {
    // ここまで来て失敗するのは想定外の壊れ方。空の図面を返す（落ちない）
    return finishDrawing(drawing);
  }

  const { layers, blocks, topEntityRecords } = sections;
  // 図形を組み立てる前に直すこと。あとからでは、消された図形は戻らない（34章）
  fixAllLayersOff(layers);
  drawing.layers = Array.from(layers.values());

  const rootCtx = {
    transform: IDENTITY_MATRIX,
    rotationDeg: 0,
    scale: 1,
    inheritedColor: aciToCss(0), // トップレベルのBYBLOCKは黒として扱う（drawing.jsの決まりに合わせる）
    depth: 0,
  };

  expandRecords(topEntityRecords, drawing, rootCtx, blocks, layers);

  return finishDrawing(drawing);
}
