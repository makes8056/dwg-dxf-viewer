// print-preview.js — 印刷される絵を、押す前に確認してもらう画面（開発ルール28章）
//
// 【なぜこの画面が要るのか】
//
// 以前は「この範囲を印刷」を押すと、そのままiPadの印刷画面を開いていました。
// ところが実機で次のことが起きました（2026-09-04 ユーザーが実物の紙で発見）：
//
//   - 印刷画面で紙の向きを変えると、ページが作り直される
//   - そのとき「印刷が終わった」合図が飛び、後片付けが走って**絵が消える**
//   - 一度消えると、次に印刷しても**二度と絵が出ない**
//   - おまけに、紙の余白にアプリのURLと日付が印刷される
//     （iPadではCSSで止められない）
//
// そこで **ページを印刷するのをやめ、「図面の絵そのもの」をiPadに渡す**ことにしました。
// この画面は、その絵を渡す前に**目で確かめてもらう**ためのものです。
// 現場で紙を無駄にしないための、いちばん確実なやり方です。
//
// このファイルは画面を出すだけ。絵を作る処理も、共有する処理も持ちません（開発ルール2.4）。

const STYLE_ID = 'pv-style';

/**
 * 印刷の確認画面を用意する。
 *
 * @param {object} handlers
 *   onPrint(blob, name) … 「プリント」が押された。
 *                         **指で押した流れの中でそのまま呼ばれる**ので、
 *                         受け取る側は待たずに共有メニューを開けます（開発ルール28.3）
 *   onClose()           … 閉じた
 * @returns {{
 *   show: (dataUrl: string, info: object) => void,
 *   getImageElement: () => HTMLImageElement,
 *   hide: () => void,
 *   isOpen: () => boolean
 * }}
 */
export function createPrintPreview(handlers = {}) {
  let open = false;
  let currentBlob = null;
  let currentName = '図面.png';

  const overlay = document.createElement('div');
  overlay.className = 'pv-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="pv-box" role="dialog" aria-modal="true" aria-label="印刷の確認">
      <div class="pv-head">
        <span class="pv-title">この内容で印刷します</span>
        <button type="button" class="pv-close" aria-label="閉じる">×</button>
      </div>
      <div class="pv-body">
        <img class="pv-image" alt="印刷される図面">
      </div>
      <div class="pv-foot">
        <span class="pv-note"></span>
        <div class="pv-buttons">
          <button type="button" class="pv-cancel">やめる</button>
          <button type="button" class="pv-print">プリント</button>
        </div>
      </div>
    </div>`;

  const img = overlay.querySelector('.pv-image');
  const note = overlay.querySelector('.pv-note');
  const printBtn = overlay.querySelector('.pv-print');

  function hide() {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKeyDown);
    handlers.onClose && handlers.onClose();
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape') hide();
  }

  overlay.querySelector('.pv-close').addEventListener('click', hide);
  overlay.querySelector('.pv-cancel').addEventListener('click', hide);
  overlay.addEventListener('click', (ev) => {
    // 後ろの暗いところを押したら閉じる（箱の中を押したときは閉じない）
    if (ev.target === overlay) hide();
  });

  // 【重要】ここは「指で押した流れ」のまま handlers へ渡す。
  // 間に待ち時間（await）を入れると、iPadが共有メニューを開かせないことがある（28.3）。
  printBtn.addEventListener('click', () => {
    handlers.onPrint && handlers.onPrint(currentBlob, currentName);
  });

  ensureAttached(overlay);

  return {
    /**
     * @param {string} dataUrl 印刷する絵
     * @param {object} info { blob, name, widthPx, heightPx, orientation, limited }
     */
    show(dataUrl, info = {}) {
      img.src = dataUrl;
      currentBlob = info.blob || null;
      currentName = info.name || '図面.png';

      // 【設定は標準のままでよい（開発ルール29章）】
      // 絵そのものがA4用紙1枚の形なので、プリント画面で紙の向きや拡大率を
      // いじる必要がない。触らせないほうが事故が減る。
      const 向き = info.orientation === 'portrait' ? '縦向き' : '横向き';
      note.textContent =
        'A4' + 向き + 'いっぱいに印刷します。プリント画面の設定は、そのままでかまいません。';

      overlay.hidden = false;
      open = true;
      document.addEventListener('keydown', onKeyDown);
    },
    hide,
    isOpen: () => open,
    /** 代わりの道（パソコンでの印刷）で使うため、絵そのものを渡す。 */
    getImageElement: () => img,
  };
}

/** 画面に置く。すでに置いてあれば何もしない。 */
function ensureAttached(overlay) {
  if (!document.getElementById(STYLE_ID)) {
    // 見た目は src/ui/print-preview.css で書く。ここでは読み込みの有無だけ気にしない。
  }
  document.body.appendChild(overlay);
}
