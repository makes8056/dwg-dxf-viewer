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
import { saveDrawing, loadLatestDrawing } from '../storage.js';
import { startUpdateCheck } from '../update-check.js';

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

const updateBanner = document.getElementById('update-banner');
const updateText = document.getElementById('update-text');
const updateApply = document.getElementById('update-apply');
const updateClose = document.getElementById('update-close');

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
  updateVersionBadgePosition();
}

/**
 * 版番号（右下）が、ボタンの列と重ならないようにする。
 *
 * 版番号は右下、ボタンは下の中央にあります。
 * ふつうは離れていますが、画面が狭いとボタンの列が右まで伸びて**重なります。**
 * 重なると版番号が読めなくなり、更新できたかどうか分からなくなります。
 *
 * ここでも数字を決め打ちせず、**実際に測って**判断します
 * （04で「案内の帯がボタンに13ピクセル重なる」事故が起きたのと同じ理由。開発ルール7.4）。
 */
function updateVersionBadgePosition() {
  const root = document.documentElement;
  // まず持ち上げを0に戻してから測る（前回の持ち上げを二重に足さないため）
  root.style.setProperty('--version-lift', '0px');

  const badge = versionBadge.getBoundingClientRect();
  const bar = toolbarEl.getBoundingClientRect();
  if (badge.width === 0 || bar.width === 0) return;

  const overlaps =
    badge.right > bar.left &&
    badge.left < bar.right &&
    badge.bottom > bar.top &&
    badge.top < bar.bottom;

  if (overlaps) {
    // ボタンの列の上へ、ちょうど8ピクセルすき間があくまで持ち上げる。
    // 「ボタンの高さ＋8」のような当てずっぽうではなく、実際の位置から計算する。
    const lift = Math.ceil(badge.bottom - bar.top + 8);
    root.style.setProperty('--version-lift', `${lift}px`);
  }
}

/**
 * 画面の大きさや、ボタンの大きさが変わったら、置き場所を計算し直す。
 *
 * 画面の回転（resize）だけを見ていると取りこぼします。
 * iPadでは、URLバーが出入りしたり、文字の大きさ設定が変わったりして、
 * **resize が起きないのに配置だけ変わる**ことがあります。
 * そこで、ボタンの列と画面そのものの大きさを直接見張ります。
 */
function watchLayoutChanges() {
  if (typeof ResizeObserver !== 'function') return; // 古いブラウザでは何もしない
  const observer = new ResizeObserver(() => {
    // 測る前に、ブラウザが位置を決め終わるのを1コマ待つ
    requestAnimationFrame(updateToolbarHeightVar);
  });
  observer.observe(toolbarEl);
  observer.observe(document.body);

  // ホーム画面から起動したアプリを、他のアプリから戻ってきたときにも計算し直す。
  // iPadでは、裏に回っている間に画面の向きが変わっていることがある。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestAnimationFrame(updateToolbarHeightVar);
  });
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
    // 【ユーザーからの指摘】「3個あります」とだけ出していたら、
    // CADで探しても見つけられなかった。**何がどこにあるかまで書く。**
    const kindName = { text: '文字', line: '線', polyline: '折れ線', arc: '円弧', circle: '円', ellipse: '楕円' };
    const details = (drawing.outlierList || []).slice(0, 3).map((o) => {
      const what = kindName[o.type] || o.type;
      const label = o.text ? `「${o.text}」` : '';
      const where = `レイヤー「${o.layer}」・座標 ${o.x}, ${o.y}`;
      return `${what}${label}（${where}）`;
    });

    messages.push(
      `図面から遠く離れた場所に ${outliers}個の図形があります` +
        (details.length ? `：${details.join('、')}` : '') +
        (outliers > details.length ? ' ほか' : '') +
        '。全体表示では、これらを外して図面本体に合わせています'
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
  onLoadSuccess: (drawing, name, buffer) => {
    loadingOverlay.hidden = true;
    currentDrawing = drawing;

    // この図面を覚えておく（開発ルール20章）。
    // アプリを更新するたびにファイルアプリから開き直させないため。
    // 覚えるのは「元のファイルのバイト列」。解析済みではない（20.2）。
    // 失敗しても表示には影響しないので、待たずに進める（20.5）。
    if (name && buffer) {
      saveDrawing(name, buffer).then((ok) => {
        if (!ok) console.warn('[DXFビューア] この図面を覚えておけませんでした。');
      });
    }

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
// ------------------------------------------------------------
// 新しい版が届いたときの案内（開発ルール5.2・21章）
//
// 黙って切り替えない。押されたときだけ切り替える。
// 現場で図面を見ている最中に、勝手に画面が変わらないようにするため。
// ------------------------------------------------------------

// このページを開いた時点で、すでにオフライン用の仕組みが担当についていたか。
//
// 【ワーカーからの申し送り】
// はじめてこのアプリを開いたときは、オフラインの準備が終わった合図が
// 「更新があります」と同じ形で1回飛んでくる。
// そのまま出すと、**初めて開いた人にいきなり「更新があります」と出てしまう。**
// 最初から担当がついていたかどうかで見分けて、初回は出さない。
const hadControllerAtStart =
  typeof navigator !== 'undefined' &&
  navigator.serviceWorker &&
  Boolean(navigator.serviceWorker.controller);

function setupUpdateBanner() {
  updateClose.addEventListener('click', () => {
    updateBanner.hidden = true;
  });

  startUpdateCheck({
    onUpdateReady: (applyUpdate) => {
      if (!hadControllerAtStart) {
        // 初回の準備完了。更新ではないので案内は出さない。
        return;
      }
      updateText.textContent = '新しい版があります。押すと切り替わります（今見ている図面はそのまま残ります）。';
      updateApply.onclick = () => {
        updateApply.disabled = true;
        updateApply.textContent = '切り替え中…';
        applyUpdate();
      };
      updateBanner.hidden = false;
    },
    onOffline: (ready) => {
      // オフラインで使える状態になったかどうか。今は記録だけ残す。
      console.info('[DXFビューア] オフラインで使える状態:', ready ? 'はい' : 'まだ');
    },
  });
}

async function main() {
  await loadPartnerModules();
  resizeCanvas();
  watchLayoutChanges();
  maybeShowBrowserHint();
  await restoreLastDrawing();
  setupUpdateBanner();
}

/**
 * 前回開いていた図面を、そのまま開き直す（開発ルール20.4）。
 *
 * アプリを更新するたびにファイルアプリから選び直すのは、現場では使えない。
 * 覚えているのは元のファイルのバイト列なので、読み取りの作りを直したときは
 * **新しい読み方で読み直される**（20.2）。
 *
 * 覚えていない・取り出せない場合は、何もしないで普通に起動する。
 */
async function restoreLastDrawing() {
  if (!viewportMod || !renderMod) return; // 描く準備ができていなければ何もしない
  let saved = null;
  try {
    saved = await loadLatestDrawing();
  } catch (err) {
    // storage.js は例外を投げない作りだが、念のため受け止める
    console.warn('[DXFビューア] 覚えている図面を取り出せませんでした。', err);
    return;
  }
  if (!saved || !saved.buffer || saved.buffer.byteLength === 0) return;
  fileOpener.openBuffer(saved.name, saved.buffer);
}

main();
