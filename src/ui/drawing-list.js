// drawing-list.js — 「覚えている図面から選ぶ」画面（開発ルール2.2：1ファイル1役割・24章）
//
// このファイルは「画面（一覧）だけ」を作る部品。データは自分で取りに行かない（開発ルール2.4）。
// 呼び出す側（app.js）が一覧のデータ（storage.js の listDrawings() の形）を渡し、
// 「選ばれた」「消された」「閉じた」を呼び出す側へ知らせるだけにする。
//
// index.html は触れないので、この部品が自分で document.body に要素を作って足す
// （src/ui/toolbar.js が container に描くのと同じ考え方。ここは自分で箱ごと作る点だけが違う）。

/**
 * バイト数を「5.1MB」のように人が読みやすい形にする。
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes}バイト`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}

/**
 * 時刻を「今日 14:30」「昨日 9:05」「9月1日」のように、日本語で分かりやすく表す。
 * @param {number} savedAt Date.now() の値
 * @param {Date} [now] テスト用に「今」を差し替えられるようにする
 * @returns {string}
 */
function formatWhen(savedAt, now = new Date()) {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return '';
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return '';

  const pad2 = (n) => String(n).padStart(2, '0');
  const hm = `${d.getHours()}:${pad2(d.getMinutes())}`;

  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

  if (dayDiff === 0) return `今日 ${hm}`;
  if (dayDiff === 1) return `昨日 ${hm}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff}日前 ${hm}`;

  // 年をまたぐ場合だけ年も出す（そうしないと去年の同じ日と区別が付かない）
  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${datePart} ${hm}`;
}

/** HTMLとして安全な文字に変換する（ファイル名に < & などが含まれても壊れないように）。 */
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const CLOSE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>`;

const DELETE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 6h14M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M7 6l1 14.5A1.5 1.5 0 0 0 9.5 22h5a1.5 1.5 0 0 0 1.5-1.5L17 6"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;

/**
 * 「覚えている図面から選ぶ」画面を用意する。
 * @param {object} handlers
 *   onOpen(name)    … その図面を開いてほしい、と知らせる
 *   onDelete(name)  … その図面を忘れてほしい、と知らせる（Promiseを返してよい）
 *   onClose()       … 一覧を閉じた（省略可）
 * @returns {{
 *   show: (items, currentName) => void,
 *   hide: () => void,
 *   isOpen: () => boolean
 * }}
 */
export function createDrawingList(handlers = {}) {
  let open = false;
  let items = [];
  let currentName = null;
  // 消す処理の途中で、同じ行をもう一度押されても二重に走らせないようにする印。
  const deleting = new Set();

  // ------------------------------------------------------------
  // 画面の骨組みを作って body に足す（一度だけ）
  // ------------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'dl-overlay';
  overlay.setAttribute('hidden', '');

  overlay.innerHTML = `
    <div class="dl-box" role="dialog" aria-modal="true" aria-label="覚えている図面から選ぶ">
      <div class="dl-header">
        <h2 class="dl-title">図面を選ぶ</h2>
        <button type="button" class="dl-close" aria-label="閉じる">
          <span class="dl-close-icon">${CLOSE_ICON}</span>
        </button>
      </div>
      <div class="dl-body">
        <ul class="dl-items"></ul>
        <p class="dl-empty" hidden>覚えている図面はありません</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const boxEl = overlay.querySelector('.dl-box');
  const listEl = overlay.querySelector('.dl-items');
  const emptyEl = overlay.querySelector('.dl-empty');
  const closeBtn = overlay.querySelector('.dl-close');

  /** 一覧を画面に描き直す。 */
  function render() {
    if (items.length === 0) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    listEl.innerHTML = items.map((item) => {
      const isCurrent = currentName != null && item.name === currentName;
      const name = escapeHtml(item.name);
      return `
        <li class="dl-item${isCurrent ? ' dl-item-current' : ''}" data-name="${name}">
          <button type="button" class="dl-open" data-name="${name}">
            <span class="dl-name">${name}</span>
            <span class="dl-meta">
              ${isCurrent ? '<span class="dl-current-badge">表示中</span>' : ''}
              <span class="dl-when">${escapeHtml(formatWhen(item.savedAt))}</span>
              <span class="dl-size">${escapeHtml(formatSize(item.size))}</span>
            </span>
          </button>
          <button type="button" class="dl-delete" data-name="${name}" aria-label="「${name}」を忘れる">
            <span class="dl-delete-icon">${DELETE_ICON}</span>
          </button>
        </li>
      `;
    }).join('');
  }

  /** 消すボタンが押されたときの処理。確認 → onDelete → 一覧からすぐ消す。 */
  async function handleDelete(name) {
    if (deleting.has(name)) return; // 二重押し対策
    const ok = window.confirm(`「${name}」を忘れますか？`);
    if (!ok) return;

    deleting.add(name);
    try {
      await handlers.onDelete?.(name);
    } finally {
      deleting.delete(name);
    }
    // 呼び出し側の処理結果を待たず、一覧からはすぐに消す（開発ルール24.3・見た目の即応性）。
    items = items.filter((it) => it.name !== name);
    render();
  }

  function onListClick(ev) {
    const delBtn = ev.target.closest('.dl-delete');
    if (delBtn) {
      handleDelete(delBtn.dataset.name);
      return;
    }
    const openBtn = ev.target.closest('.dl-open');
    if (openBtn) {
      const name = openBtn.dataset.name;
      hide();
      handlers.onOpen?.(name);
    }
  }

  function onOverlayClick(ev) {
    // 後ろの暗い幕をタップしたら閉じる（箱の中をタップしたときは閉じない）
    if (ev.target === overlay) hide();
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape') hide();
  }

  listEl.addEventListener('click', onListClick);
  overlay.addEventListener('click', onOverlayClick);
  closeBtn.addEventListener('click', hide);
  document.addEventListener('keydown', onKeyDown);

  function show(newItems, newCurrentName) {
    items = Array.isArray(newItems) ? newItems.slice() : [];
    currentName = newCurrentName ?? null;
    render();
    overlay.removeAttribute('hidden');
    open = true;
  }

  function hide() {
    if (!open) return;
    overlay.setAttribute('hidden', '');
    open = false;
    handlers.onClose?.();
  }

  function isOpen() {
    return open;
  }

  return { show, hide, isOpen };
}
