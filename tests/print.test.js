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

// ============================================================
// 【印刷のやり方を変えた】（v0.2.2 / 開発ルール28章）
//
// 実機で分かったこと：
//   - 印刷画面で紙の向きを変えるとページが作り直され、そのとき絵が消えた
//   - 一度消えると、次に印刷しても二度と絵が出なかった
//   - 紙の余白にURLと日付が印刷される（iPadではCSSで止められない）
//
// そこで**ページを印刷するのをやめ、絵そのものをiPadへ渡す**ことにした。
// ============================================================

test('印刷の前に、絵を確認する画面を出している', () => {
  // 現場で紙を無駄にしないため、押す前に必ず目で確かめてもらう
  const app = read('src/ui/app.js');
  assert.match(app, /printPreview\.show\(/, '確認の画面を出していない');
});

test('絵をファイルとしてiPadへ渡している（URL・日付を出さないため）', () => {
  // ページを印刷しないので、ブラウザがURLや日付を入れる余地がそもそも無い
  const app = read('src/ui/app.js');
  assert.match(app, /navigator\.share/, '共有メニューへ渡していない');
  assert.match(app, /files:\s*\[file\]/, 'ファイルとして渡していない');
});

test('「プリント」を押した流れの中で、待たずに共有メニューを開いている', () => {
  // iPadは、間に待ち時間（await）が入ると共有メニューを開かせないことがある。
  // そのため絵は先に作っておき、押した瞬間は渡すだけにする（開発ルール28.3）。
  const app = read('src/ui/app.js');
  const i = app.indexOf('function handOverToPrint');
  assert.ok(i >= 0, '渡す処理が見つからない');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.ok(
    !/\bawait\b/.test(body),
    '共有メニューを開く前に待ち時間が入っている。iPadで共有メニューが開かなくなる'
  );
});

test('印刷中に絵を片付けようとしていない', () => {
  // 【iPadで起きた本番不具合】
  // 印刷画面で紙の向きを変えるとページが作り直され、そのとき「印刷が終わった」合図が飛ぶ。
  // その合図で片付けると**絵が消え、以降は二度と印刷できなくなる。**
  // 絵は消さなくてよい（画面には出ない作りなので、置いたままで害が無い）。
  const app = read('src/ui/app.js');
  assert.ok(
    !/afterprint/.test(app),
    '印刷の終わりで片付けようとしている。紙の向きを変えると絵が消える'
  );
  assert.ok(
    !/printImage\.removeAttribute\('src'\)/.test(app),
    '印刷用の絵を消している。次に印刷できなくなる'
  );
});

test('確認画面は紙に出さない', () => {
  const css = read('src/ui/print-preview.css');
  assert.match(
    css,
    /@media\s+print\s*\{[\s\S]*?\.pv-overlay[\s\S]*?display\s*:\s*none/,
    '確認画面が紙に印刷されてしまう'
  );
});

test('確認画面のボタンは、指で押しやすい大きさ', () => {
  // 手袋をしていても押せるように（開発ルール11章）
  const css = read('src/ui/print-preview.css');
  const m = css.match(/\.pv-cancel,\s*\n\.pv-print\s*\{([\s\S]*?)\}/);
  assert.ok(m, 'ボタンの指定が見つからない');
  const h = m[1].match(/min-height\s*:\s*(\d+)px/);
  assert.ok(h && Number(h[1]) >= 44, `ボタンの高さが44px未満: ${h && h[1]}`);
});

test('絵をファイルに直す処理が、待ち時間を作らない', () => {
  // toBlob() は待ち時間が入るので使わない（開発ルール28.3）。
  // 待ち時間が入ると、iPadが共有メニューを開かせないことがある。
  const pa = read('src/print-area.js');
  assert.match(pa, /export function dataUrlToBlob/, 'ファイルに直す処理が無い');
  const i = pa.indexOf('export function dataUrlToBlob');
  const body = pa.slice(i, pa.indexOf('\n}\n', i));
  assert.ok(!/\basync\b|\bawait\b/.test(body), '待ち時間が入る作りになっている');
});


