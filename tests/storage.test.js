// tests/storage.test.js — 図面を覚えておく係（src/storage.js）のテスト
//
// nodeにはIndexedDBが無いので、tests/render.test.js の「Canvasのふりをする入れ物」と
// 同じ考え方で、**IndexedDBのふりをする入れ物**を作って確かめる。
// 本物そっくりにはせず、storage.js が実際に呼ぶ機能（open / transaction / objectStore /
// put・get・getAll・delete・clear）だけを用意する。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveDrawing,
  loadLatestDrawing,
  listDrawings,
  loadDrawing,
  forgetDrawing,
  forgetAll,
} from '../src/storage.js';

// ============================================================
// IndexedDBのふりをする入れ物
// ============================================================

/**
 * 偽のIndexedDB環境を作る。
 * @param {object} [options]
 * @param {boolean} [options.unavailable]  true なら「IndexedDBが無い環境」を表す（globalThis.indexedDBに差し込まない）
 * @param {boolean} [options.failOpen]     true なら open() がいつも失敗する（プライベートブラウズ等の想定）
 * @param {boolean} [options.quotaOnPut]   true なら put() がいつも QuotaExceededError で失敗する（容量オーバーの想定）
 */
function makeFakeIndexedDB({ failOpen = false, quotaOnPut = false } = {}) {
  // データベース名 → { stores: Map(保管庫名 → Map(キー → 値)) }
  const databases = new Map();

  function makeRequest() {
    return { onsuccess: null, onerror: null, result: undefined, error: undefined };
  }
  function fireSuccess(req, result) {
    req.result = result;
    queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
  }
  function fireError(req, error) {
    req.error = error;
    queueMicrotask(() => req.onerror && req.onerror({ target: req }));
  }

  function makeStoreObject(storeMap) {
    return {
      put(value) {
        const req = makeRequest();
        if (quotaOnPut) {
          const err = new Error('容量が足りません（テスト用）');
          err.name = 'QuotaExceededError';
          fireError(req, err);
        } else {
          storeMap.set(value.name, { ...value });
          fireSuccess(req, value.name);
        }
        return req;
      },
      get(key) {
        const req = makeRequest();
        const found = storeMap.get(key);
        fireSuccess(req, found ? { ...found } : undefined);
        return req;
      },
      getAll() {
        const req = makeRequest();
        fireSuccess(req, Array.from(storeMap.values()).map((v) => ({ ...v })));
        return req;
      },
      delete(key) {
        const req = makeRequest();
        storeMap.delete(key);
        fireSuccess(req, undefined);
        return req;
      },
      clear() {
        const req = makeRequest();
        storeMap.clear();
        fireSuccess(req, undefined);
        return req;
      },
    };
  }

  function makeDB(entry) {
    return {
      objectStoreNames: { contains: (n) => entry.stores.has(n) },
      createObjectStore(name) {
        const map = new Map();
        entry.stores.set(name, map);
        return makeStoreObject(map);
      },
      transaction(name) {
        const map = entry.stores.get(name);
        return { objectStore: () => makeStoreObject(map) };
      },
      close() {},
    };
  }

  return {
    open(name, version) {
      const req = makeRequest();
      queueMicrotask(() => {
        if (failOpen) {
          fireError(req, new Error('開けません（テスト用）'));
          return;
        }
        let entry = databases.get(name);
        const isNew = !entry;
        if (!entry) {
          entry = { stores: new Map(), version };
          databases.set(name, entry);
        }
        const db = makeDB(entry);
        if (isNew && req.onupgradeneeded) {
          req.onupgradeneeded({ target: { result: db } });
        }
        req.result = db;
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

function bufferOf(text) {
  return new TextEncoder().encode(text).buffer;
}
function textOf(buffer) {
  return new TextDecoder().decode(buffer);
}

// node の globalThis.navigator は getter だけで直接代入できないので、
// Object.defineProperty で差し替える（テストの中だけの都合）。
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

// 各テストの前後で globalThis.indexedDB / navigator を元に戻す
const originalIndexedDB = globalThis.indexedDB;
const originalNavigator = globalThis.navigator;

test.afterEach(() => {
  if (originalIndexedDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIndexedDB;
  setNavigator(originalNavigator);
});

// ============================================================
// ふつうの読み書き
// ============================================================

test('覚えたものが取り出せる（中身のバイト列が一致する）', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();

  const ok = await saveDrawing('参考図.dxf', bufferOf('DXFの中身そのもの'));
  assert.equal(ok, true);

  const loaded = await loadDrawing('参考図.dxf');
  assert.ok(loaded, '取り出せていない');
  assert.equal(loaded.name, '参考図.dxf');
  assert.equal(textOf(loaded.buffer), 'DXFの中身そのもの', 'バイト列が一致しない');
  assert.equal(typeof loaded.savedAt, 'number');
});

test('新しい順で並ぶ（listDrawings）', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();

  await saveDrawing('1番目.dxf', bufferOf('a'));
  await saveDrawing('2番目.dxf', bufferOf('b'));
  await saveDrawing('3番目.dxf', bufferOf('c'));

  const list = await listDrawings();
  assert.deepEqual(
    list.map((d) => d.name),
    ['3番目.dxf', '2番目.dxf', '1番目.dxf'],
    '新しい順に並んでいない'
  );
  // buffer は含めない
  for (const d of list) {
    assert.equal('buffer' in d, false, '一覧に中身（buffer）が含まれている');
    assert.equal(typeof d.size, 'number');
  }
});

test('11件目を覚えると、いちばん古いものが消えて10件になる', async () => {
  // 覚えておく数は10件（開発ルール20.4。2026-09-03 にユーザー要望で5件→10件）
  globalThis.indexedDB = makeFakeIndexedDB();

  for (let i = 1; i <= 11; i++) {
    // eslint-disable-next-line no-await-in-loop
    await saveDrawing(`図面${i}.dxf`, bufferOf(`内容${i}`));
  }

  const list = await listDrawings();
  assert.equal(list.length, 10, '10件になっていない');
  assert.ok(
    !list.some((d) => d.name === '図面1.dxf'),
    'いちばん古い「図面1.dxf」が消えていない'
  );
  assert.ok(list.some((d) => d.name === '図面11.dxf'), '最新の「図面11.dxf」が残っていない');
});

test('10件までは、1件も消えずに全部残る', async () => {
  // ここが効いていないと、まだ余裕があるのに古い図面が消えてしまう
  globalThis.indexedDB = makeFakeIndexedDB();

  for (let i = 1; i <= 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    await saveDrawing(`図面${i}.dxf`, bufferOf(`内容${i}`));
  }

  const list = await listDrawings();
  assert.equal(list.length, 10, '10件そろっていない');
  assert.ok(list.some((d) => d.name === '図面1.dxf'), '1件目が勝手に消えている');
});

test('同じ名前を覚え直すと、増えずに置き換わる', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();

  await saveDrawing('参考図.dxf', bufferOf('古い中身'));
  await saveDrawing('参考図.dxf', bufferOf('新しい中身'));

  const list = await listDrawings();
  assert.equal(list.length, 1, '1件のはずが増えている');

  const loaded = await loadDrawing('参考図.dxf');
  assert.equal(textOf(loaded.buffer), '新しい中身', '置き換わっていない');
});

test('loadLatestDrawing はいちばん最近保存したものを返す', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();

  await saveDrawing('古い.dxf', bufferOf('old'));
  await saveDrawing('新しい.dxf', bufferOf('new'));

  const latest = await loadLatestDrawing();
  assert.equal(latest.name, '新しい.dxf');
  assert.equal(textOf(latest.buffer), 'new');
});

test('覚えていないとき loadLatestDrawing は null を返す', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();
  const latest = await loadLatestDrawing();
  assert.equal(latest, null);
});

test('forgetDrawing で1件だけ忘れる', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();

  await saveDrawing('A.dxf', bufferOf('a'));
  await saveDrawing('B.dxf', bufferOf('b'));

  const ok = await forgetDrawing('A.dxf');
  assert.equal(ok, true);

  const list = await listDrawings();
  assert.deepEqual(list.map((d) => d.name), ['B.dxf']);
});

