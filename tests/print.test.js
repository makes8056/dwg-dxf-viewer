// tests/print.test.js — 印刷の決まりが壊れていないかを見張る（開発ルール26章）
//
// 【なぜテストで守るか】
// 印刷の設定が壊れても、**画面を見ているかぎり誰も気づきません。**
// 紙に出して初めて「ボタンまで印刷されている」と分かります。
// 現場で紙を無駄にしてから気づくのでは遅いので、機械に見張らせます。
//
// 動かし方：  node --test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** ui.css の @media print の中身だけを取り出す。 */
function printBlocks(css) {
  const blocks = [];
  const re = /@media\s+print\s*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    // かっこの深さを数えて、対応する閉じかっこまでを取り出す
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push(css.slice(re.lastIndex, i - 1));
  }
  return blocks.join('\n');
}

// ============================================================
// 紙に出すもの・出さないもの（開発ルール26.6）
// ============================================================

test('印刷用の入れ物が index.html にある', () => {
  const html = read('index.html');
  assert.match(html, /id="print-area"/, '印刷用の入れ物（#print-area）が無い');
  assert.match(html, /id="print-image"/, '図面の絵を入れる場所（#print-image）が無い');
});

test('印刷のとき、画面のものを全部消している', () => {
  // ここが無いと、**ボタン・案内・版番号が紙に印刷される。**
  const block = printBlocks(read('src/ui/ui.css'));
  assert.ok(block.length > 0, 'ui.css に印刷用の指定（@media print）が無い');
  assert.match(
    block,
    /body\s*>\s*\*\s*\{[^}]*display\s*:\s*none/,
    '印刷のときに画面のものを消す指定が無い。このままだとボタンや案内が紙に出る'
  );
});

test('印刷のとき、印刷用の入れ物だけを出している', () => {
  const block = printBlocks(read('src/ui/ui.css'));
  assert.match(
    block,
    /\.print-area\s*\{[^}]*display\s*:\s*(flex|block)/,
    '印刷用の入れ物を出す指定が無い。このままだと紙が真っ白になる'
  );
});

test('ふだんの画面では、印刷用の入れ物を出さない', () => {
  // ここが無いと、画面に図面の絵が二重に出てしまう
  const css = read('src/ui/ui.css');
  const outside = css.replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, '');
  assert.match(
    outside,
    /\.print-area\s*\{[^}]*display\s*:\s*none/,
    'ふだんの画面で印刷用の入れ物を隠す指定が無い'
  );
});

