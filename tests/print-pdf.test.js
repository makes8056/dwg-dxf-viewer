// tests/print-pdf.test.js — 印刷用のPDFを作るところのテスト（開発ルール36章）
//
// 【なぜPDFにしたか】
// それまでは紙1枚ぶんの「絵（PNG）」を渡していた。絵は点の集まりなので、
// プリンターが紙ぜんたいを点で塗ることになり、印刷にとても時間がかかった。
// PDFなら「線を引く命令」で渡せるので速く、線もぼやけない。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPrintPdf,
  ellipseToBezier,
  isWinAnsiText,
  entityTouchesArea,
  runLengthEncode,
  PT_PER_MM,
} from '../src/print-pdf.js';
import { computePrintPlacement, renderPrintCanvas } from '../src/print-area.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** ctx（描く先）のふり。呼ばれた命令を記録するだけ（print-area.test.js と同じ作り）。 */
function makeFakeCtx(pixelWidth, pixelHeight) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    canvas: { width: pixelWidth, height: pixelHeight },
    save: record('save'), restore: record('restore'), setTransform: record('setTransform'),
    fillRect: record('fillRect'),
    fill: record('fill'), rect: record('rect'), clip: record('clip'),
    beginPath: record('beginPath'), closePath: record('closePath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'), stroke: record('stroke'),
    arc: record('arc'), ellipse: record('ellipse'), fillText: record('fillText'),
    translate: record('translate'), rotate: record('rotate'),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    font: '', textAlign: '', textBaseline: '',
  };
}
function makeFakeCanvas(width, height) {
  const ctx = makeFakeCtx(width, height);
  return { width, height, ctx, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,X' };
}

function 四角い図面(minX, minY, maxX, maxY) {
  return {
    units: 'mm',
    bounds: { minX, minY, maxX, maxY },
    contentBounds: { minX, minY, maxX, maxY },
    layers: [],
    entities: [
      { type: 'line', layer: '0', color: '#000000', x1: minX, y1: minY, x2: maxX, y2: minY },
      { type: 'line', layer: '0', color: '#000000', x1: maxX, y1: minY, x2: maxX, y2: maxY },
      { type: 'line', layer: '0', color: '#ff0000', x1: maxX, y1: maxY, x2: minX, y2: maxY },
      { type: 'line', layer: '0', color: '#000000', x1: minX, y1: maxY, x2: minX, y2: minY },
    ],
    unsupported: { count: 0, kinds: {} },
    source: 'dxf',
  };
}

/** PDFのバイト列を、中身を調べられる文字にする。 */
const 文字にする = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

// ============================================================
// 【いちばん大事】確認画面（絵）と、紙に出るもの（PDF）がずれない
// ============================================================

test('絵とPDFで、図面を紙に置く場所がぴったり同じになる', () => {
  // ここがずれると、**確認画面では合っているのに紙だけずれる。**
  // 紙に出すまで気づけない、いちばんたちの悪いずれ方になる（開発ルール36.2）。
  const PX_PER_MM = 200 / 25.4;
  const 例 = [
    { minX: 0, minY: 0, maxX: 1000, maxY: 400 },   // 横長
    { minX: 0, minY: 0, maxX: 400, maxY: 1000 },   // 縦長
    { minX: -50, minY: -20, maxX: 450, maxY: 480 }, // 正方形に近い・原点の外
  ];

  for (const area of 例) {
    const 置き方 = computePrintPlacement(area);
    const created = [];
    renderPrintCanvas(四角い図面(area.minX, area.minY, area.maxX, area.maxY), area, {
      createCanvas: (w, h) => { const c = makeFakeCanvas(w, h); created.push(c); return c; },
    });
    const 点 = created[0].ctx.calls
      .filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')
      .map((c) => [c[1], c[2]]);
    assert.ok(点.length > 0, '絵に線が描かれていない');

    // 絵の上での、図面の四隅の位置
    const 絵の左 = Math.min(...点.map((p) => p[0]));
    const 絵の右 = Math.max(...点.map((p) => p[0]));
    const 絵の上 = Math.min(...点.map((p) => p[1]));
    const 絵の下 = Math.max(...点.map((p) => p[1]));

    // PDFの決め方から計算した、同じ四隅の位置（ミリ→絵の点に直す）
    const 予想左 = 置き方.originXmm * PX_PER_MM;
    const 予想右 = (置き方.originXmm + 置き方.contentWmm) * PX_PER_MM;
    // 絵（Canvas）は下向きにYが増えるので、上下を入れ替えて比べる
    const 予想上 = (置き方.pageHmm - (置き方.originYmm + 置き方.contentHmm)) * PX_PER_MM;
    const 予想下 = (置き方.pageHmm - 置き方.originYmm) * PX_PER_MM;

    const ずれ = Math.max(
      Math.abs(絵の左 - 予想左), Math.abs(絵の右 - 予想右),
      Math.abs(絵の上 - 予想上), Math.abs(絵の下 - 予想下)
    );
    assert.ok(
      ずれ < 1.5,
      `絵とPDFで置く場所がずれている（${ずれ.toFixed(2)}点）。範囲=${JSON.stringify(area)}`
    );
  }
});

test('PDFの中の座標が、紙の上の正しい場所を指している（上下が逆になっていない）', () => {
  // 【上下を取り違えると、図面がさかさまに印刷される。】
  // CADもPDFも「上へ行くほどYが大きい」ので、ひっくり返してはいけない。
  // Canvasに描くときだけ、viewport.js が上下を入れ替える（開発ルール10.6）。
  const area = { minX: 0, minY: 0, maxX: 1000, maxY: 400 };
  const 置き方 = computePrintPlacement(area);

  // 範囲の左下から右上へ、1本だけ線を引いた図面
  const 図面 = {
    units: 'mm', bounds: area, contentBounds: area, layers: [],
    entities: [{ type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: 1000, y2: 400 }],
    unsupported: { count: 0, kinds: {} }, source: 'dxf',
  };
  const r = createPrintPdf(図面, area);
  assert.ok(!r.error, r.error);

  const t = 文字にする(r.bytes);
  const m = t.match(/(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/);
  assert.ok(m, 'PDFの中に線が見つからない');
  const [x1, y1, x2, y2] = m.slice(1).map(Number);

  const 予想x1 = 置き方.originXmm * PT_PER_MM;
  const 予想y1 = 置き方.originYmm * PT_PER_MM;
  const 予想x2 = (置き方.originXmm + 置き方.contentWmm) * PT_PER_MM;
  const 予想y2 = (置き方.originYmm + 置き方.contentHmm) * PT_PER_MM;

  assert.ok(Math.abs(x1 - 予想x1) < 0.5, `左下のXがずれている（${x1} ≠ ${予想x1.toFixed(2)}）`);
  assert.ok(
    Math.abs(y1 - 予想y1) < 0.5,
    `図面の下端が紙の下に来ていない（${y1} ≠ ${予想y1.toFixed(2)}）。上下が逆かもしれない`
  );
  assert.ok(Math.abs(x2 - 予想x2) < 0.5, `右上のXがずれている（${x2} ≠ ${予想x2.toFixed(2)}）`);
  assert.ok(
    Math.abs(y2 - 予想y2) < 0.5,
    `図面の上端が紙の上に来ていない（${y2} ≠ ${予想y2.toFixed(2)}）。上下が逆かもしれない`
  );
  // 念のため、向きそのものも確かめる
  assert.ok(y2 > y1, '図面の上端が、下端より下に来ている（さかさま）');
});

test('図面の下のほうにあるものは、紙の下のほうに出る', () => {
  // 上下が逆になっていないことを、もうひとつ別の形で押さえる
  const area = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const 図面 = {
    units: 'mm', bounds: area, contentBounds: area, layers: [],
    entities: [
      // 範囲のいちばん下のあたりに、横線を1本だけ引く
      { type: 'line', layer: '0', color: '#000000', x1: 100, y1: 50, x2: 900, y2: 50 },
    ],
    unsupported: { count: 0, kinds: {} }, source: 'dxf',
  };
  const 置き方 = computePrintPlacement(area);
  const r = createPrintPdf(図面, area);
  const t = 文字にする(r.bytes);
  const m = t.match(/(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/);
  assert.ok(m, '線が見つからない');
  const y = Number(m[2]);
  const 中心y = (置き方.originYmm + 置き方.contentHmm / 2) * PT_PER_MM;
  assert.ok(y < 中心y, `図面の下のものが紙の上半分に出ている（さかさま）。y=${y}, 中心=${中心y.toFixed(1)}`);
});

test('置き方を決める計算は、1か所にまとめてある', () => {
  // 別々に計算すると、片方だけ直したときに必ず食い違う
  const pdf = read('src/print-pdf.js');
  assert.match(pdf, /computePrintPlacement/, 'PDF側が共通の計算を使っていない');
  assert.ok(
    !/A4_LONG_MM|PAGE_MARGIN_MM\s*=/.test(pdf),
    'PDF側が紙の大きさを自前で持っている。print-area.js に合わせること'
  );
});

// ============================================================
// PDFの形
// ============================================================

test('ちゃんとしたPDFになっている', () => {
  const area = { minX: 0, minY: 0, maxX: 1000, maxY: 400 };
  const r = createPrintPdf(四角い図面(0, 0, 1000, 400), area);
  assert.ok(!r.error, r.error);
  const t = 文字にする(r.bytes);
  assert.ok(t.startsWith('%PDF-'), 'PDFの目印で始まっていない');
  assert.match(t, /%%EOF\s*$/, 'PDFの終わりの目印が無い');
  assert.match(t, /\/Type \/Catalog/, '目録が無い');
  assert.match(t, /\/Type \/Pages/, 'ページのまとめが無い');
  assert.match(t, /\/Type \/Page[^s]/, 'ページが無い');
  assert.match(t, /\bxref\b/, '場所の表（xref）が無い');
  assert.match(t, /\btrailer\b/, '最後の案内（trailer）が無い');
});

test('場所の表（xref）の数字が、本当にその位置を指している', () => {
  // ここがずれると、PDFが「壊れています」と言われて開けない
  const r = createPrintPdf(四角い図面(0, 0, 1000, 400), { minX: 0, minY: 0, maxX: 1000, maxY: 400 });
  const t = 文字にする(r.bytes);
  const m = t.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  assert.ok(m, 'xref が読めない');
  const 件数 = Number(m[1]);
  const 行 = m[2].split('\n').filter((x) => x.length >= 18);
  assert.equal(行.length, 件数, 'xref の行数が合わない');
  for (let i = 1; i < 件数; i++) {
    const 位置 = Number(行[i].slice(0, 10));
    const ここから = t.slice(位置, 位置 + 20);
    assert.match(ここから, new RegExp(`^${i} 0 obj`), `${i}番の物の位置がずれている`);
  }
});

test('紙の大きさはA4。囲んだ向きに合わせて縦横が入れ替わる', () => {
  const 横 = createPrintPdf(四角い図面(0, 0, 1000, 400), { minX: 0, minY: 0, maxX: 1000, maxY: 400 });
  const 縦 = createPrintPdf(四角い図面(0, 0, 400, 1000), { minX: 0, minY: 0, maxX: 400, maxY: 1000 });
  const 箱 = (r) => 文字にする(r.bytes).match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).slice(1).map(Number);
  const [横W, 横H] = 箱(横);
  const [縦W, 縦H] = 箱(縦);
  // A4は 297mm×210mm。ポイントに直すと 841.89 × 595.28
  assert.ok(Math.abs(横W - 297 * PT_PER_MM) < 0.1, `横向きの幅がA4でない: ${横W}`);
  assert.ok(Math.abs(横H - 210 * PT_PER_MM) < 0.1, `横向きの高さがA4でない: ${横H}`);
  assert.ok(Math.abs(縦W - 210 * PT_PER_MM) < 0.1, `縦向きの幅がA4でない: ${縦W}`);
  assert.ok(Math.abs(縦H - 297 * PT_PER_MM) < 0.1, `縦向きの高さがA4でない: ${縦H}`);
});

test('囲んだ範囲の外は、紙に出さない（切り取りを入れている）', () => {
  const r = createPrintPdf(四角い図面(0, 0, 1000, 400), { minX: 0, minY: 0, maxX: 1000, maxY: 400 });
  const t = 文字にする(r.bytes);
  assert.match(t, /[\d.]+ [\d.]+ [\d.]+ [\d.]+ re W n/, '切り取りの指定が無い');
});

test('線の色が、図形の色のとおりに入っている', () => {
  const r = createPrintPdf(四角い図面(0, 0, 1000, 400), { minX: 0, minY: 0, maxX: 1000, maxY: 400 });
  const t = 文字にする(r.bytes);
  assert.match(t, /\b0 0 0 RG\b/, '黒い線の色が入っていない');
  assert.match(t, /\b1 0 0 RG\b/, '赤い線の色が入っていない');
});

test('絵（PNG）よりずっと軽い', () => {
  // これがPDFにした一番の理由。重いと印刷に時間がかかる
  const area = { minX: 0, minY: 0, maxX: 1000, maxY: 400 };
  const r = createPrintPdf(四角い図面(0, 0, 1000, 400), area);
  assert.ok(r.bytes.length < 20000, `PDFが ${r.bytes.length} バイトもある。軽くない`);
});

// ============================================================
// 範囲の外の図形を持っていかない
// ============================================================

test('囲んだ範囲にかからない図形は、PDFに入れない', () => {
  // 入れてもプリンターには出ないのに、ファイルだけ重くなる（開発ルール36.3）
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const 図面 = 四角い図面(0, 0, 100, 100);
  図面.entities.push({
    type: 'line', layer: '0', color: '#000000',
    x1: 100000, y1: 100000, x2: 100100, y2: 100100,
  });
  const r = createPrintPdf(図面, area);
  assert.equal(r.drawn, 4, '遠くの線まで持っていっている');
});

test('境目にかかっている図形は、必ず持っていく', () => {
  // 迷ったら「かかっている」側に倒す。消してはいけないものを消すほうが、ずっと悪い
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const またがる = { type: 'line', layer: '0', color: '#000000', x1: -50, y1: 50, x2: 50, y2: 50 };
  assert.equal(entityTouchesArea(またがる, area, 0), true, '範囲をまたぐ線を落としている');

  const 大きい円 = { type: 'circle', layer: '0', color: '#000000', cx: 200, cy: 50, r: 150 };
  assert.equal(entityTouchesArea(大きい円, area, 0), true, '範囲にかかる円を落としている');

  const 遠い = { type: 'line', layer: '0', color: '#000000', x1: 500, y1: 500, x2: 600, y2: 600 };
  assert.equal(entityTouchesArea(遠い, area, 0), false, '遠い線を持っていっている');
});

test('文字は大きめに見積もって、切り落とさない', () => {
  // 文字の広がりは正確には分からない。少し外にあっても持っていく
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const 少し外 = { type: 'text', layer: '0', color: '#000000', x: 130, y: 50, height: 20, text: '250' };
  assert.equal(entityTouchesArea(少し外, area, 0), true, '境目の近くの文字を落としている');
});

// ============================================================
// 曲線・文字
// ============================================================

test('円をベジェ曲線にしても、半径がずれない', () => {
  const { start, curves } = ellipseToBezier(10, 20, 5, 5, 0, 0, 360);
  assert.equal(curves.length, 4, '円は90度ずつ4本になるはず');
  const 中心からの距離 = (x, y) => Math.hypot(x - 10, y - 20);
  assert.ok(Math.abs(中心からの距離(start[0], start[1]) - 5) < 1e-9, '始まりの点が円の上にない');
  for (const c of curves) {
    assert.ok(Math.abs(中心からの距離(c[4], c[5]) - 5) < 1e-9, '曲線の終わりが円の上にない');
  }
});

test('円弧は、指定した角度のぶんだけ描く', () => {
  const { start, curves } = ellipseToBezier(0, 0, 10, 10, 0, 0, 90);
  assert.ok(Math.abs(start[0] - 10) < 1e-9 && Math.abs(start[1]) < 1e-9, '0度の点が違う');
  const 終わり = curves[curves.length - 1];
  assert.ok(Math.abs(終わり[4]) < 1e-9 && Math.abs(終わり[5] - 10) < 1e-9, '90度の点が違う');
});

test('数字・英字・度記号は、PDFの書体で書ける', () => {
  assert.equal(isWinAnsiText('250'), true);
  assert.equal(isWinAnsiText('45°'), true, '度記号が書けないことになっている');
  assert.equal(isWinAnsiText('H45° A-1'), true);
  assert.equal(isWinAnsiText('北'), false, '漢字が書けることになっている');
  assert.equal(isWinAnsiText('あ'), false);
});

test('漢字が入っていて、型を作れないときは、PDFをあきらめる', () => {
  // 黙って文字を落とすと、**現場で方角が分からない図面**が出てしまう。
  // それより絵（PNG）で印刷してもらうほうが安全（開発ルール36.4）
  const 図面 = 四角い図面(0, 0, 100, 100);
  図面.entities.push({
    type: 'text', layer: '0', color: '#000000', x: 50, y: 50, height: 10, text: '北',
  });
  const r = createPrintPdf(図面, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, {
    createCanvas: () => null, // Canvasが使えない場合
  });
  assert.ok(r.error, '漢字を黙って落としている');
});

test('数字だけなら、Canvasが無くてもPDFを作れる', () => {
  const 図面 = 四角い図面(0, 0, 100, 100);
  図面.entities.push({
    type: 'text', layer: '0', color: '#000000', x: 50, y: 50, height: 10, text: '250',
  });
  const r = createPrintPdf(図面, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, {
    createCanvas: () => null,
  });
  assert.ok(!r.error, r.error);
  assert.match(文字にする(r.bytes), /\(250\) Tj/, '数字が書かれていない');
});

// ============================================================
// 縮める処理（RunLength）
// ============================================================

test('縮めたものが、決まりどおりに元へ戻る', () => {
  const decode = (s) => {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const b = s.charCodeAt(i++);
      if (b === 128) break;
      if (b < 128) { for (let k = 0; k <= b; k++) out.push(s.charCodeAt(i++)); }
      else { const v = s.charCodeAt(i++); for (let k = 0; k < 257 - b; k++) out.push(v); }
    }
    return out;
  };
  const 例 = [
    [255, 255, 255, 255, 0, 1, 2, 255, 255],
    [0],
    Array.from({ length: 3000 }, (_, i) => (i < 2900 ? 255 : i % 7)),
    Array.from({ length: 300 }, (_, i) => i % 251),
  ];
  for (const 元 of 例) {
    const 戻り = decode(runLengthEncode(Uint8Array.from(元)));
    assert.deepEqual(戻り, 元, '縮めたものが元に戻らない');
  }
});

test('同じ値が続くところは、ちゃんと縮む', () => {
  // 白黒の型は「まっ白が延々と続く」ので、ここが効かないとPDFが重くなる
  const まっ白 = new Uint8Array(5000).fill(0xff);
  assert.ok(runLengthEncode(まっ白).length < 100, '縮んでいない');
});

// ============================================================
// つなぎ方
// ============================================================

test('紙に渡すのはPDF。作れなかったときだけ絵にする', () => {
  const app = read('src/ui/app.js');
  assert.match(app, /createPrintPdf\(currentDrawing, area\)/, 'PDFを作っていない');
  assert.match(app, /PDF.*\?\s*pdf\.blob\s*:\s*result\.blob/, 'PDFを優先していない');
  assert.match(app, /makePrintFileName\(.*'pdf'.*'png'.*\)/, 'ファイル名を切り替えていない');
});

test('渡すときの種類（MIME）を、ファイル名に合わせている', () => {
  // 種類を間違えると、iPadが「プリント」を出さないことがある
  const app = read('src/ui/app.js');
  assert.match(app, /application\/pdf/, 'PDFの種類を指定していない');
});

test('PDFを作る処理は、待ち時間を作らない', () => {
  // 「プリント」を押した流れの中で渡すため（開発ルール28.3）。
  // 待ち時間が入ると、iPadが共有メニューを開かせないことがある
  const pdf = read('src/print-pdf.js');
  assert.ok(!/export async function createPrintPdf/.test(pdf), 'PDF作りに待ち時間が入っている');
  const app = read('src/ui/app.js');
  assert.ok(
    !/await createPrintPdf/.test(app),
    'PDFを待ってから渡している。iPadで共有メニューが開かなくなる'
  );
});

test('オフライン用の一覧に、PDFの係が入っている', () => {
  const sw = read('service-worker.js');
  assert.match(sw, /'\.\/src\/print-pdf\.js'/, '電波の無い場所でPDFが作れなくなる');
});

test('点（POINT）が、PDFにも塗られた丸として出る', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const 図面 = {
    units: 'mm', bounds: area, contentBounds: area, layers: [],
    entities: [{ type: 'point', layer: '0', color: '#000000', x: 50, y: 50 }],
    unsupported: { count: 0, kinds: {} }, source: 'dxf',
  };
  const r = createPrintPdf(図面, area);
  assert.ok(!r.error, r.error);
  assert.equal(r.drawn, 1, '点がPDFに出ていない');
  const t = 文字にする(r.bytes);
  assert.match(t, / c\n?.* f/s, '塗りつぶしの丸になっていない');
});

test('範囲の外の点は、PDFに入れない', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const 図面 = {
    units: 'mm', bounds: area, contentBounds: area, layers: [],
    entities: [
      { type: 'point', layer: '0', color: '#000000', x: 50, y: 50 },
      { type: 'point', layer: '0', color: '#000000', x: 99999, y: 99999 },
    ],
    unsupported: { count: 0, kinds: {} }, source: 'dxf',
  };
  const r = createPrintPdf(図面, area);
  assert.equal(r.drawn, 1, '遠くの点まで持っていっている');
});
