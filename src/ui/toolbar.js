// toolbar.js — 画面のボタン類（開発ルール2.2：1ファイル1役割）
//
// このアプリで用意するボタンは、この5つだけ（むやみに増やさない）。
//   図面を開く／図面を選ぶ／全体表示／拡大／縮小
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
  zoomIn: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" />
      <line x1="15.3" y1="15.3" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <line x1="7.6" y1="10.5" x2="13.4" y2="10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <line x1="10.5" y1="7.6" x2="10.5" y2="13.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>`,
  zoomOut: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" />
      <line x1="15.3" y1="15.3" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <line x1="7.6" y1="10.5" x2="13.4" y2="10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>`,
  recent: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="3.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
      <rect x="3.5" y="10.3" width="17" height="3.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
      <rect x="3.5" y="16.1" width="17" height="3.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
    </svg>`,
};

const BUTTONS = [
  { action: 'open', icon: ICONS.open, label: '図面を開く' },
  // 覚えている図面から選ぶ。「図面を開く」の隣に置く（役割が近いので並べる）
  { action: 'recent', icon: ICONS.recent, label: '図面を選ぶ' },
  { action: 'fit', icon: ICONS.fit, label: '全体表示' },
  { action: 'zoom-in', icon: ICONS.zoomIn, label: '拡大' },
  { action: 'zoom-out', icon: ICONS.zoomOut, label: '縮小' },
];

/**
 * ツールバーを作って container の中に出す。
 * @param {HTMLElement} container ボタンを入れる箱（index.html の #toolbar）
 * @param {object} handlers
 *   onOpen()    … 「図面を開く」が押された
 *   onRecent()  … 「図面を選ぶ」（覚えている図面の一覧）が押された
 *   onFit()     … 「全体表示」が押された
 *   onZoomIn()  … 「拡大」が押された
 *   onZoomOut() … 「縮小」が押された
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
    else if (action === 'zoom-in') handlers.onZoomIn && handlers.onZoomIn();
    else if (action === 'zoom-out') handlers.onZoomOut && handlers.onZoomOut();
  };

  container.addEventListener('click', onClick);

  return function detachToolbar() {
    container.removeEventListener('click', onClick);
    container.innerHTML = '';
  };
}
