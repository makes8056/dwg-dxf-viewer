// print-pdf.js — 囲まれた範囲から、印刷用のPDFを作る（開発ルール36章）
//
// 【なぜPDFなのか】
//   それまでは、紙1枚ぶんの**絵（PNG）**を作ってiPadに渡していた。
//   絵は「点の集まり」なので、プリンターは紙ぜんたいを点で塗ることになり、
//   **印刷にとても時間がかかった**（ユーザーの指摘で判明）。
//
//   PDFなら「ここからここまで線を引く」という**命令の並び**で渡せる。
//   プリンターは自分の解像度で線を引くだけなので速く、しかも
//   **どんな解像度のプリンターでも線がぼやけない**（点の数に縛られない）。
//
//   実測：同じ範囲で PNG 190KB → PDF 約30KB。中身は 3,870,000点 → 約550本の線。
//
// 【この係の役目】
//   図形データ（src/drawing.js の形）と囲んだ範囲から、PDFのバイト列を作るだけ。
//   iPadへ渡す処理は持たない（それは src/ui/app.js の役目。開発ルール2.4）。
//
// 【紙の上の置き方は、PNGとまったく同じにする】
//   置き方が食い違うと、確認画面（PNG）と実際に出る紙（PDF）がずれる。
//   それは**紙に出すまで気づけない**、いちばんたちの悪いずれ方になる。
//   そこで置き方の計算は src/print-area.js の computePrintPlacement() 1か所に置き、
//   PNGもPDFも同じものを使う（36.2）。
//
// 【文字の扱い】
//   数字や英字（`45°` の度記号も含む）… PDFに元から入っている書体（Helvetica）で書く。
//                                       線と同じで、拡大してもぼやけない。
//   漢字・かな                        … PDFの標準の書体には入っていない。
//                                       その文字だけ小さな白黒の型（スタンプ）にして貼る。
//                                       実物の図面では「北 南 東 西 上 下」など
//                                       ごく少数なので、これで十分に軽い。

import { computePrintPlacement, PRINT_LINE_WIDTH_MM } from './print-area.js';

/** 1ミリは何ポイントか。PDFの長さの単位はポイント（1/72インチ）。 */
export const PT_PER_MM = 72 / 25.4;

/**
 * 漢字などを型にするときの細かさ。
 * このアプリの印刷の細かさ（200dpi。開発ルール26.5）に合わせる。
 * ここだけ細かくしても紙の上では分からず、ファイルが重くなるだけ。
 */
const STAMP_DOTS_PER_MM = 200 / 25.4;
/** 型が大きくなりすぎないための上限（1辺の点の数）。 */
const STAMP_MAX_PX = 1500;

const ERROR_CANNOT_CREATE = 'PDFを作れませんでした。';

// ------------------------------------------------------------
// 小道具
// ------------------------------------------------------------

/** 数を、PDFに書ける短い文字にする（小数点以下3桁で十分。紙の上で0.001mm）。 */
function n(value) {
  if (!Number.isFinite(value)) return '0';
  const s = value.toFixed(3);
  // 「1.000」→「1」、「-0.000」→「0」のように短くする
  return s.replace(/\.?0+$/, '') || '0';
}

