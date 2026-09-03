// src/update-check.js — Service Workerの登録と、更新の見張り（開発ルール5章・21章）
//
// このファイルは「新しい版が来たこと」「オフラインで使える状態になったか」を
// 呼び出す側（src/ui/app.js。つなぎ込みは司令塔が行う）に知らせるだけ。
// 画面（バナーやボタン）はここでは一切作らない。1ファイル1役割（開発ルール2.2）。
//
// 【黙って更新しない】新しい版のService Workerが見つかっても、ここでは何もしない。
// 呼び出す側が onUpdateReady で渡された applyUpdate() を、
// ユーザーが「更新」ボタンなどを押したときにだけ呼ぶことで初めて切り替わる（開発ルール5.2）。

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 開きっぱなしのときに見に行く間隔（30分）
// 表に戻ってくるたびに見に行くが、短い間に何度も繰り返さないための最短間隔（30秒）
const MIN_CHECK_GAP_MS = 30 * 1000;

/**
 * Service Worker を登録し、新しい版が来たら知らせる。
 *
 * @param {object} handlers
 *   onUpdateReady(applyUpdate) … 新しい版が待機状態になった。
 *                                applyUpdate() を呼ぶと切り替わって画面が読み直される
 *   onOffline(ready)           … オフラインで使える状態になったか（true/false）
 * @returns {Promise<void>}
 */
export async function startUpdateCheck(handlers = {}) {
  const onUpdateReady = typeof handlers.onUpdateReady === 'function' ? handlers.onUpdateReady : () => {};
  const onOffline = typeof handlers.onOffline === 'function' ? handlers.onOffline : () => {};

  // Service Worker が使えない環境（古いブラウザ等）では、何もせず静かに終える。
  // このアプリはオンラインでも普通に開けるので、ここで落としてはいけない。
  if (!('serviceWorker' in navigator)) {
    onOffline(false);
    return;
  }

  let registration;
  try {
    registration = await navigator.serviceWorker.register('./service-worker.js');
  } catch (e) {
    // 登録に失敗しても、アプリ自体はオンラインで動き続けられるようにする。
    onOffline(false);
    return;
  }

  // すでに有効なService Workerがいれば、オフラインで使える状態とみなす。
  onOffline(Boolean(registration.active || navigator.serviceWorker.controller));

  // 新しい版に一度だけ切り替えるための仕掛け。
  // controllerchange は「SKIP_WAITING が効いて、担当のSWが交代した」ときに1回だけ発火するが、
  // 予期しないタイミングでも発火しうるため、こちらから切り替えを指示したときだけ読み直す。
  let reloading = false;
  let updateRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested || reloading) return;
    reloading = true; // 何度も読み直さないようにする
    window.location.reload();
  });

  // 待機中（installed）のService Workerが見つかったら知らせる。
  function notifyIfWaiting(reg) {
    const waiting = reg.waiting;
    if (!waiting) return;
    onUpdateReady(() => {
      updateRequested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  }

  // 登録した時点ですでに待機中のSWがいる場合（ページを開いた直後に検出済みだったケース）
  notifyIfWaiting(registration);

  // 新しいService Workerが見つかるたびに、installed になるのを待って知らせる。
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        notifyIfWaiting(registration);
      }
    });
  });

  // ------------------------------------------------------------
  // いつ更新を見に行くか
  //
  // 【iPadで分かったこと】
  // アプリを裏に回した（他のアプリに切り替えた）状態では、
  // **iPadが時計を止めてしまうため、下の「30分ごと」が動きません。**
  // そのため、裏から戻ってきても新しい版に気づけませんでした。
  // 実際に「バックグラウンドで待機している間に更新が来ても気づかない」と報告がありました。
  //
  // そこで「**表に戻ってきた瞬間**」にも見に行きます。ここが実質いちばん効きます。
  // ------------------------------------------------------------

  let lastCheckedAt = Date.now();

  /**
   * 更新を見に行く。
   * ネットワークが無ければ静かに失敗するだけなので、オフラインでも問題ない。
   * @param {boolean} force 前回からの間隔を気にせず必ず見に行くか
   */
  function checkForUpdate(force = false) {
    const now = Date.now();
    // 短い間に何度も見に行かないようにする（画面の切り替えを繰り返したときの無駄を防ぐ）
    if (!force && now - lastCheckedAt < MIN_CHECK_GAP_MS) return;
    lastCheckedAt = now;
    registration.update().catch(() => {});
  }

  // 1. 表に戻ってきたとき（他のアプリから切り替えて戻ってきた／画面を点けた）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate();
  });

  // 2. ウィンドウが選ばれたとき（パソコンで別のウィンドウから戻ってきた場合）
  window.addEventListener('focus', () => checkForUpdate());

  // 3. 「戻る」で開き直されたとき。
  //    ブラウザはページをそのまま冷凍保存して復活させることがある（bfcache）。
  //    このとき visibilitychange が起きないことがあるので、別に見張る。
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) checkForUpdate(true);
  });

  // 4. 開きっぱなしのときのために、ときどき見に行く（現場で開いたままのことがある）
  setInterval(() => checkForUpdate(true), UPDATE_CHECK_INTERVAL_MS);
}
