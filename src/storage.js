// storage.js — 開いた図面を端末の中（IndexedDB）に覚えておく係（開発ルール20章）
//
// 【覚えるのは「元のファイルのバイト列（ArrayBuffer）」だけ】（開発ルール20.2）
//   解析済みの図形データは覚えない。理由は2つ。
//   - 解析済みは大きくなりすぎる（大きな図面では何十MBにもなる）
//   - dxf-parse.js / dwg-parse.js の読み取り方をあとで直したとき、
//     覚えている図面にも自動で効く（解析済みだと古い読み方のまま残ってしまう）
//
// 【失敗してもアプリを止めない】（開発ルール20.5）
//   プライベートブラウズ・容量オーバー（QuotaExceededError）・端末の設定で
//   データ保存が禁止されている、など、IndexedDBが使えない場面は実際にある。
//   この係はどんな失敗でも例外を投げず、false / null / 空配列を返す。
//   （呼び出す側＝src/ui/app.js は、失敗しても気にせず今まで通り動けばよい）
//
// 【Service Worker のキャッシュとは別物】（開発ルール5.4・20.3）
//   図面の実データはここ（IndexedDB）にだけ置く。service-worker.js は一切さわらない。
//
// 【この係は globalThis.indexedDB を使う】
//   テスト（tests/storage.test.js）で「IndexedDBのふりをする入れ物」を
//   globalThis.indexedDB に差し込めるようにするため。nodeにはIndexedDBが無い。
//
// ------------------------------------------------------------
// データベースの名前・版・中身の形
// ------------------------------------------------------------
//   データベース名 : 'dxf-viewer'
//   保管庫（store）: 'drawings'　… キー（keyPath）は name（ファイル名）
//   版（version）  : 1
//   1件の中身      : { name, buffer, savedAt, size }
//     - name    : ファイル名（キー。同じ名前で覚え直すと置き換わる）
//     - buffer  : ファイルの中身そのまま（ArrayBuffer）
//     - savedAt : 覚えた時刻（Date.now()）。新しい順に並べたり、古いものを消すのに使う
//     - size    : buffer.byteLength（一覧表示のときに buffer を読み込まずに済むよう別途持つ）
//
//   【版を上げるときの決め方】
//   今後この中身の形を変えたくなったら DB_VERSION を1つ上げ、onupgradeneeded の中で
//   対応する。ここで覚えているのは「元ファイルの複製」でしかなく、消えても
//   もう一度ファイルアプリから開けば作り直せるものなので、
//   形を変える版では「古い保管庫を作り直す（中身は捨ててよい）」で構わない。
//   実害は「もう一度だけファイルを選び直させる」程度で済む。
// ------------------------------------------------------------

const DB_NAME = 'dxf-viewer';
const DB_VERSION = 1;
const STORE_NAME = 'drawings';
const MAX_DRAWINGS = 10; // 開発ルール20.4：最大10件まで。11件目は最古を消す（2026-09-03 5件→10件）

/** 日本語でそっと警告を残す。ここで失敗しても呼び出し側を止めない。 */
function warn(message, error) {
  try {
    console.warn(`[storage] ${message}`, error);
  } catch {
    // console すら無い環境もありうる。ここは無視してよい。
  }
}

/**
 * iPadなどが、しばらく使っていないアプリのデータを勝手に消すことがある対策。
 * 呼べる環境なら呼んでおく。無い環境・失敗しても落ちない。
 */
async function tryPersistStorage() {
  try {
    const storage = globalThis.navigator?.storage;
    if (storage && typeof storage.persist === 'function') {
      await storage.persist();
    }
  } catch (e) {
    warn('保存領域を優先的に残す設定に失敗しました（消えやすいままかもしれません）', e);
  }
}

/**
 * IndexedDBを開く。使えない・失敗したときは null を返す（例外を投げない）。
 * @returns {Promise<any|null>}
 */
function openDB() {
  return new Promise((resolve) => {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) {
        warn('この環境ではIndexedDBが使えません（図面を覚える機能は無効になります）');
        resolve(null);
        return;
      }
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        // 初めて作るとき（または版を上げたとき）だけ通る。
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        warn('IndexedDBを開けませんでした', req.error);
        resolve(null);
      };
    } catch (e) {
      warn('IndexedDBを開くときに問題が起きました', e);
      resolve(null);
    }
  });
}

/**
 * IndexedDBのリクエストを Promise にする。失敗しても reject せず、
 * { ok:false, error } を返す（呼び出し側で例外にしないため）。
 */
function reqPromise(request) {
  return new Promise((resolve) => {
    try {
      request.onsuccess = () => resolve({ ok: true, result: request.result });
      request.onerror = (event) => {
        const error = request.error ?? event?.target?.error ?? new Error('IndexedDBの操作に失敗しました');
        resolve({ ok: false, error });
      };
    } catch (e) {
      resolve({ ok: false, error: e });
    }
  });
}

/** db.close() があれば呼ぶ。無くても・失敗しても気にしない。 */
function closeQuietly(db) {
  try {
    db?.close?.();
  } catch {
    // 無視してよい
  }
}

// 保存した時刻（savedAt）。Date.now() だけだと、短い間隔で連続して保存したときに
// 同じミリ秒になり「新しい順」が崩れることがある（実際にテストで再現した）。
// 必ず前回より大きい値になるようにして、順序を保証する。
let lastSavedAt = 0;
function nextSavedAt() {
  const now = Date.now();
  lastSavedAt = now > lastSavedAt ? now : lastSavedAt + 1;
  return lastSavedAt;
}