/** '#rrggbb' を PDF の 0〜1 の3つの数にする。 */
function cssColorToPdf(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(css || '').trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** その文字は、PDFに元から入っている書体（WinAnsi）で書けるか。 */
export function isWinAnsiText(text) {
  const s = String(text == null ? '' : text);
  for (const ch of s) {
    const code = ch.codePointAt(0);
    // 0x20〜0x7e … 数字・英字・記号
    // 0xa0〜0xff … °（度）や±など。WinAnsiに入っている
    if (code >= 0x20 && code <= 0x7e) continue;
    if (code >= 0xa0 && code <= 0xff) continue;
    return false;
  }
  return true;
}

/** PDFの文字列に入れられない記号（丸かっこと逆斜線）を逃がす。 */
function escapePdfText(text) {
  return String(text).replace(/[\\()]/g, (c) => '\\' + c);
}

/** 文字列を、PDFに書けるバイト列（WinAnsi）にする。 */
function toWinAnsiBytes(text) {
  const out = [];
  for (const ch of String(text)) out.push(ch.codePointAt(0) & 0xff);
  return out;
}

/**
 * その図形は、囲んだ範囲にかかっているか（開発ルール36.3）。
 *
 * 範囲の外の図形は、切り取られて**紙には出ない。**
 * それなのに作ってしまうと、
 *   - PDFがむだに重くなる（とくに漢字の型は1つで数百KBになりうる）
 *   - 作るのに時間がかかる
 * ので、先に外してしまう。
 *
 * 判定はざっくり（図形を囲む四角どうしが重なるか）でよい。
 * **迷ったら「かかっている」側に倒すこと。** 消してはいけないものを消すより、
 * 余分に持っていくほうが、はるかに安全。
 */
export function entityTouchesArea(e, area, margin = 0) {
  if (!e || !area) return true;
  const minX = area.minX - margin;
  const minY = area.minY - margin;
  const maxX = area.maxX + margin;
  const maxY = area.maxY + margin;
  const 重なる = (x1, y1, x2, y2) =>
    Math.min(x1, x2) <= maxX && Math.max(x1, x2) >= minX &&
    Math.min(y1, y2) <= maxY && Math.max(y1, y2) >= minY;

  if (e.type === 'line') return 重なる(e.x1, e.y1, e.x2, e.y2);
  if (e.type === 'polyline') {
    const pts = Array.isArray(e.points) ? e.points : [];
    if (!pts.length) return false;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x1) x1 = x; if (x > x2) x2 = x;
      if (y < y1) y1 = y; if (y > y2) y2 = y;
    }
    return 重なる(x1, y1, x2, y2);
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const r = Math.abs(e.r || 0);
    return 重なる(e.cx - r, e.cy - r, e.cx + r, e.cy + r);
  }
  if (e.type === 'ellipse') {
    const r = Math.max(Math.abs(e.rx || 0), Math.abs(e.ry || 0));
    return 重なる(e.cx - r, e.cy - r, e.cx + r, e.cy + r);
  }
  if (e.type === 'text') {
    // 文字の広がりは分からないので、大きめに見積もる（切り落とさないため）
    const h = Math.abs(e.height || 0);
    const w = h * Math.max(1, String(e.text || '').length) * 1.5;
    const r = Math.max(w, h * 2);
    return 重なる(e.x - r, e.y - r, e.x + r, e.y + r);
  }
  return true;
}

// ------------------------------------------------------------
// 円・円弧・楕円を、なめらかな曲線（ベジェ）にする
// ------------------------------------------------------------

/**
 * 楕円の一部を、3次ベジェ曲線の並びにする。
 * 円も円弧も「rx と ry が同じ楕円」として、この1つで扱う。
 *
 * 90度ずつに切って近似する定番のやり方。誤差は半径の0.03%以下で、
 * 紙の上ではまったく分からない。
 *
 * @returns {{start:[number,number], curves:Array<[number,number,number,number,number,number]>}}
 */
export function ellipseToBezier(cx, cy, rx, ry, rotationDeg, startDeg, sweepDeg) {
  const rot = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  // 楕円の中の座標（傾き前）を、紙の座標に直す
  const 点 = (t) => {
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [cx + x * cosR - y * sinR, cy + x * sinR + y * cosR];
  };
  const 接線 = (t) => {
    const dx = -rx * Math.sin(t);
    const dy = ry * Math.cos(t);
    return [dx * cosR - dy * sinR, dx * sinR + dy * cosR];
  };

  const start = (startDeg * Math.PI) / 180;
  const sweep = (sweepDeg * Math.PI) / 180;
  const 本数 = Math.max(1, Math.ceil(Math.abs(sweepDeg) / 90));
  const 一本ぶん = sweep / 本数;
  // 90度を1本のベジェで近似するときの、おなじみの係数
  const k = (4 / 3) * Math.tan(一本ぶん / 4);

  const curves = [];
  let t = start;
  for (let i = 0; i < 本数; i++) {
    const t2 = t + 一本ぶん;
    const [x1, y1] = 点(t);
    const [x2, y2] = 点(t2);
    const [dx1, dy1] = 接線(t);
    const [dx2, dy2] = 接線(t2);
    curves.push([x1 + k * dx1, y1 + k * dy1, x2 - k * dx2, y2 - k * dy2, x2, y2]);
    t = t2;
  }
  return { start: 点(start), curves };
}

