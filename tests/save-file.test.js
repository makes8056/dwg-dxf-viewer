// tests/save-file.test.js — 保存の道の選び方を、実際に動かして確かめる（開発ルール56章）
//
// 2026-09-24 ユーザーの指示：
//   「PDFで保存するときに保存先を指定できるようにしてください。
//     どこに保存されたかわからなくなる時があります」
//
// **置き場所を選べる道から順に試す**ことを、iPad・パソコン・どちらでもない機械の
// 3通りをまねて確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { saveFile, fileTypeOf, 共有メニュー, 保存先を選ぶ画面, ダウンロード } from '../src/save-file.js';

/** 何も起きない待ち（Promise の続きを進める）。 */
const 少し待つ = () => new Promise((r) => setImmediate(r));

/** 保存する中身のかわり。中身は何でもよい。 */
const 中身 = { size: 123, type: 'application/pdf' };

/** やめたときにブラウザが返すのと同じ形の断り。 */
function やめた() {
  const err = new Error('やめました');
  err.name = 'AbortError';
  return err;
}

/**
 * 道具と知らせを、記録を取れる形で用意する。
 * @param {object} 好み どの道具を持たせるか
 */
function 用意する(好み = {}) {
  const 記録 = { 共有した: null, 選ぶ画面を出した: null, ダウンロードした: null, 保存できた: [], やめた: 0, 失敗: [], 書いた: [] };
  const 道具 = {
    isApple: Boolean(好み.isApple),
    makeFile: (b, 名前, 種類) => ({ b, 名前, 種類 }),
    download: 好み.ダウンロードできない
      ? undefined
      : (b, 名前) => {
          if (好み.ダウンロードで失敗する) throw new Error('保存できない');
          記録.ダウンロードした = { b, 名前 };
        },
  };
  if (好み.共有できる) {
    道具.share = (データ) => {
      記録.共有した = データ;
      if (好み.共有をやめる) return Promise.reject(やめた());
      if (好み.共有で失敗する) return Promise.reject(new Error('共有できない'));
      return Promise.resolve();
    };
    if (好み.canShareを持つ) 道具.canShare = () => !好み.canShareが断る;
  }
  if (好み.選ぶ画面が使える) {
    道具.showSaveFilePicker = (指定) => {
      記録.選ぶ画面を出した = 指定;
      if (好み.選ぶのをやめる) return Promise.reject(やめた());
      if (好み.選ぶ画面で失敗する) return Promise.reject(new Error('出せない'));
      return Promise.resolve({
        createWritable: async () => ({
          write: async (b) => { 記録.書いた.push(b); },
          close: async () => {},
        }),
      });
    };
  }
  const 知らせ = {
    onSaved: (方法) => 記録.保存できた.push(方法),
    onCancel: () => { 記録.やめた += 1; },
    onError: (err) => 記録.失敗.push(err),
  };
  return { 記録, 道具, 知らせ };
}

// ------------------------------------------------------------
// どの道を選ぶか
// ------------------------------------------------------------

test('iPadでは共有メニューを開く（「ファイルに保存」で置き場所を選べる）', async () => {
  const { 記録, 道具, 知らせ } = 用意する({ isApple: true, 共有できる: true, canShareを持つ: true });
  const 方法 = saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  assert.equal(方法, 共有メニュー);
  assert.ok(記録.共有した, '共有メニューを開いていない');
  assert.equal(記録.共有した.files[0].名前, '図面.pdf');
  assert.deepEqual(記録.保存できた, [共有メニュー]);
  assert.equal(記録.ダウンロードした, null, '置き場所を選べない道に落ちている');
});

test('パソコンでは「名前を付けて保存」の画面を出し、そこへ書き込む', async () => {
  const { 記録, 道具, 知らせ } = 用意する({ 選ぶ画面が使える: true });
  const 方法 = saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  await 少し待つ();
  assert.equal(方法, 保存先を選ぶ画面);
  assert.equal(記録.選ぶ画面を出した.suggestedName, '図面.pdf', '最初に出す名前を渡していない');
  assert.deepEqual(記録.書いた, [中身], '選んだ先に中身を書いていない');
  assert.deepEqual(記録.保存できた, [保存先を選ぶ画面]);
});

test('どちらも使えない機械では、ダウンロードで保存する（最後の道）', async () => {
  const { 記録, 道具, 知らせ } = 用意する({});
  const 方法 = saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  assert.equal(方法, ダウンロード);
  assert.deepEqual(記録.ダウンロードした, { b: 中身, 名前: '図面.pdf' });
  // 呼び出す側が「どこに入ったか」を画面に出せるよう、どの道を使ったかを渡す
  assert.deepEqual(記録.保存できた, [ダウンロード]);
});