/**
 * 図面を覚えておく。同じ名前の図面がすでにあれば、新しいほうで置き換える。
 * @param {string} name ファイル名（例 '参考図.dxf'）
 * @param {ArrayBuffer} buffer ファイルの中身そのまま
 * @returns {Promise<boolean>} 覚えられたら true、だめでも false を返す（例外を投げない）
 */
export async function saveDrawing(name, buffer) {
  if (typeof name !== 'string' || !name || !(buffer instanceof ArrayBuffer)) {
    warn('保存する名前かデータの形がおかしいので、覚えるのをやめました');
    return false;
  }

  await tryPersistStorage();

  const db = await openDB();
  if (!db) return false;

  try {
    // 1. 今覚えている一覧を調べる（同じ名前で覚え直す場合は数に入れない）
    const listRes = await reqPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    if (!listRes.ok) {
      warn('覚えている図面の一覧を読めませんでした', listRes.error);
      return false;
    }
    const others = listRes.result.filter((r) => r.name !== name);
    others.sort((a, b) => a.savedAt - b.savedAt); // 古い順

    // 2. 新しく1件加えても5件を超えないよう、超える分だけ古いものから消す（20.4）
    const overflow = others.length - (MAX_DRAWINGS - 1);
    const namesToDelete = overflow > 0 ? others.slice(0, overflow).map((r) => r.name) : [];

    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);

    for (const oldName of namesToDelete) {
      const delRes = await reqPromise(store.delete(oldName));
      if (!delRes.ok) {
        warn(`古い図面（${oldName}）を消せませんでした`, delRes.error);
        return false;
      }
    }

    const record = { name, buffer, savedAt: nextSavedAt(), size: buffer.byteLength };
    const putRes = await reqPromise(store.put(record));
    if (!putRes.ok) {
      // ここが容量オーバー（QuotaExceededError）などの主な出口。
      warn('図面を覚えられませんでした（容量オーバーなどの可能性）', putRes.error);
      return false;
    }
    return true;
  } catch (e) {
    warn('図面を覚える処理で問題が起きました', e);
    return false;
  } finally {
    closeQuietly(db);
  }
}

/**
 * いちばん最近開いた図面を取り出す。
 * @returns {Promise<{name:string, buffer:ArrayBuffer, savedAt:number}|null>}
 *          無ければ null（例外を投げない）
 */
export async function loadLatestDrawing() {
  const db = await openDB();
  if (!db) return null;

  try {
    const res = await reqPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    if (!res.ok || !res.result || res.result.length === 0) return null;

    const latest = res.result.reduce((newest, r) => (r.savedAt > newest.savedAt ? r : newest));
    return { name: latest.name, buffer: latest.buffer, savedAt: latest.savedAt };
  } catch (e) {
    warn('最近開いた図面を取り出すときに問題が起きました', e);
    return null;
  } finally {
    closeQuietly(db);
  }
}

/**
 * 覚えている図面の一覧（新しい順）。中身（buffer）は含めない。
 * @returns {Promise<Array<{name:string, savedAt:number, size:number}>>}
 */
export async function listDrawings() {
  const db = await openDB();
  if (!db) return [];

  try {
    const res = await reqPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    if (!res.ok || !res.result) return [];

    return res.result
      .map((r) => ({ name: r.name, savedAt: r.savedAt, size: r.size }))
      .sort((a, b) => b.savedAt - a.savedAt); // 新しい順
  } catch (e) {
    warn('覚えている図面の一覧を取り出すときに問題が起きました', e);
    return [];
  } finally {
    closeQuietly(db);
  }
}

/**
 * 名前を指定して取り出す。
 * @param {string} name
 * @returns {Promise<{name:string, buffer:ArrayBuffer, savedAt:number}|null>}
 */
export async function loadDrawing(name) {
  if (typeof name !== 'string' || !name) return null;

  const db = await openDB();
  if (!db) return null;

  try {
    const res = await reqPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(name));
    if (!res.ok || !res.result) return null;

    const r = res.result;
    return { name: r.name, buffer: r.buffer, savedAt: r.savedAt };
  } catch (e) {
    warn('図面を取り出すときに問題が起きました', e);
    return null;
  } finally {
    closeQuietly(db);
  }
}

/**
 * 名前を指定して忘れる。
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function forgetDrawing(name) {
  if (typeof name !== 'string' || !name) return false;

  const db = await openDB();
  if (!db) return false;

  try {
    const res = await reqPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(name));
    if (!res.ok) {
      warn(`図面（${name}）を忘れられませんでした`, res.error);
    }
    return res.ok;
  } catch (e) {
    warn('図面を忘れる処理で問題が起きました', e);
    return false;
  } finally {
    closeQuietly(db);
  }
}

/** 覚えているものを全部忘れる。 */
export async function forgetAll() {
  const db = await openDB();
  if (!db) return;

  try {
    const res = await reqPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear());
    if (!res.ok) {
      warn('覚えているものを全部忘れる処理に失敗しました', res.error);
    }
  } catch (e) {
    warn('全部忘れる処理で問題が起きました', e);
  } finally {
    closeQuietly(db);
  }
}