// ------------------------------------------------------------
// PDFの組み立て
// ------------------------------------------------------------

/**
 * PDFのバイト列を組み立てる小道具。
 * 「何番目の物が、ファイルの何バイト目から始まるか」の表（xref）が要るので、
 * バイト数を数えながら書いていく。
 */
function createPdfBuilder() {
  const chunks = [];
  let length = 0;
  // 何番目の物が、ファイルの何バイト目から始まるか。1番から使う（0番は決まりで空き扱い）
  const offsets = [0];
  let 予約した番号 = 0;

  function push(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);
    chunks.push(bytes);
    length += bytes.length;
  }

  return {
    /**
     * 番号だけ先に取る。
     * ページと、その親（Pages）は**お互いの番号を書き合う**ので、
     * 先に番号を決めておかないと書けない。
     */
    reserveId() {
      予約した番号 += 1;
      offsets.push(-1); // まだ書いていない印
      return 予約した番号;
    },
    /** 取っておいた番号で、中身を書き足す。 */
    writeObject(id, body) {
      offsets[id] = length;
      push(`${id} 0 obj\n${body}\nendobj\n`);
      return id;
    },
    /** 番号を取ってから中身を書く（ふつうはこちら）。 */
    addObject(body) {
      const id = this.reserveId();
      return this.writeObject(id, body);
    },
    push,
    get length() {
      return length;
    },
    /** 最後まで書いて、バイト列にする。 */
    finish(rootId) {
      const xrefAt = length;
      const 件数 = offsets.length;
      let xref = `xref\n0 ${件数}\n0000000000 65535 f \n`;
      for (let i = 1; i < 件数; i++) {
        // 書き忘れた物があると、PDFが開けなくなる。ここで気づけるようにしておく
        if (offsets[i] < 0) throw new Error(`PDFの${i}番の中身を書いていない`);
        xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      }
      push(xref);
      push(`trailer\n<< /Size ${件数} /Root ${rootId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

      const out = new Uint8Array(length);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    },
  };
}

// ------------------------------------------------------------
// 漢字などを、小さな白黒の型（スタンプ）にする
// ------------------------------------------------------------

/**
 * 文字列を1ビットの白黒の型にする。
 * PDFの「ImageMask」として貼ると、**黒い点のところだけ**が色で塗られ、
 * 白いところは透けるので、下の線を隠さない。
 *
 * @returns {{width:number, height:number, hex:string, widthRatio:number}|null}
 */
function makeTextStamp(text, heightMm, createCanvas) {
  if (!createCanvas) return null;

  // 紙の上での大きさから、必要な点の数を決める
  const 高さpx = Math.min(STAMP_MAX_PX, Math.max(8, Math.round(heightMm * STAMP_DOTS_PER_MM)));
  const 測り用 = createCanvas(8, 8);
  // Canvasが使えない場所（テストや古い環境）では型を作れない。
  // 呼び出し側が「PDFはあきらめて絵で印刷する」に切り替えられるよう、null を返す
  const 測りctx = 測り用 && typeof 測り用.getContext === 'function' ? 測り用.getContext('2d') : null;
  if (!測りctx || typeof 測りctx.measureText !== 'function') return null;
  測りctx.font = `${高さpx}px sans-serif`;
  const 幅px = Math.min(STAMP_MAX_PX, Math.max(1, Math.ceil(測りctx.measureText(text).width)));
  // 文字の上下がはみ出さないよう、少し余裕を持たせる
  const 余裕 = Math.ceil(高さpx * 0.35);
  const 全高 = 高さpx + 余裕 * 2;

  const canvas = createCanvas(幅px, 全高);
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx || typeof ctx.getImageData !== 'function') return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 幅px, 全高);
  ctx.fillStyle = '#000000';
  ctx.font = `${高さpx}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, 余裕 + 高さpx);

  let data;
  try {
    data = ctx.getImageData(0, 0, 幅px, 全高).data;
  } catch (err) {
    return null;
  }

  // 1行を8点ずつ1バイトに詰める。0のところが塗られる（PDFのImageMaskの決まり）
  const 一行のバイト数 = Math.ceil(幅px / 8);
  const bytes = new Uint8Array(一行のバイト数 * 全高).fill(0xff);
  for (let y = 0; y < 全高; y++) {
    for (let x = 0; x < 幅px; x++) {
      const i = (y * 幅px + x) * 4;
      const 明るさ = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (明るさ < 128) {
        const at = y * 一行のバイト数 + (x >> 3);
        bytes[at] &= ~(0x80 >> (x & 7));
      }
    }
  }

  return {
    width: 幅px,
    height: 全高,
    data: runLengthEncode(bytes),
    // 文字の高さ1に対して、横がいくつぶんか（紙の上の大きさを決めるのに使う）
    widthRatio: 幅px / 高さpx,
    // 文字の書き出しの線（ベースライン）が、型の下からどれだけ上か
    baselineRatio: 余裕 / 高さpx,
    heightRatio: 全高 / 高さpx,
  };
}

/**
 * 同じ値が続くところをまとめて縮める（PDFの RunLengthDecode の形）。
 *
 * 白黒の型は「まっ白が延々と続く」ので、これだけで何十分の一にもなる。
 * 決まりはとても簡単：
 *   0〜127   … このあとの (値+1) バイトを、そのまま使う
 *   129〜255 … このあとの1バイトを (257-値) 回くり返す
 *   128      … おしまい
 */
export function runLengthEncode(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    // 同じ値がいくつ続くか数える
    let 同じ = 1;
    while (i + 同じ < bytes.length && bytes[i + 同じ] === bytes[i] && 同じ < 128) 同じ++;

    if (同じ >= 2) {
      out.push(257 - 同じ, bytes[i]);
      i += 同じ;
      continue;
    }

    // 続いていない。そのまま入れる分をまとめる
    let 始め = i;
    let 長さ = 0;
    while (i < bytes.length && 長さ < 128) {
      const 次も同じ =
        i + 1 < bytes.length && bytes[i + 1] === bytes[i] &&
        i + 2 < bytes.length && bytes[i + 2] === bytes[i];
      if (次も同じ) break;
      i++;
      長さ++;
    }
    out.push(長さ - 1);
    for (let k = 0; k < 長さ; k++) out.push(bytes[始め + k]);
  }
  out.push(128); // おしまいの印
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return s;
}

