// toolbar.js — 画面のボタン類（開発ルール2.2：1ファイル1役割）
//
// このアプリで用意するボタンは、この7つだけ（むやみに増やさない）。
//   図面を開く／図面を選ぶ／全体表示／長さを測る／文字を書く／白黒で表示／印刷する範囲
//
// 【「白黒で表示」を足した理由（v0.4.9／2026-09-10 ユーザーの指示）】
//   お客様の図面では、配管が画層（レイヤ）ごと赤で描かれている。
//   図面がそう指定しているのでアプリの間違いではないが、
//   **白黒プリンターで刷ると赤は薄い灰色になって読みにくい。**
//   そこで、押している間だけ図面を黒一色で出す切り替えを足した。
//   押した状態は覚えておく（次に開いたときも同じ）。
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
  // 長さを測る：ものさしの絵（両端に矢印のついた線と、目盛り）
  measure: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="3.5" y1="17" x2="20.5" y2="17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M3.5 17l3-2.6M3.5 17l3 2.6M20.5 17l-3-2.6M20.5 17l-3 2.6"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M6.5 11.5V7M12 11.5V4.5M17.5 11.5V7"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>`,
  // 文字を書く：鉛筆の絵
  note: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l1-4.2L15.6 5.2a1.8 1.8 0 0 1 2.5 0l0.7 0.7a1.8 1.8 0 0 1 0 2.5L8.2 19 4 20z"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
      <line x1="14.2" y1="6.6" x2="17.4" y2="9.8" stroke="currentColor" stroke-width="1.7" />
    </svg>`,
  // 白黒で表示：左半分だけ塗った丸（濃さの切り替えを表す、よくある絵）
  mono: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path d="M12 3.8a8.2 8.2 0 0 0 0 16.4z" fill="currentColor" />
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
  { action: 'measure', icon: ICONS.measure, label: '長さを測る' },
  { action: 'note', icon: ICONS.note, label: '文字を書く' },
  // 押すたびに入り切りが変わるボタン。今どちらなのかを aria-pressed で示す。
  { action: 'mono', icon: ICONS.mono, label: '白黒で表示', toggle: true },
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
 *   onMeasure() … 「長さを測る」が押された
 *   onNote()    … 「文字を書く」が押された
 *   onMonochrome(白黒か) … 「白黒で表示」が押された。**押したあとの状態**を渡す
 *   onPrint()   … 「印刷する範囲」が押された（範囲を囲むモードに入る）
 * @param {object} [options] { monochrome } … 「白黒で表示」の最初の状態
 * @returns {() => void} 後片付け用。呼ぶとボタンの反応をやめる。
 */
export function attachToolbar(container, handlers = {}, options = {}) {
  container.innerHTML = BUTTONS.map((b) => `
    <button type="button" class="tb-btn" data-action="${b.action}" aria-label="${b.label}"${
      b.toggle ? ' aria-pressed="false"' : ''
    }>
      <span class="tb-icon">${b.icon}</span>
      <span class="tb-label">${b.label}</span>
    </button>
  `).join('');

  // 前に使ったときの状態を、そのままボタンに映す（覚えているのは呼び出す側）
  const monoBtn = container.querySelector('[data-action="mono"]');
  if (monoBtn) monoBtn.setAttribute('aria-pressed', options.monochrome ? 'true' : 'false');

  const onClick = (ev) => {
    const btn = ev.target.closest('.tb-btn');
    if (!btn || !container.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'open') handlers.onOpen && handlers.onOpen();
    else if (action === 'recent') handlers.onRecent && handlers.onRecent();
    else if (action === 'fit') handlers.onFit && handlers.onFit();
    else if (action === 'measure') handlers.onMeasure && handlers.onMeasure();
    else if (action === 'note') handlers.onNote && handlers.onNote();
    else if (action === 'mono') {
      // 押すたびに入り切りが変わる。見た目をここで先に変え、**変えたあとの値**を渡す。
      const 今まで = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', 今まで ? 'false' : 'true');
      handlers.onMonochrome && handlers.onMonochrome(!今まで);
    } else if (action === 'print') handlers.onPrint && handlers.onPrint();
  };

  container.addEventListener('click', onClick);

  return function detachToolbar() {
    container.removeEventListener('click', onClick);
    container.innerHTML = '';
  };
}