test('図面の絵が、紙からはみ出さない指定になっている', () => {
  // contain なので、縦横の比が変わらない＝**図面が歪まない**。
  // ここを cover にすると図面の端が切れる。fill にすると図面が歪む。
  const block = printBlocks(read('src/ui/ui.css'));
  assert.match(block, /\.print-image\s*\{[\s\S]*?object-fit\s*:\s*contain/, '図面が歪む・切れる指定になっている');
  assert.match(block, /\.print-image\s*\{[\s\S]*?max-width\s*:\s*100%/, '紙の幅からはみ出す');
  assert.match(block, /\.print-image\s*\{[\s\S]*?max-height\s*:\s*100%/, '紙の高さからはみ出す');
});

test('紙の余白が決められている（開発ルール26.6の8mm）', () => {
  const block = printBlocks(read('src/ui/ui.css'));
  assert.match(block, /@page\s*\{[^}]*margin/, '紙の余白の指定が無い');
});

test('線の色が、紙にそのまま出る指定になっている', () => {
  // これが無いと、ブラウザが「インク節約」で線を薄くしたり色を落としたりする
  const block = printBlocks(read('src/ui/ui.css'));
  assert.match(block, /print-color-adjust\s*:\s*exact/, '色をそのまま印刷する指定が無い');
});

// ============================================================
// 【実際に印刷した紙で判明した不具合】（2026-09-04）
//
// ユーザーが実物の紙を見せてくれて、2つ分かった。
//   1. 図面が1本も印刷されず、「印刷する図面」という代わりの文字だけが出ていた
//   2. 紙の余白に、アプリのURL・日付・ページ番号が勝手に入っていた
//
// どちらも**画面を見ているかぎり気づけない**。紙に出して初めて分かる。
// ============================================================

test('紙の余白を0にしている（URL・日付・ページ番号を出さないため）', () => {
  // ブラウザは紙の余白に、ページのURL・日付・ページ番号を勝手に入れる。
  // 余白を0にすると、入れる場所が無くなるので出さなくなる。
  // ここを 8mm などに戻すと、**またURLと日付が紙に出る**。
  const block = printBlocks(read('src/ui/ui.css'));
  const page = block.match(/@page\s*\{([^}]*)\}/);
  assert.ok(page, '@page の指定が無い');
  assert.match(
    page[1],
    /margin\s*:\s*0\s*;/,
    '紙の余白が0になっていない。このままだとURL・日付・ページ番号が紙に出る'
  );
});

test('図面が紙の端にくっつかないよう、内側で余白を取っている', () => {
  // @page の余白を0にしたぶん、こちらで余白を取る（開発ルール26.6の8mm）
  const block = printBlocks(read('src/ui/ui.css'));
  assert.match(
    block,
    /\.print-area\s*\{[\s\S]*?padding\s*:\s*8mm/,
    '図面が紙の端にくっつく。.print-area の内側で余白を取ること'
  );
});

test('印刷の直後に絵を片付けていない（iPadで白紙になる）', () => {
  // 【iPadで起きた本番不具合】
  // iPadのSafariでは window.print() がすぐ戻ってくる（印刷画面は後から開く）。
  // その直後に絵を片付けると、**印刷される前に絵が消えて紙が白紙になる。**
  // 実際に「印刷する図面」という代わりの文字だけが印刷された紙を確認した。
  // パソコンでは print() が印刷画面を閉じるまで待つので、この不具合は再現しない。
  const app = read('src/ui/app.js');

  // 片付けは afterprint（印刷が終わった合図）で行うこと
  assert.match(
    app,
    /addEventListener\('afterprint'/,
    '印刷の終わりを待たずに片付けている。iPadで紙が白紙になる'
  );

  // window.print() の直後に src を消していないこと
  const afterPrint = app.slice(app.indexOf('window.print()'));
  const nextLines = afterPrint.split('\n').slice(0, 6).join('\n');
  assert.ok(
    !/removeAttribute\('src'\)/.test(nextLines),
    'window.print() の直後に絵を消している。iPadで紙が白紙になる'
  );
});

test('絵が描ける状態になるまで待ってから印刷している', () => {
  // 読み込みだけでなく「もう描ける状態」まで待つ（decode）。
  // ここを待たないと、絵がまだ無いまま印刷されて白紙になる。
  const app = read('src/ui/app.js');
  assert.match(app, /await waitForImage\(printImage\)/, '絵の準備を待たずに印刷している');
  assert.match(app, /img\.decode\(\)/, '「描ける状態」まで待っていない');
});

test('絵の準備待ちに、必ず時間切れが付いている（押しても何も起きない不具合の防止）', () => {
  // 【私（司令塔）自身が作り込んだ不具合】
  // decode() は「もう描ける状態」まで待ってくれるが、
  // **画面に出していない絵（display:none）では終わらない。**
  // 印刷用の絵はふだん画面に出していないので、まさにこれに当たった。
  // 時間切れを付けずに待った結果、**印刷ボタンを押しても何も起きなくなった**
  // （3秒待っても decode が終わらないことを実測で確認）。
  const app = read('src/ui/app.js');
  const fn = app.slice(app.indexOf('async function waitForImage'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));

  assert.match(body, /Promise\.race/, 'decode の待ちに時間切れが付いていない');
  assert.match(body, /setTimeout/, 'decode の待ちに時間切れが付いていない');
  // 読み込みの確認（complete / naturalWidth）が先にあること
  assert.match(body, /img\.complete/, '読み込みの確認をしていない');
});
