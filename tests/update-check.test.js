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

/** 偽物のService Worker。状態が変わると statechange の合図を出す。 */
function 偽のSW(state) {
  const 聞き手 = [];
  return {
    state,
    addEventListener(種類, f) { if (種類 === 'statechange') 聞き手.push(f); },
    postMessage() {},
    状態を変える(次) { this.state = 次; for (const f of 聞き手) f(); },
  };
}

/**
 * ブラウザの部品を偽物にして、startUpdateCheck を動かせる状態にする。
 * **片付け() を呼ぶまで偽物は置いたまま**（裏から戻る、などをあとから起こせるように）。
 *
 * @param {object} 状況
 *   active        … すでに動いている版があるか
 *   waiting       … 開いた時点で、次の版が待っているか
 *   controller    … ページの担当がいるか（iPadのホーム画面では無いことがある）
 *   見に行くと見つかる … update() を呼ぶと次の版が（取り込み済みで）待っている
 *   見に行くと取り込みが始まる … update() を呼ぶと取り込みの最中になる
 *   新しい版の合図を取りこぼす … 取り込みが始まっても updatefound が届かない
 *   見に行くと失敗する … update() が失敗するか
 */
async function 用意する(状況 = {}) {
  const 記録 = { 見に行った回数: 0, 案内: 0, 失敗: 0, 登録の指定: null };
  const 登録の聞き手 = [];
  const 画面の聞き手 = [];
  let 今 = 1_000_000;

  const registration = {
    active: 状況.active ? 偽のSW('activated') : null,
    waiting: 状況.waiting ? 偽のSW('installed') : null,
    installing: null,
    addEventListener(種類, f) { if (種類 === 'updatefound') 登録の聞き手.push(f); },
    update() {
      記録.見に行った回数 += 1;
      if (状況.見に行くと失敗する) return Promise.reject(new Error('通信に失敗'));
      if (状況.見に行くと見つかる) this.waiting = 偽のSW('installed');
      if (状況.見に行くと取り込みが始まる) {
        this.installing = 偽のSW('installing');
        if (!状況.新しい版の合図を取りこぼす) for (const f of 登録の聞き手) f();
      }
      return Promise.resolve();
    },
  };

  const 元 = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    setInterval: globalThis.setInterval,
    now: Date.now,
  };
  const 置く = (名前, 値) =>
    Object.defineProperty(globalThis, 名前, { value: 値, configurable: true, writable: true });

  const 画面 = {
    hidden: false,
    addEventListener(種類, f) { if (種類 === 'visibilitychange') 画面の聞き手.push(f); },
  };
  置く('navigator', {
    onLine: true,
    serviceWorker: {
      controller: 状況.controller ? {} : null,
      register: async (_url, 指定) => { 記録.登録の指定 = 指定 || null; return registration; },
      addEventListener() {},
    },
  });
  置く('document', 画面);
  置く('window', { addEventListener() {}, location: { reload() {} } });
  // 30分ごとの見張りは、テストが終わらなくなるので止めておく
  globalThis.setInterval = () => 0;
  // 時間はテストの側で進める（「30秒以内に何度も見に行かない」を確かめるため）
  Date.now = () => 今;

  const 片付け = () => {
    for (const 名前 of ['navigator', 'document', 'window']) {
      if (元[名前]) Object.defineProperty(globalThis, 名前, 元[名前]);
      else delete globalThis[名前];
    }
    globalThis.setInterval = 元.setInterval;
    Date.now = 元.now;
  };

  try {
    await startUpdateCheck({
      onUpdateReady: () => { 記録.案内 += 1; },
      onUpdateError: () => { 記録.失敗 += 1; },
    });
    await 少し待つ();
  } catch (e) {
    片付け();
    throw e;
  }

  return {
    記録,
    registration,
    片付け,
    時間を進める(ミリ秒) { 今 += ミリ秒; },
    /** 裏に回る → 表に戻る（iPadで別のアプリから戻ってきたとき） */
    async 裏から戻る() {
      画面.hidden = true;
      for (const f of 画面の聞き手) f();
      画面.hidden = false;
      for (const f of 画面の聞き手) f();
      await 少し待つ();
    },
    /** 取り込みの最中だった新しい版が、取り込みに失敗する（容量不足・通信切れ） */
    async 取り込みに失敗する() {
      const sw = registration.installing;
      registration.installing = null;
      sw.状態を変える('redundant');
      await 少し待つ();
    },
    /** 取り込みの最中だった新しい版が、取り込み終わる */
    async 取り込みが終わる() {
      const sw = registration.installing;
      registration.installing = null;
      registration.waiting = sw;
      sw.状態を変える('installed');
      await 少し待つ();
    },
  };
}

