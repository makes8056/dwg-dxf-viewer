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
import {
  saveDrawing,
  loadLatestDrawing,
  loadDrawing,
  listDrawings,
  forgetDrawing,
} from '../storage.js';
import { createDrawingList } from './drawing-list.js';
import { createPrintUi } from './print-ui.js';
import { createPrintPreview } from './print-preview.js';
import { createPrintImage, isAreaBigEnough } from '../print-area.js';
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

const printArea = document.getElementById('print-area');
const printImage = document.getElementById('print-image');

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
let currentName = null;      // 今開いている図面のファイル名（一覧で「表示中」を出すのに使う）
let redrawScheduled = false; // requestAnimationFrame の多重予約を防ぐ
// 最後に「全体表示」を計算したときの、画面の大きさ。
// 画面の大きさがまだ決まっていないうちに計算すると、図面が点のように小さくなる。
let fittedWidth = 0;

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
  refitIfFittedAtBadSize(cssWidth, cssHeight);
  updateToolbarHeightVar();
  scheduleRedraw();
}

/**
 * 画面の大きさが決まる前に全体表示を計算してしまっていたら、計算し直す。
 *
 * 【なぜ要るか】
 * アプリを開いた直後や、裏から戻ってきた直後は、
 * 画面の大きさがまだ 0 に近いことがあります。
 * その状態で全体表示を計算すると、**図面が点のように小さく表示され、
 * そのまま直りません。** 実際にこの状態を確認しました。
 *
 * まともな大きさになった最初の1回だけ、計算し直します。
 * ユーザーが自分で動かした位置を勝手に戻さないよう、**1回だけ**にしています。
 */
