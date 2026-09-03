// toolbar.js — 画面のボタン類（開発ルール2.2：1ファイル1役割）
//
// このアプリで用意するボタンは、この4つだけ（むやみに増やさない）。
//   図面を開く／図面を選ぶ／全体表示／印刷する範囲
//
// 【「拡大」「縮小」ボタンは外した（v0.2.4／ユーザー判断）】
//   iPadでは2本指のつまむ操作（ピンチ）で拡大縮小できるので、ボタンは要らない。
//   ボタンが減ったぶん、残ったボタンを大きく・押し間違えにくくできる。
//   拡大縮小そのものは src/ui/gestures.js が受け持つ（無くなっていない）。
//
// このファイルは「ボタンを画面に出して、押されたことを伝える」だけをする。
// 図面を動かしたり読み込んだりする処理は一切ここに書かない（開発ルール2.3・2.4）。

// 絵（アイコン）はすべて自前のSVG。外部の絵文字・アイコン集は使わない（9.2）。
const ICONS = {
  open: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.6l1.8 2H19.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10z"
            fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
    </svg>`,
  fit: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"
            fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`,
  recent: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="3.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
      <rect x="3.5" y="10.3" width="17" height="3.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
      <rect x="3.5" y="16.1" width="17" height="3.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
    </svg>`,
  // 印刷する範囲：プリンターの絵に、囲みを表す点線の四角を重ねる
  print: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 9V4.5h10V9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
      <path d="M5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-1"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      <path d="M6 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      <rect x="7" y="13.5" width="10" height="6.5" rx="1"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="2.6 2" />
    </svg>`,
};

const BUTTONS = [
  { action: 'open', icon: ICONS.open, label: '図面を開く' },
  // 覚えている図面から選ぶ。「図面を開く」の隣に置く（役割が近いので並べる）
  { action: 'recent', icon: ICONS.recent, label: '図面を選ぶ' },
  { action: 'fit', icon: ICONS.fit, label: '全体表示' },
  // このアプリの一番の目的（開発ルール26章）。右端に置いて押し間違えを減らす。
  { action: 'print', icon: ICONS.print, label: '印刷する範囲' },
];

/**
 * ツールバーを作って container の中に出す。
 * @param {HTMLElement} container ボタンを入れる箱（index.html の #toolbar）
 * @param {object} handlers
 *   onOpen()    … 「図面を開く」が押された
 *   onRecent()  … 「図面を選ぶ」（覚えている図面の一覧）が押された
 *   onFit()     … 「全体表示」が押された
 *   onPrint()   … 「印刷する範囲」が押された（範囲を囲むモードに入る）
 * @returns {() => void} 後片付け用。呼ぶとボタンの反応をやめる。
 */
export function attachToolbar(container, handlers = {}) {
  container.innerHTML = BUTTONS.map((b) => `
    <button type="button" class="tb-btn" data-action="${b.action}" aria-label="${b.label}">
      <span class="tb-icon">${b.icon}</span>
      <span class="tb-label">${b.label}</span>
    </button>
  `).join('');

  const onClick = (ev) => {
    const btn = ev.target.closest('.tb-btn');
    if (!btn || !container.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'open') handlers.onOpen && handlers.onOpen();
    else if (action === 'recent') handlers.onRecent && handlers.onRecent();
    else if (action === 'fit') handlers.onFit && handlers.onFit();
    else if (action === 'print') handlers.onPrint && handlers.onPrint();
  };

  container.addEventListener('click', onClick);

  return function detachToolbar() {
    container.removeEventListener('click', onClick);
    container.innerHTML = '';
  };
}
