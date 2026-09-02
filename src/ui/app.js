// app.js — 入口。全体のとりまとめ（開発ルール9.4・2.1）
//
// 画面から読み込まれるのはこのファイルだけ（index.html の <script type="module"> は1行）。
// 他のファイルは、すべてこのファイルが import してつなぐ。
//
// 【重要】src/viewport.js と src/render.js は、他の人が今つくっている最中で、
// まだ無いか、途中の状態のことがある。
// そのため両方とも dynamic import(動的読み込み) で読み、失敗しても
// 画面が白いまま止まらないように「準備中」の案内を出して待つだけにしてある。

import { APP_VERSION } from '../version.js';
import { attachToolbar } from './toolbar.js';
import { setupFileOpen } from './file-open.js';
import { attachGestures } from './gestures.js';

// ------------------------------------------------------------
// 画面の部品を取得
// ------------------------------------------------------------
const canvas = document.getElementById('draw-canvas');
const ctx = canvas.getContext('2d');

const versionBadge = document.getElementById('version-badge');
const toolbarEl = document.getElementById('toolbar');

const loadingOverlay = document.getElementById('loading-overlay');

const prepareBanner = document.getElementById('prepare-banner');

const errorBanner = document.getElementById('error-banner');
const errorText = document.getElementById('error-text');
const errorClose = document.getElementById('error-close');

const unsupportedBanner = document.getElementById('unsupported-banner');
const unsupportedText = document.getElementById('unsupported-text');
const unsupportedClose = document.getElementById('unsupported-close');

const browserHint = document.getElementById('browser-hint');
const browserHintClose = document.getElementById('browser-hint-close');

versionBadge.textContent = APP_VERSION;

// ------------------------------------------------------------
// 他の人がつくっている部品（viewport.js / render.js）を、
// 失敗しても落ちないように読み込む
// ------------------------------------------------------------
let viewportMod = null; // { createViewport, setSize, fitToBounds, toScreen, toDrawing, panBy, zoomAt, visibleBounds }
let renderMod = null;   // { renderDrawing }

async function loadPartnerModules() {
  try {
    viewportMod = await import('../viewport.js');
  } catch (err) {
    console.warn('[DXFビューア] viewport.js がまだ準備できていません。', err);
    viewportMod = null;
  }
  try {
    renderMod = await import('../render.js');
  } catch (err) {
    console.warn('[DXFビューア] render.js がまだ準備できていません。', err);
    renderMod = null;
  }

  if (!viewportMod || !renderMod) {
    prepareBanner.hidden = false;
  } else {
    prepareBanner.hidden = true;
  }
}

// ------------------------------------------------------------
// 状態
// ------------------------------------------------------------
let viewport = null;         // viewport.js が管理する「今どこを見ているか」の状態
let currentDrawing = null;   // 読み込み済みの図面データ（src/drawing.js の形）
let redrawScheduled = false; // requestAnimationFrame の多重予約を防ぐ

function ensureViewport() {
  if (!viewportMod) return null;
  if (!viewport) {
    const rect = canvas.getBoundingClientRect();
    viewport = viewportMod.createViewport(
      Math.max(1, rect.width),
      Math.max(1, rect.height)
    );
  }
  return viewport;
}

// ------------------------------------------------------------
// キャンバスの大きさを画面に合わせる（devicePixelRatio対応。iPadでぼやけないように）
// ------------------------------------------------------------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);

  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  // 描く側（render.js）は CSS ピクセル基準で座標を計算する想定にし、
  // 実際の解像度との差はここ1か所（Canvasの変換）だけで吸収する。
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const vp = ensureViewport();
  if (vp && viewportMod) {
    viewportMod.setSize(vp, cssWidth, cssHeight);
  }
  updateToolbarHeightVar();
  scheduleRedraw();
}

