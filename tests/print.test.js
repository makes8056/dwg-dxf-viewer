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