test('iPadでも、その中身を共有できないと言われたら、選ぶ画面やダウンロードへ回す', async () => {
  const { 記録, 道具, 知らせ } = 用意する({
    isApple: true, 共有できる: true, canShareを持つ: true, canShareが断る: true,
  });
  const 方法 = saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  assert.equal(方法, ダウンロード);
  assert.equal(記録.共有した, null, '共有できないのに共有を呼んでいる');
  assert.ok(記録.ダウンロードした, '保存をあきらめている');
});

test('パソコン（iPadでない）では、共有メニューを使わない', async () => {
  // Windowsの共有にはプリントも「ファイルに保存」も無い（開発ルール37.2）
  const { 記録, 道具, 知らせ } = 用意する({ isApple: false, 共有できる: true, 選ぶ画面が使える: true });
  const 方法 = saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  assert.equal(方法, 保存先を選ぶ画面);
  assert.equal(記録.共有した, null, 'パソコンで共有メニューを使っている');
});

// ------------------------------------------------------------
// 途中でやめたとき・うまくいかなかったとき
// ------------------------------------------------------------

test('共有を自分でやめたときは、失敗にしない（何も出さない）', async () => {
  const { 記録, 道具, 知らせ } = 用意する({ isApple: true, 共有できる: true, 共有をやめる: true });
  saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  assert.equal(記録.やめた, 1, 'やめたことを伝えていない');
  assert.deepEqual(記録.失敗, [], 'やめただけなのに失敗にしている');
  assert.equal(記録.ダウンロードした, null, 'やめたのに勝手に保存している');
});

test('「名前を付けて保存」をやめたときも、失敗にしないし勝手に保存もしない', async () => {
  const { 記録, 道具, 知らせ } = 用意する({ 選ぶ画面が使える: true, 選ぶのをやめる: true });
  saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  assert.equal(記録.やめた, 1);
  assert.equal(記録.ダウンロードした, null, 'やめたのに勝手に保存している');
});

test('共有がうまくいかなかったときは、黙って終わらせずダウンロードで保存する', async () => {
  const { 記録, 道具, 知らせ } = 用意する({ isApple: true, 共有できる: true, 共有で失敗する: true });
  saveFile(中身, '図面.pdf', 道具, 知らせ);
  await 少し待つ();
  await 少し待つ();
  assert.ok(記録.ダウンロードした, '保存をあきらめている（何も起きないのがいちばん困る）');
  assert.deepEqual(記録.保存できた, [ダウンロード]);
});

test('保存するものが無いときは、はっきり知らせる', () => {
  const { 記録, 道具, 知らせ } = 用意する({});
  const 方法 = saveFile(null, '図面.pdf', 道具, 知らせ);
  assert.equal(方法, null);
  assert.equal(記録.失敗.length, 1, '黙って終わっている');
  assert.equal(記録.ダウンロードした, null);
});

test('どの道も使えないときは、黙って終わらず知らせる', () => {
  const { 記録, 道具, 知らせ } = 用意する({ ダウンロードできない: true });
  const 方法 = saveFile(中身, '図面.pdf', 道具, 知らせ);
  assert.equal(方法, null);
  assert.equal(記録.失敗.length, 1, '黙って終わっている');
  assert.deepEqual(記録.保存できた, [], '保存できていないのに「保存できた」と言っている');
});

test('ダウンロードそのものが失敗したら、「保存できた」と言わない', () => {
  const { 記録, 道具, 知らせ } = 用意する({ ダウンロードで失敗する: true });
  saveFile(中身, '図面.pdf', 道具, 知らせ);
  assert.deepEqual(記録.保存できた, [], '失敗したのに「保存できた」と言っている');
  assert.equal(記録.失敗.length, 1);
});

// ------------------------------------------------------------
// ファイルの種類
// ------------------------------------------------------------

test('PDFと絵で、ファイルの種類を変える（間違えると保存先に出てこない）', () => {
  assert.equal(fileTypeOf('図面.pdf'), 'application/pdf');
  assert.equal(fileTypeOf('図面.PDF'), 'application/pdf', '大文字の拡張子を見ていない');
  assert.equal(fileTypeOf('図面.png'), 'image/png');
});

test('PDFが作れず絵になったときも、その種類で共有する', async () => {
  const { 記録, 道具, 知らせ } = 用意する({ isApple: true, 共有できる: true });
  saveFile(中身, '図面.png', 道具, 知らせ);
  await 少し待つ();
  assert.equal(記録.共有した.files[0].種類, 'image/png');
});

// ------------------------------------------------------------
// 開発ルール28.3：指で押した流れを止めない
// ------------------------------------------------------------

test('共有を呼ぶ前に待ち時間を入れない（iPadが共有メニューを開かせなくなる）', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/save-file.js', import.meta.url), 'utf8');
  const 中 = src.slice(src.indexOf('export function saveFile'));
  const 共有より前 = 中.slice(0, 中.indexOf('道具.share('));
  const 実行部分 = 共有より前
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/\bawait\b/.test(実行部分), '共有を呼ぶ前に待ち時間が入っている');
});
