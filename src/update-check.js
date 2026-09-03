// src/update-check.js — Service Workerの登録と、更新の見張り（開発ルール5章・21章）
//
// このファイルは「新しい版が来たこと」「オフラインで使える状態になったか」を
// 呼び出す側（src/ui/app.js。つなぎ込みは司令塔が行う）に知らせるだけ。
// 画面（バナーやボタン）はここでは一切作らない。1ファイル1役割（開発ルール2.2）。
//
// 【黙って更新しない】新しい版のService Workerが見つかっても、ここでは何もしない。
// 呼び出す側が onUpdateReady で渡された applyUpdate() を、
// ユーザーが「更新」ボタンなどを押したときにだけ呼ぶことで初めて切り替わる（開発ルール5.2）。

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30分に1回（現場で開きっぱなしのことがあるため）

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

  // アプリを開いている間も、ときどき更新を見に行く（現場で開きっぱなしのことがあるため）。
  // registration.update() はネットワークが無ければ静かに失敗するだけなので、オフラインでも問題ない。
  setInterval(() => {
    registration.update().catch(() => {});
  }, UPDATE_CHECK_INTERVAL_MS);
}