/** 開いて、そのまま片付ける（開いた瞬間のことだけ見るテスト用）。 */
async function 動かす(状況 = {}) {
  const h = await 用意する(状況);
  h.片付け();
  return h.記録;
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

// ------------------------------------------------------------
// 2026-09-18 裏から戻っただけでは、更新の案内が出なかった（開発ルール55章）
// ------------------------------------------------------------

test('裏から戻ったら見に行き、取り込みが終わったところで案内を出す', async () => {
  const h = await 用意する({ active: true, controller: true, 見に行くと取り込みが始まる: true });
  try {
    // 開いた瞬間にも見に行くので、そのぶんの取り込みを終わらせてから数え直す
    await h.取り込みが終わる();
    assert.equal(h.記録.案内, 1, '開いた瞬間に見つけた新しい版で、案内していない');
  } finally {
    h.片付け();
  }
});

test('新しい版の合図（updatefound）を取りこぼしても、取り込みを見届けて案内を出す', async () => {
  // 裏に回っている間はページが凍っている。合図は届かないことがある
  const h = await 用意する({
    active: true,
    controller: true,
    見に行くと取り込みが始まる: true,
    新しい版の合図を取りこぼす: true,
  });
  try {
    await h.取り込みが終わる();
    assert.equal(h.記録.案内, 1, '合図を取りこぼしただけで、案内が出なくなっている');
  } finally {
    h.片付け();
  }
});

test('裏にいる間に取り込みが終わっていたら、表に戻った瞬間に案内を出す（30秒以内でも）', async () => {
  const h = await 用意する({ active: true, controller: true });
  try {
    assert.equal(h.記録.案内, 0);
    // 裏にいる間に、合図なしで取り込みが終わった
    h.registration.waiting = 偽のSW('installed');
    h.時間を進める(5 * 1000); // 開いてから5秒。見に行く間隔（30秒）より短い
    await h.裏から戻る();
    assert.equal(h.記録.案内, 1, '手元に新しい版が待っているのに、戻っても案内していない');
  } finally {
    h.片付け();
  }
});

test('表に戻ったとき、30秒たっていれば見に行く。たっていなければ通信しない', async () => {
  const h = await 用意する({ active: true, controller: true });
  try {
    const 開いたとき = h.記録.見に行った回数;
    h.時間を進める(10 * 1000);
    await h.裏から戻る();
    assert.equal(h.記録.見に行った回数, 開いたとき, '10秒しかたっていないのに見に行っている');
    h.時間を進める(60 * 1000);
    await h.裏から戻る();
    assert.equal(h.記録.見に行った回数, 開いたとき + 1, '30秒たったのに見に行っていない');
  } finally {
    h.片付け();
  }
});

test('新しい版を見に行くとき、ブラウザの控えを使わせない（updateViaCache: none）', async () => {
  // GitHub Pages は「10分は控えを使ってよい」と返す。控えを使われると、
  // 公開してから10分のあいだ、裏から戻っても「新しい版は無い」と判断される
  const 記録 = await 動かす({ active: true, controller: true });
  assert.equal(
    記録.登録の指定 && 記録.登録の指定.updateViaCache,
    'none',
    `登録の指定が違う：${JSON.stringify(記録.登録の指定)}`
  );
});

test('同じ取り込みを二度見届けない（失敗の知らせが二重に届かない）', async () => {
  // 見届けの入口は3つある（合図・見に行った結果・開いた時点）。
  // 同じ取り込みに2回つくと、失敗したときに知らせが2回届く
  const h = await 用意する({ active: true, controller: true, 見に行くと取り込みが始まる: true });
  try {
    await h.取り込みに失敗する();
    assert.equal(h.記録.失敗, 1, `失敗の知らせが ${h.記録.失敗} 回届いている`);
  } finally {
    h.片付け();
  }
});