// ------------------------------------------------------------
// 公開する関数
// ------------------------------------------------------------

/**
 * 囲まれた範囲から、印刷用のPDFを作る。
 *
 * 失敗しても例外を投げず、日本語の理由つきで { error } を返す（開発ルール26.7）。
 * 呼び出し側は、失敗したら今までどおり絵（PNG）で印刷すればよい。
 *
 * @param {object} drawing src/drawing.js の形の図形データ
 * @param {object} area 図面座標での範囲 { minX, minY, maxX, maxY }
 * @param {object} [options] { createCanvas } … 漢字の型を作るのに使う。テストで差し替えられる
 * @returns {{ bytes:Uint8Array, blob:Blob|null, orientation:string, drawn:number }|{ error:string }}
 */
export function createPrintPdf(drawing, area, options = {}) {
  try {
    if (!drawing || !Array.isArray(drawing.entities)) {
      return { error: ERROR_CANNOT_CREATE };
    }

    const 置き方 = computePrintPlacement(area);
    const { orientation } = 置き方;
    const createCanvas = options.createCanvas || defaultCreateCanvas;

    // 図面の座標 → 紙の上のポイント。
    // PDFもCADも「上へ行くほどYが大きい」ので、上下をひっくり返す必要はない。
    const X = (x) => (置き方.originXmm + (x - 置き方.area.minX) * 置き方.scale) * PT_PER_MM;
    const Y = (y) => (置き方.originYmm + (y - 置き方.area.minY) * 置き方.scale) * PT_PER_MM;
    // 図面の1単位が、紙の上で何ポイントか
    const S = 置き方.scale * PT_PER_MM;

    const ops = [];
    const stamps = []; // 漢字などの型。あとでPDFの物として書き足す

    ops.push('q');
    // 囲んだ範囲の外は描かない（開発ルール29.4と同じ考え方）
    ops.push(
      `${n(置き方.originXmm * PT_PER_MM)} ${n(置き方.originYmm * PT_PER_MM)} ` +
        `${n(置き方.contentWmm * PT_PER_MM)} ${n(置き方.contentHmm * PT_PER_MM)} re W n`
    );
    ops.push(`${n(PRINT_LINE_WIDTH_MM * PT_PER_MM)} w 1 J 1 j`);

    let いまの色 = null;
    const 色を変える = (css, 塗り) => {
      const key = css + (塗り ? 'f' : 's');
      if (いまの色 === key) return;
      いまの色 = key;
      const [r, g, b] = cssColorToPdf(css);
      ops.push(`${n(r)} ${n(g)} ${n(b)} ${塗り ? 'rg' : 'RG'}`);
    };

    let drawn = 0;

    // 範囲の外にはみ出した線が、境目でちょうど切れるように少しだけ広げて判定する
    const 判定の余裕 = Math.max(置き方.area.maxX - 置き方.area.minX, 置き方.area.maxY - 置き方.area.minY) * 0.02;

    for (const e of drawing.entities) {
      if (!e || !e.type) continue;
      // 紙に出ないものは作らない（36.3）
      if (!entityTouchesArea(e, 置き方.area, 判定の余裕)) continue;

      if (e.type === 'line') {
        色を変える(e.color, false);
        ops.push(`${n(X(e.x1))} ${n(Y(e.y1))} m ${n(X(e.x2))} ${n(Y(e.y2))} l S`);
        drawn++;
      } else if (e.type === 'polyline') {
        const pts = Array.isArray(e.points) ? e.points : [];
        if (pts.length < 2) continue;
        色を変える(e.color, false);
        let d = `${n(X(pts[0][0]))} ${n(Y(pts[0][1]))} m`;
        for (let i = 1; i < pts.length; i++) d += ` ${n(X(pts[i][0]))} ${n(Y(pts[i][1]))} l`;
        if (e.closed) d += ' h';
        ops.push(d + ' S');
        drawn++;
      } else if (e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse') {
        const rx = e.type === 'ellipse' ? e.rx : e.r;
        const ry = e.type === 'ellipse' ? e.ry : e.r;
        if (!(rx > 0) || !(ry > 0)) continue;
        const rotation = e.type === 'ellipse' ? e.rotation || 0 : 0;
        let 始め = 0;
        let 回る = 360;
        if (e.type !== 'circle') {
          始め = e.startAngle || 0;
          // 始まりと終わりが同じなら、ぐるっと一周（開発ルール19章と同じ扱い）
          回る = ((((e.endAngle - e.startAngle) % 360) + 360) % 360) || 360;
        }
        const { start, curves } = ellipseToBezier(e.cx, e.cy, rx, ry, rotation, 始め, 回る);
        色を変える(e.color, false);
        let d = `${n(X(start[0]))} ${n(Y(start[1]))} m`;
        for (const c of curves) {
          d += ` ${n(X(c[0]))} ${n(Y(c[1]))} ${n(X(c[2]))} ${n(Y(c[3]))} ${n(X(c[4]))} ${n(Y(c[5]))} c`;
        }
        ops.push(d + ' S');
        drawn++;
      } else if (e.type === 'text') {
        const 文字 = String(e.text == null ? '' : e.text);
        if (!文字) continue;
        const 高さpt = (e.height || 0) * S;
        if (!(高さpt > 0)) continue;
        色を変える(e.color, true);
        if (isWinAnsiText(文字)) {
          描く文字(ops, e, 文字, 高さpt, X, Y);
        } else {
          const 型 = 貼る型(ops, e, 文字, 高さpt, X, Y, stamps, createCanvas);
          if (!型) {
            // 漢字の型が作れなかった。黙って文字を落とすより、
            // PDFをあきらめて絵（PNG）で印刷してもらうほうが安全（36.4）
            return { error: '文字を含むPDFを作れませんでした。' };
          }
        }
        drawn++;
      }
    }

    ops.push('Q');

    // ---- ここからPDFの形に組み立てる ----
    const pdf = createPdfBuilder();
    pdf.push('%PDF-1.4\n');

    const 内容 = ops.join('\n') + '\n';
    const contentsId = pdf.addObject(
      `<< /Length ${内容.length} >>\nstream\n${内容}endstream`
    );
    const fontId = pdf.addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    );

    const stampIds = stamps.map((s) =>
      pdf.addObject(
        `<< /Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} ` +
          `/ImageMask true /Decode [0 1] /Filter /RunLengthDecode /Length ${s.data.length} >>\n` +
          `stream\n${s.data}\nendstream`
      )
    );

    const xobjects = stampIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ');
    const resources =
      `<< /Font << /F1 ${fontId} 0 R >>` +
      (xobjects ? ` /XObject << ${xobjects} >>` : '') +
      ' >>';

    const pageWpt = 置き方.pageWmm * PT_PER_MM;
    const pageHpt = 置き方.pageHmm * PT_PER_MM;

    // ページと親（Pages）はお互いの番号を書き合うので、先に番号だけ取っておく
    const pageId = pdf.reserveId();
    const pagesId = pdf.reserveId();
    pdf.writeObject(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(pageWpt)} ${n(pageHpt)}] ` +
        `/Resources ${resources} /Contents ${contentsId} 0 R >>`
    );
    pdf.writeObject(pagesId, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
    const rootId = pdf.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    const bytes = pdf.finish(rootId);

    let blob = null;
    try {
      blob = new Blob([bytes], { type: 'application/pdf' });
    } catch (err) {
      blob = null;
    }

    return { bytes, blob, orientation, drawn, stampCount: stamps.length };
  } catch (err) {
    return { error: ERROR_CANNOT_CREATE };
  }
}

/** WinAnsiで書ける文字を、PDFの書体で書く。 */
function 描く文字(ops, e, 文字, 高さpt, X, Y) {
  const 角度 = ((e.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(角度);
  const sin = Math.sin(角度);

  // 書き出す位置。CADの決まりに合わせて、左右・上下のそろえ方を反映する。
  // 横幅は「1文字あたりだいたい0.55文字ぶん」というHelveticaの平均で見積もる。
  // 寸法の数字は中央ぞろえなので、ここを外すと寸法線から数字がずれる（drawing.jsの注意）。
  const 幅pt = 文字.length * 高さpt * 0.55;
  let dx = 0;
  if (e.hAlign === 'center') dx = -幅pt / 2;
  else if (e.hAlign === 'right') dx = -幅pt;
  let dy = 0;
  if (e.vAlign === 'top') dy = -高さpt;
  else if (e.vAlign === 'middle') dy = -高さpt / 2;

  const x0 = X(e.x) + dx * cos - dy * sin;
  const y0 = Y(e.y) + dx * sin + dy * cos;

  const バイト = toWinAnsiBytes(文字);
  let s = '';
  for (const b of バイト) s += String.fromCharCode(b);

  ops.push('BT');
  ops.push(`/F1 ${n(高さpt)} Tf`);
  ops.push(
    `${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x0)} ${n(y0)} Tm`
  );
  ops.push(`(${escapePdfText(s)}) Tj`);
  ops.push('ET');
}

/** 漢字などを、小さな型（スタンプ）にして貼る。 */
function 貼る型(ops, e, 文字, 高さpt, X, Y, stamps, createCanvas) {
  const 高さmm = 高さpt / PT_PER_MM;
  const 型 = makeTextStamp(文字, 高さmm, createCanvas);
  if (!型) return null;

  const index = stamps.length;
  stamps.push(型);

  const 幅pt = 高さpt * 型.widthRatio;
  const 全高pt = 高さpt * 型.heightRatio;

  const 角度 = ((e.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(角度);
  const sin = Math.sin(角度);

  let dx = 0;
  if (e.hAlign === 'center') dx = -幅pt / 2;
  else if (e.hAlign === 'right') dx = -幅pt;
  let dy = 0;
  if (e.vAlign === 'top') dy = -高さpt;
  else if (e.vAlign === 'middle') dy = -高さpt / 2;
  // 型の下端は、書き出しの線より少し下にある。そのぶん下げる
  dy -= 高さpt * 型.baselineRatio;

  const x0 = X(e.x) + dx * cos - dy * sin;
  const y0 = Y(e.y) + dx * sin + dy * cos;

  ops.push('q');
  ops.push(
    `${n(幅pt * cos)} ${n(幅pt * sin)} ${n(-全高pt * sin)} ${n(全高pt * cos)} ${n(x0)} ${n(y0)} cm`
  );
  ops.push(`/Im${index} Do`);
  ops.push('Q');
  return 型;
}

/** 標準のCanvasを作る（漢字の型を作るのに使う）。テストでは差し替える。 */
function defaultCreateCanvas(widthPx, heightPx) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  return canvas;
}