test('forgetAll で全部忘れる', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();

  await saveDrawing('A.dxf', bufferOf('a'));
  await saveDrawing('B.dxf', bufferOf('b'));

  await forgetAll();

  const list = await listDrawings();
  assert.deepEqual(list, []);
  assert.equal(await loadLatestDrawing(), null);
});

// ============================================================
// 失敗しても落ちない（開発ルール20.5）
// ============================================================

test('IndexedDBがまったく使えない環境でも、例外を投げずに false / null / 空配列を返す', async () => {
  delete globalThis.indexedDB;

  const ok = await saveDrawing('参考図.dxf', bufferOf('x'));
  assert.equal(ok, false);

  assert.equal(await loadLatestDrawing(), null);
  assert.deepEqual(await listDrawings(), []);
  assert.equal(await loadDrawing('参考図.dxf'), null);
  assert.equal(await forgetDrawing('参考図.dxf'), false);

  // forgetAll は例外さえ投げなければよい
  await assert.doesNotReject(() => forgetAll());
});

test('open() 自体が失敗する環境（プライベートブラウズ等）でも例外を投げない', async () => {
  globalThis.indexedDB = makeFakeIndexedDB({ failOpen: true });

  const ok = await saveDrawing('参考図.dxf', bufferOf('x'));
  assert.equal(ok, false);
  assert.equal(await loadLatestDrawing(), null);
});

