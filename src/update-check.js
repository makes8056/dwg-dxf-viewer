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
 *   onUpdateError(理由)         … 新しい版を取り込もうとして失敗した（開発ルール40章）
 * @returns {Promise<void>}
 */
export async function startUpdateCheck(handlers = {}) {
  const onUpdateReady = typeof handlers.onUpdateReady === 'function' ? handlers.onUpdateReady : () => {};
  const onOffline = typeof handlers.onOffline === 'function' ? handlers.onOffline : () => {};
  const onUpdateError = typeof handlers.onUpdateError === 'function' ? handlers.onUpdateError : () => {};

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
  //
  // 【一度きりにする理由】見に行くたびに呼ぶ作りにしたので（下記）、
  // 同じ待機中のSWで何度も案内を出し直さないよう、相手を覚えておく。
  // ユーザーが「あとにする」で閉じた案内が、勝手に出直してくるのを防ぐ。
  let 案内済みのSW = null;
  function notifyIfWaiting(reg) {
    const waiting = reg.waiting;
    if (!waiting) return;
    if (waiting === 案内済みのSW) return;
    案内済みのSW = waiting;
    onUpdateReady(() => {
      updateRequested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  }

  // 登録した時点ですでに待機中のSWがいる場合（ページを開いた直後に検出済みだったケース）
  notifyIfWaiting(registration);

  // 新しいService Workerが見つかるたびに、結果が出るのを待って知らせる。
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    // この新しいSWが、一度でも「取り込めた（installed）」ところまで行けたか。
    let 取り込めた = false;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        取り込めた = true;
        notifyIfWaiting(registration);
        return;
      }
      // 【開発ルール40章】取り込みに失敗すると redundant になる。
      // ここを黙って見逃していたため、iPadが古い版のまま止まっていることに
      // 誰も気づけなかった。取り込めなかったことは、必ず表に出す。
      //
      // ただし redundant は、ふつうの世代交代でも起きる
      // （更新したあと、さらに新しい版に置き換わったとき）。
      // 一度も取り込めていないときだけを「失敗」とする。
      if (installing.state === 'redundant' && !取り込めた) {
        onUpdateError(
          new Error('新しい版を端末に取り込めませんでした（容量不足か、通信が途中で切れた可能性）')
        );
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
    registration
      .update()
      .then(() => {
        // 【開発ルール40章】見に行くたびに、待機中のSWがいないか確かめ直す。
        //
        // updatefound の合図だけに頼っていると、その合図を一度取りこぼしたときに
        // **二度と案内が出なくなる**。すでに待機中のSWには合図が出ないためである。
        // ここで拾い直せば、次に表へ戻ってきたときに必ず気づける。
        notifyIfWaiting(registration);
      })
      .catch((err) => {
        // ネットワークが無いだけなら、それは失敗ではない（オフラインでも使うアプリ）。
        // 通信できているのに失敗した場合だけ知らせる。
        if (navigator.onLine) onUpdateError(err);
      });
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