function refitIfFittedAtBadSize(cssWidth, cssHeight) {
  const まともな大きさ = 50; // これ未満は「まだ決まっていない」とみなす
  if (!currentDrawing || !viewport || !viewportMod) return;
  if (fittedWidth >= まともな大きさ) return; // すでにまともな大きさで計算済み
  if (cssWidth < まともな大きさ || cssHeight < まともな大きさ) return; // まだ決まっていない

  const fitTo = currentDrawing.contentBounds || currentDrawing.bounds;
  if (!fitTo) return;
  viewportMod.fitToBounds(viewport, fitTo);
  fittedWidth = cssWidth;
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

  // 【ここに「図面から遠く離れた場所に◯個の図形があります」を出していた。やめた】
  //
  // 中身は正しかったが、ユーザーにとっては**使い道が無く、混乱させただけ**だった
  // （2026-09-03 ユーザーからの指摘。開発ルール25章）。
  //
  //   - 図面は欠けていない。表示のしかたの話でしかない
  //   - CADの画面と見比べても、そこには何も見えない（消し忘れの文字など）
  //   - 読んでも、現場の人にできることが何も無い
  //
  // 図面本体に合わせて表示する**動作はそのまま**。案内だけをやめた。
  // はぐれ図形の中身は drawing.outlierList に残してあるので、不具合調べには使える。
  //
  // 案内に出すのは「現場の判断に影響すること」だけ（開発ルール25.3）。

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
    currentName = name || null;

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
      // どの大きさで計算したかを覚えておく（小さすぎたら、あとで計算し直すため）
      fittedWidth = vp.width;
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

// ------------------------------------------------------------
// 覚えている図面から選ぶ画面（開発ルール24章）
//
// ファイルアプリを経由せずに、アプリの中で図面を切り替えられるようにする。
// 現場で何枚かの図面を行き来するため。
// ------------------------------------------------------------
const drawingList = createDrawingList({
  onOpen: (name) => {
    // 一覧で選ばれた図面を開き直す。
    // 覚えているのは元のファイルのバイト列なので、いつもと同じ経路で読み込む（20.2）。
    openRememberedDrawing(name);
  },
  onDelete: (name) => forgetDrawing(name),
});

/**
 * 覚えている図面を、名前を指定して開く。
 * @param {string} name
 */
async function openRememberedDrawing(name) {
  let saved = null;
  try {
    saved = await loadDrawing(name);
  } catch (err) {
    console.warn('[DXFビューア] 覚えている図面を取り出せませんでした。', err);
  }
  if (!saved || !saved.buffer || saved.buffer.byteLength === 0) {
    showError(`「${name}」を取り出せませんでした。もう一度ファイルから開いてください。`);
    return;
  }
  fileOpener.openBuffer(saved.name, saved.buffer);
}


/** 「図面を選ぶ」が押されたとき。覚えている図面の一覧を出す。 */
async function showDrawingList() {
  let items = [];
  try {
    items = await listDrawings();
  } catch (err) {
    console.warn('[DXFビューア] 覚えている図面の一覧を取り出せませんでした。', err);
  }

  if (!items || items.length === 0) {
    // 覚えていないときは、空の一覧を出さずに何をすればよいか伝える（開発ルール24.5）
    showError('まだ図面を覚えていません。「図面を開く」からファイルを選んでください。');
    return;
  }
  drawingList.show(items, currentName);
}

// ------------------------------------------------------------
// 範囲指定プリント（開発ルール26章。このアプリの一番の目的）
//
// 流れ：
//   1. 「印刷する範囲」を押す → 範囲を囲むモードに入る
//   2. 指でなぞって囲む
//   3. 「この範囲を印刷」→ 画面座標を図面座標に直す
//   4. 図面データから**描き直して**印刷用の絵を作る（画面の絵を引き伸ばさない）
//   5. iPadの標準の印刷画面を開く
// ------------------------------------------------------------
const printUi = createPrintUi(canvas, {
  onPrint: (rectScreen) => { printSelectedArea(rectScreen); },
  onCancel: () => { /* モードから抜けただけ。何もしない */ },
});

// 印刷される絵を、押す前に確認してもらう画面（開発ルール28.2）
const printPreview = createPrintPreview({
  onPrint: (blob, name) => { handOverToPrint(blob, name); },
});

/**
 * 作った絵を、iPadに渡す（開発ルール28.2）。
 *
 * 【ここが指で押した流れの中であることが大事】
 * iPadは、間に待ち時間が入ると共有メニューを開かせないことがある。
 * そのため絵は先に作っておき、ここでは**渡すだけ**にしている（28.3）。
 *
 * @param {Blob|null} blob 図面の絵
 * @param {string} name ファイル名
 */
function handOverToPrint(blob, name) {
  // 1. iPadなど：共有メニューへ渡す。そこから「プリント」を選んでもらう。
  //    ページを印刷しないので、**URL・日付・ページ番号は一切出ない。**
  if (blob && typeof navigator.share === 'function') {
    const file = new File([blob], name, { type: 'image/png' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).then(
        () => { printPreview.hide(); },
        (err) => {
          // ユーザーが自分でやめたときは、何も出さない（失敗ではない）
          if (err && err.name === 'AbortError') return;
          showError(
            'プリントの画面を開けませんでした。\n' +
              '確認の画面の絵を長押しして「画像を保存」してから、写真アプリで印刷してください。'
          );
        }
      );
      return;
    }
  }

  // 2. パソコンなど、共有メニューが無い環境：これまでどおりページを印刷する。
  //    こちらはURLや日付が入ることがあるが、パソコンでは印刷設定で消せる。
  printFallbackViaPage();
}

/**
 * 共有メニューが使えない環境のための、代わりの道（開発ルール28.4）。
 * パソコン用。iPadでは通らない。
 */
function printFallbackViaPage() {
  const img = printPreview.getImageElement();
  if (!img || !img.getAttribute('src')) {
    showError('印刷用の絵がありません。もう一度範囲を囲んでください。');
    return;
  }
  // 【開発ルール28.3】絵は消さない。印刷中に片付けようとしないこと。
  // 以前ここで片付けたために、紙の向きを変えると絵が消える不具合が起きた。
  printImage.src = img.getAttribute('src');
  printArea.hidden = false;
  window.print();
}

/**
 * 囲まれた範囲を印刷する。
 * @param {object} rectScreen キャンバスの左上を基準にした四角 { x, y, width, height }
 */
async function printSelectedArea(rectScreen) {
  // 【開発ルール26.7】指が滑っただけの小さな範囲では印刷させない。
  // 判定は print-area.js に置いてある（画面を作る側と、絵を作る側で二重に持たない）。
  const check = isAreaBigEnough(rectScreen);
  if (!check.ok) {
    showError(check.reason);
    printUi.start(); // もう一度囲んでもらう
    return;
  }

  const vp = ensureViewport();
  if (!vp || !viewportMod || !currentDrawing) {
    showError('図面が開かれていません。先に図面を開いてください。');
    return;
  }

  // 画面の座標 → 図面の座標。変換は viewport.js に任せる（開発ルール10.6）。
  const [x1, y1] = viewportMod.toDrawing(vp, rectScreen.x, rectScreen.y);
  const [x2, y2] = viewportMod.toDrawing(
    vp,
    rectScreen.x + rectScreen.width,
    rectScreen.y + rectScreen.height
  );
  const area = {
    minX: Math.min(x1, x2),
    minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2),
    maxY: Math.max(y1, y2),
  };

  loadingOverlay.hidden = false;
  let result;
  try {
    result = await createPrintImage(currentDrawing, area);
  } catch (err) {
    // print-area.js は例外を投げない作りだが、念のため受け止める
    result = { error: `印刷用の絵を作れませんでした。\n詳細：${err && err.message ? err.message : err}` };
  }
  loadingOverlay.hidden = true;

  if (!result || result.error) {
    showError((result && result.error) || '印刷用の絵を作れませんでした。');
    return;
  }

  // 【開発ルール28章】ここでは印刷しない。
  //
  // 以前はここで window.print() を呼んでいたが、iPadで次の不具合が起きた：
  //   - 印刷画面で紙の向きを変えるとページが作り直され、そのとき絵が消えた
  //   - 一度消えると、次に印刷しても二度と絵が出なかった
  //   - 紙の余白にアプリのURLと日付が印刷された（iPadではCSSで止められない）
  //
  // そこで **ページを印刷するのをやめ、絵そのものをiPadへ渡す**ことにした。
  // まずは確認の画面に出して、目で見てもらう。
  printPreview.show(result.dataUrl, {
    blob: result.blob || null,
    name: makePrintFileName(),
    orientation: result.orientation,
    limited: result.limited,
  });
}