test('容量オーバー（QuotaExceededError）でも、例外を投げずに false を返す', async () => {
  globalThis.indexedDB = makeFakeIndexedDB({ quotaOnPut: true });

  await assert.doesNotReject(async () => {
    const ok = await saveDrawing('参考図.dxf', bufferOf('とても大きい図面のつもり'));
    assert.equal(ok, false, '容量オーバーなのに true を返している');
  });

  // 失敗したので何も覚えていないはず
  const list = await listDrawings();
  assert.deepEqual(list, []);
});

test('name や buffer の形がおかしいときも例外を投げずに false を返す', async () => {
  globalThis.indexedDB = makeFakeIndexedDB();

  assert.equal(await saveDrawing('', bufferOf('x')), false);
  assert.equal(await saveDrawing('a.dxf', 'ArrayBufferじゃない'), false);
  assert.equal(await saveDrawing(null, null), false);
});

// ============================================================
// navigator.storage.persist（無い環境でも落ちない）
// ============================================================

test('navigator.storage.persist が無い環境でも保存できる', async () => {
  setNavigator(undefined);
  globalThis.indexedDB = makeFakeIndexedDB();

  const ok = await saveDrawing('参考図.dxf', bufferOf('x'));
  assert.equal(ok, true);
});

test('navigator.storage.persist があれば呼ばれる', async () => {
  let called = false;
  setNavigator({ storage: { persist: async () => { called = true; return true; } } });
  globalThis.indexedDB = makeFakeIndexedDB();

  await saveDrawing('参考図.dxf', bufferOf('x'));
  assert.equal(called, true, 'navigator.storage.persist が呼ばれていない');
});

test('navigator.storage.persist が例外を投げても、保存は続く', async () => {
  setNavigator({
    storage: {
      persist: async () => {
        throw new Error('テスト用の失敗');
      },
    },
  });
  globalThis.indexedDB = makeFakeIndexedDB();

  const ok = await saveDrawing('参考図.dxf', bufferOf('x'));
  assert.equal(ok, true, 'persist の失敗につられて保存まで失敗している');
});