/**
 * ボタンの列の「本当の高さ」を測って、CSSへ渡す。
 *
 * 【04と同じ事故を防ぐため】
 * 案内の帯は、この高さを使ってボタンの上に置かれる（ui.css の .hint）。
 * ここで測らずCSSに数字を決め打ちすると、画面の大きさや文字の大きさが変わったときに
 * **案内がボタンに重なって押せなくなる**。実際に重なった。
 */
function updateToolbarHeightVar() {
  const h = Math.round(toolbarEl.getBoundingClientRect().height);
  if (h > 0) {
    document.documentElement.style.setProperty('--toolbar-height', `${h}px`);
  }
}

// ------------------------------------------------------------
// 描き直し。指を動かすたびに描くと重くなるので requestAnimationFrame でまとめる。
// ------------------------------------------------------------
function scheduleRedraw() {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => {
    redrawScheduled = false;
    redraw();
  });
}

function redraw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, Math.max(1, rect.width), Math.max(1, rect.height));

  if (!viewportMod || !renderMod || !viewport || !currentDrawing) return;

  try {
    // 【iPadの不具合対策】画面の細かさ（iPadは2倍）を必ず渡す。
    // 渡さないと render.js が1倍で描き、図面が画面の左上4分の1に縮こまる。
    // render.js 側でも自分で計算し直すようにしてあるが、二重に守っておく。
    renderMod.renderDrawing(ctx, currentDrawing, viewport, {
      dpr: window.devicePixelRatio || 1,
    });
  } catch (err) {
    console.error('[DXFビューア] 描画に失敗しました。', err);
    showError(
      `図面の表示中に問題が起きました。\n詳細：${err && err.message ? err.message : err}`
    );
  }
}

// ------------------------------------------------------------
// エラー・警告バナー
// ------------------------------------------------------------
function showError(message) {
  errorText.textContent = message;
  errorBanner.hidden = false;
}
function hideError() {
  errorBanner.hidden = true;
}
errorClose.addEventListener('click', hideError);