/**
 * 印刷する絵のファイル名。図面の名前と日時から作る。
 * iPadの共有メニューに、この名前で出る。
 */
function makePrintFileName() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const 日時 =
    `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `_${p2(d.getHours())}${p2(d.getMinutes())}`;
  // もとのファイル名から拡張子（.dxf など）を外す
  const もと = String(currentName || '図面').replace(/\.[^.]+$/, '');
  return `${もと}_${日時}.png`;
}



attachToolbar(toolbarEl, {
  onOpen: () => {
    if (!viewportMod || !renderMod) {
      showError('図面を表示する部品がまだ準備できていません。しばらくしてからもう一度お試しください。');
      return;
    }
    fileOpener.open();
  },
  onPrint: () => {
    if (!currentDrawing) {
      showError('先に図面を開いてください。');
      return;
    }
    hideError();
    printUi.start();
  },
  onRecent: () => {
    if (!viewportMod || !renderMod) {
      showError('図面を表示する部品がまだ準備できていません。しばらくしてからもう一度お試しください。');
      return;
    }
    showDrawingList();
  },
  onFit: () => {
    const vp = ensureViewport();
    const fitTo = currentDrawing && (currentDrawing.contentBounds || currentDrawing.bounds);
    if (!vp || !fitTo) return;
    viewportMod.fitToBounds(vp, fitTo);
    fittedWidth = vp.width;
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
