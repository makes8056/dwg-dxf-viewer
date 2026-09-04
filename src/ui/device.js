// device.js — 「今どんな機械で動いているか」を見分ける係（開発ルール37章）
//
// このファイルは見分けるだけ。見分けた結果で何をするかは、使う側が決める。
//
// 【なぜ要るのか】
//   iPadとパソコンでは、印刷のやり方も、案内に書くべき言葉も違う。
//   同じ判定をあちこちに書くと、片方だけ直したときに必ず食い違う（2.2）。

/**
 * 指で触る機械か（iPad・スマホなど）。
 * 操作の案内の文を出し分けるのに使う（33.3）。
 *
 * 分からない環境では「指で触る機械」として扱う。このアプリはiPadが主なため。
 */
export function isTouchDevice() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(pointer: coarse)').matches;
  } catch (err) {
    return true;
  }
}

/**
 * iPad・iPhone か（開発ルール37.2）。
 *
 * 【これで印刷のやり方を分ける】
 *   iPad     … 共有メニューに「プリント」がある。だから共有メニューへ渡す。
 *   パソコン … 共有メニューに**「プリント」が無い**（Windowsの共有はメールや
 *              近くの人への送信だけ）。渡しても印刷できないので、
 *              ブラウザの印刷画面を直接開く。
 *
 * iPadOSは「Macintosh」と名乗るので、名前だけでは見分けられない。
 * **指で触れる点の数**（maxTouchPoints）と合わせて見分けるのが定石。
 */
export function isApplePrintShareDevice() {
  try {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '');
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOSはUAが「Macintosh」になる。触れる点が2つ以上あればiPadとみなす
    if (/Macintosh/.test(ua) && Number(navigator.maxTouchPoints) > 1) return true;
    return false;
  } catch (err) {
    return false;
  }
}
