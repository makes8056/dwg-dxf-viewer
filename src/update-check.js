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
    // 【updateViaCache: 'none'（開発ルール55章）】
    // 新しい版があるかを見に行くとき、service-worker.js を**ブラウザの控え（HTTPキャッシュ）から
    // 読まず、必ず公開先へ取りに行かせる。**
    // GitHub Pages は「10分は控えを使ってよい」と返すので（21章）、控えを使われると、
    // 公開してから10分のあいだ裏から戻っても**古いまま「新しい版は無い」**と判断されてしまう。
    registration = await navigator.serviceWorker.register('./service-worker.js', {
      updateViaCache: 'none',
    });
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
    // 【更新かどうかは、ここで決める（開発ルール54章）】
    // すでに動いている版（active）があって、そのうえで次の版が待っているときだけが「更新」。
    // はじめて開いたときは active が無いので、案内を出さない。
    //
    // 以前は画面の側で「開いた瞬間にページの担当（controller）がいたか」で見分けていた。
    // ところがiPadのホーム画面のアプリでは、**新しい版が待っていても案内が出ない**ことがあった。
    // 担当がいたかどうかは、ページの開かれ方で変わる。版があるかどうかは変わらない。
    if (!reg.active) return;
    if (waiting === 案内済みのSW) return;
    案内済みのSW = waiting;
    onUpdateReady(() => {
      updateRequested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  }

  // 登録した時点ですでに待機中のSWがいる場合（ページを開いた直後に検出済みだったケース）
  notifyIfWaiting(registration);

  // 新しいService Workerの取り込みを、終わるまで見届けて知らせる。
  //
  // 【見届けを始める入口を3つにした（開発ルール55章）】
  //   - 新しい版が見つかった合図（updatefound）
  //   - 見に行った結果、取り込みの最中だったとき
  //   - 開いた時点で、すでに取り込みの最中だったとき
  // 裏に回っている間はページが凍っているので、合図を**取りこぼす**ことがある。
  // 合図が1つだけだと、取りこぼした時点で案内が出なくなる。
  // 同じSWを二度見届けないよう、見届け中のものは覚えておく。
  const 見届け中 = new WeakSet();
  function 見届ける(installing) {
    if (!installing || 見届け中.has(installing)) return;
    見届け中.add(installing);
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
      if (installing.state === 'redundant' && !取り込めた && registration.active) {
        onUpdateError(
          new Error('新しい版を端末に取り込めませんでした（容量不足か、通信が途中で切れた可能性）')
        );
      }
    });
  }

  registration.addEventListener('updatefound', () => 見届ける(registration.installing));
  // 開いた時点で、すでに取り込みの最中だった場合
  見届ける(registration.installing);

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
    // 【通信の前に、まず手元を確かめる（開発ルール55章）】
    // 裏にいる間に取り込みが終わっていたら、そのときの合図は取りこぼしている。
    // 「待っている版」は手元にあるので、見に行く間隔（30秒）に関係なく、
    // 表に戻った瞬間に案内する。通信は要らないので何度呼んでもよい。
    notifyIfWaiting(registration);

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
        // 見に行った時点では、まだ取り込みの最中のことが多い
        // （update() は、取り込みが終わるのを待たずに返ってくる）。
        // その場合は、終わるまで見届けてから知らせる。
        見届ける(registration.installing);
      })
      .catch((err) => {
        // ネットワークが無いだけなら、それは失敗ではない（オフラインでも使うアプリ）。
        // 通信できているのに失敗した場合だけ知らせる。
        if (navigator.onLine && registration.active) onUpdateError(err);
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

  // 5. **開いた瞬間**にも見に行く（開発ルール54章）
  //
  // 【iPadのホーム画面のアプリで、古い版のまま止まっていた（2026-09-18）】
  // 上の1〜4は、どれも「開いたあとで何かが起きたとき」にしか動かない。
  // ホーム画面のアプリは、しばらく使わないとiPadに**丸ごと閉じられ**、
  // 次は一から開き直される。そのとき：
  //   - 表に戻る（1）… 最初から表にいるので起きない
  //   - ウィンドウが選ばれる（2）… iPadでは起きない
  //   - 冷凍保存からの復活（3）… 一から開いたので起きない
  //   - 30分ごと（4）… 30分使い続けないと来ない
  // つまり**一度も見に行かないまま**使い終わっていた。
  //
  // また、登録（register）は、すでに登録済みなら**見に行かずに終わる**決まりなので、
  // 登録し直しても代わりにはならない。ここで自分から見に行く。
  checkForUpdate(true);
}
