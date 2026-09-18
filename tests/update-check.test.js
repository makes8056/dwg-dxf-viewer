// tests/update-check.test.js — 更新の見張りを、実際に動かして確かめる（開発ルール54章）
//
// 【なぜ実際に動かすのか】
// offline.test.js の更新まわりのテストは、ソースの文字を読んで「書いてあるか」を見ている。
// それでは「iPadのホーム画面のアプリで案内が出ない」は捕まえられなかった。
// ここでは、ブラウザの部品（navigator・document・window）を偽物に差し替えて、
// **iPadで起きた状況をそのまま再現**し、案内が出るかどうかを確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { startUpdateCheck } from '../src/update-check.js';

/** 何も起きない待ち（Promise の続きを1周ぶん進める）。 */
const 少し待つ = () => new Promise((r) => setImmediate(r));

/**
 * ブラウザの部品を偽物にして、startUpdateCheck を動かす。
 * @param {object} 状況
 *   active        … すでに動いている版があるか
 *   waiting       … 開いた時点で、次の版が待っているか
 *   controller    … ページの担当がいるか（iPadのホーム画面では無いことがある）
 *   見に行くと見つかる … update() を呼ぶと次の版が見つかるか
 *   見に行くと失敗する … update() が失敗するか
 */
async function 動かす(状況 = {}) {
  const 記録 = { 見に行った回数: 0, 案内: 0, 失敗: 0 };
  const registration = {
    active: 状況.active ? { state: 'activated' } : null,
    waiting: 状況.waiting ? { postMessage() {} } : null,
    installing: null,
    addEventListener() {},
    update() {
      記録.見に行った回数 += 1;
      if (状況.見に行くと失敗する) return Promise.reject(new Error('通信に失敗'));
      if (状況.見に行くと見つかる) this.waiting = { postMessage() {} };
      return Promise.resolve();
    },
  };

  const 元 = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    setInterval: globalThis.setInterval,
  };
  const 置く = (名前, 値) =>
    Object.defineProperty(globalThis, 名前, { value: 値, configurable: true, writable: true });

  置く('navigator', {
    onLine: true,
    serviceWorker: {
      controller: 状況.controller ? {} : null,
      register: async () => registration,
      addEventListener() {},
    },
  });
  置く('document', { hidden: false, addEventListener() {} });
  置く('window', { addEventListener() {}, location: { reload() {} } });
  // 30分ごとの見張りは、テストが終わらなくなるので止めておく
  globalThis.setInterval = () => 0;

  try {
    await startUpdateCheck({
      onUpdateReady: () => { 記録.案内 += 1; },
      onUpdateError: () => { 記録.失敗 += 1; },
    });
    await 少し待つ();
  } finally {
    for (const 名前 of ['navigator', 'document', 'window']) {
      if (元[名前]) Object.defineProperty(globalThis, 名前, 元[名前]);
      else delete globalThis[名前];
    }
    globalThis.setInterval = 元.setInterval;
  }
  return 記録;
}

// ------------------------------------------------------------
// 2026-09-18 ホーム画面のアプリが古い版（v0.4.8）のまま、案内も出なかった
// ------------------------------------------------------------

test('開いた瞬間に、新しい版が無いか見に行く（ホーム画面のアプリは毎回一から開かれる）', async () => {
  // iPadはしばらく使わないアプリを丸ごと閉じる。次は一から開き直される。
  // 「表に戻ったとき」「30分ごと」だけだと、一度も見に行かずに使い終わる
  const 記録 = await 動かす({ active: true, controller: true });
  assert.ok(記録.見に行った回数 >= 1, '開いたときに見に行っていない');
});

test('開いた瞬間に見に行って新しい版が見つかったら、案内を出す', async () => {
  const 記録 = await 動かす({ active: true, controller: true, 見に行くと見つかる: true });
  assert.equal(記録.案内, 1, '新しい版が見つかったのに案内していない');
});

test('ページの担当がいなくても、動いている版があって次の版が待っていれば案内を出す', async () => {
  // iPadのホーム画面のアプリで起きた形。担当（controller）がいるかどうかは
  // ページの開かれ方で変わるので、それで「初回かどうか」を決めてはいけない
  const 記録 = await 動かす({ active: true, waiting: true, controller: false });
  assert.equal(記録.案内, 1, '担当がいないだけで、案内を止めている');
});

test('はじめて開いたとき（動いている版が無い）は、「新しい版があります」と出さない', async () => {
  // はじめて開いたときも、準備が終わると「待っている版」がいっしゅん現れる。
  // これを更新と取り違えると、初めての人にいきなり案内が出る
  const 記録 = await 動かす({ active: false, waiting: true, controller: false });
  assert.equal(記録.案内, 0, 'はじめて開いた人に「新しい版があります」と出している');
});

test('同じ待っている版で、案内を二度出さない（「あとにする」で閉じた案内が勝手に出直さない）', async () => {
  // 開いた時点で待っている版がいて、開いた瞬間に見に行っても同じ版のまま
  const 記録 = await 動かす({ active: true, waiting: true, controller: true });
  assert.equal(記録.案内, 1, `同じ版で ${記録.案内} 回案内している`);
});

test('見に行って失敗したら知らせる。ただし、はじめて開いたときは知らせない', async () => {
  const 使っている人 = await 動かす({ active: true, controller: true, 見に行くと失敗する: true });
  assert.equal(使っている人.失敗, 1, '使っている人に、失敗を知らせていない（古い版に取り残される）');

  const はじめての人 = await 動かす({ active: false, controller: false, 見に行くと失敗する: true });
  assert.equal(はじめての人.失敗, 0, 'はじめて開いた人に「新しい版に切り替えられませんでした」と出している');
});

test('画面の側（app.js）で、ページの担当がいるかどうかで案内を止めていない', async () => {
  // 「初回かどうか」の見分けは update-check.js が受け持つ。
  // app.js でも controller を見て止めると、iPadのホーム画面のアプリで
  // また案内が出なくなる（2026-09-18 に実際に起きた形）
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  const 実行部分 = app
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !/serviceWorker\.controller/.test(実行部分),
    'app.js が serviceWorker.controller を見ている（ホーム画面のアプリで案内が出なくなる）'
  );
});