function showUnsupported(drawing) {
  const messages = [];

  const info = drawing && drawing.unsupported;
  const count = info ? info.count : 0;
  if (count) {
    const kinds = info.kinds || {};
    const parts = Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind} ${n}個`);
    messages.push(
      `この図面のうち ${count}個の図形は表示できませんでした` +
        (parts.length ? `（種類：${parts.join('、')}）` : '')
    );
  }

  // 図面本体から遠く離れた図形（消し忘れの線など）があることも隠さず伝える。
  // 全体表示はこれらを外して図面本体に合わせているため、
  // 何も言わないと「図面の一部が無い」と誤解される。
  const outliers = drawing && drawing.outliers;
  if (outliers) {
    messages.push(
      `図面から遠く離れた場所に ${outliers}個の図形があります。` +
        `全体表示では、図面本体だけに合わせています（指で縮小すると見つかります）`
    );
  }

  if (messages.length === 0) {
    unsupportedBanner.hidden = true;
    return;
  }
  unsupportedText.textContent = messages.join('　／　');
  unsupportedBanner.hidden = false;
}
unsupportedClose.addEventListener('click', () => {
  unsupportedBanner.hidden = true;
});

// ------------------------------------------------------------
// Safari以外で開かれたときの案内（開発ルール11.3）
// 押しつけがましくしない：小さめの案内、1回閉じたら覚えておく。
// ------------------------------------------------------------
const SAFARI_HINT_STORAGE_KEY = 'dxfViewer.safariHint.closed';

function isLikelySafari() {
  const ua = navigator.userAgent || '';
  // Chrome/Firefox/Edge/Opera/Google アプリ内ブラウザ（iOS版）は
  // 中身はSafariでも、それぞれ固有の文字列がUAに入っている。
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua)) return false;
  return /Safari/.test(ua) && /Version\//.test(ua);
}

function hasClosedSafariHintBefore() {
  try {
    return localStorage.getItem(SAFARI_HINT_STORAGE_KEY) === '1';
  } catch (err) {
    // プライベートブラウズ等でlocalStorageが使えなくても、致命的ではない。
    return false;
  }
}

function maybeShowBrowserHint() {
  if (isLikelySafari()) return;
  if (hasClosedSafariHintBefore()) return;
  browserHint.hidden = false;
}

browserHintClose.addEventListener('click', () => {
  browserHint.hidden = true;
  try {
    localStorage.setItem(SAFARI_HINT_STORAGE_KEY, '1');
  } catch (err) {
    // 保存できなくても、今回閉じることには影響しない
  }
});

// ------------------------------------------------------------
// ファイルを開く
// ------------------------------------------------------------
const fileOpener = setupFileOpen({
  onLoadStart: () => {
    hideError();
    loadingOverlay.hidden = false;
  },
  onLoadSuccess: (drawing) => {
    loadingOverlay.hidden = true;
    currentDrawing = drawing;

    const vp = ensureViewport();
    // 【重要】全体表示には contentBounds（図面本体の範囲）を使う。
    // bounds（本当の全体）を使うと、図面から遠く離れたはぐれ図形に引っぱられて
    // 図面本体が数ピクセルの点になり、画面が真っ白にしか見えない。実際にそうなった。
    const fitTo = drawing.contentBounds || drawing.bounds;
    if (vp && viewportMod && fitTo) {
      viewportMod.fitToBounds(vp, fitTo);
    }

    showUnsupported(drawing);
    scheduleRedraw();
  },
  onLoadError: (message) => {
    loadingOverlay.hidden = true;
    showError(message);
  },
});

// ------------------------------------------------------------
// ツールバー（図面を開く／全体表示／拡大／縮小）
// ------------------------------------------------------------
const ZOOM_STEP = 1.25;

attachToolbar(toolbarEl, {
  onOpen: () => {
    if (!viewportMod || !renderMod) {
      showError('図面を表示する部品がまだ準備できていません。しばらくしてからもう一度お試しください。');
      return;
    }
    fileOpener.open();
  },
  onFit: () => {
    const vp = ensureViewport();
    const fitTo = currentDrawing && (currentDrawing.contentBounds || currentDrawing.bounds);
    if (!vp || !fitTo) return;
    viewportMod.fitToBounds(vp, fitTo);
    scheduleRedraw();
  },
  onZoomIn: () => {
    const vp = ensureViewport();
    if (!vp) return;
    const rect = canvas.getBoundingClientRect();
    viewportMod.zoomAt(vp, rect.width / 2, rect.height / 2, ZOOM_STEP);
    scheduleRedraw();
  },
  onZoomOut: () => {
    const vp = ensureViewport();
    if (!vp) return;
    const rect = canvas.getBoundingClientRect();
    viewportMod.zoomAt(vp, rect.width / 2, rect.height / 2, 1 / ZOOM_STEP);
    scheduleRedraw();
  },
});

// ------------------------------------------------------------
// 指・マウスの操作（移動・拡大縮小）
// ------------------------------------------------------------
attachGestures(canvas, {
  onPan: (dxScreen, dyScreen) => {
    const vp = ensureViewport();
    if (!vp) return;
    viewportMod.panBy(vp, dxScreen, dyScreen);
    scheduleRedraw();
  },
  onZoom: (centerX, centerY, factor) => {
    const vp = ensureViewport();
    if (!vp) return;
    viewportMod.zoomAt(vp, centerX, centerY, factor);
    scheduleRedraw();
  },
  onTap: (_x, _y) => {
    // v1（今回）では寸法測定は作らない。あとの段階で使うための受け口だけ用意している。
  },
});

// ------------------------------------------------------------
// 画面の回転・大きさの変化
// ------------------------------------------------------------
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  // 回転直後は getBoundingClientRect() がまだ古い値のことがあるため、
  // 描画の1コマ分だけ待ってから測り直す。
  requestAnimationFrame(resizeCanvas);
});

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------
async function main() {
  await loadPartnerModules();
  resizeCanvas();
  maybeShowBrowserHint();
}

main();
