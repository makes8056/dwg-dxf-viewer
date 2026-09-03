// print-ui.js — 「印刷する範囲を指で囲む」画面（開発ルール2.2：1ファイル1役割・26章）
//
// このファイルは「範囲を指で囲む画面」だけを作る部品。
// 印刷用の絵を作る処理はしない（それは src/print-area.js の役目。開発ルール2.4）。
//
// 見本：src/ui/drawing-list.js と同じ作り方（自分で document.body に要素を足す）。
//
// 【開発ルール26.4】キャンバスの上に透明な板を1枚かぶせて、そこで指を受ける。
//   図面を動かす操作（gestures.js）と範囲を囲む操作がぶつからないようにするため。
//   Pointer Events（pointerdown/move/up/cancel）で、指もマウスも同じ書き方で扱う
//   （gestures.js と同じ考え方）。

/** 大きさを画面のピクセル数の文字にする（開発ルール26.2：縮尺は出さない。ピクセル数でよい）。 */
function formatSizeText(width, height) {
  return `横${Math.round(width)}×縦${Math.round(height)}`;
}

/**
 * ふたつの点から「正しい四角」を作る。
 * 右下→左上のように逆向きになぞられても、x/y が常に小さいほうの値になるようにする。
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  return { x, y, width, height };
}

/**
 * 「印刷する範囲を指で囲む」画面を用意する。
 * @param {HTMLElement} canvasEl 図面を描いているキャンバス（この上に透明な板をかぶせる）
 * @param {object} handlers
 *   onPrint(rectScreen) … 「この範囲を印刷」が押された。
 *                         rectScreen は画面座標の四角 { x, y, width, height }
 *   onCancel()          … 「やめる」で抜けた
 * @returns {{
 *   start: () => void,
 *   stop: () => void,
 *   isActive: () => boolean
 * }}
 */
export function createPrintUi(canvasEl, handlers = {}) {
  let active = false;
  // 'ready'    … モードに入った直後。指が触れるのを待っている（案内だけ出ている）
  // 'dragging' … 指でなぞっている最中
  // 'result'   … 指を離した。3つのボタンを出している
  let phase = 'ready';

  let activePointerId = null;
  let startPt = null; // canvasEl 基準の座標（開始点）
  let currentRect = null; // canvasEl 基準の座標（確定した四角。'result' のときだけ意味がある）

  // ------------------------------------------------------------
  // DOM。start() のたびに作り、stop() のたびに消す（開発ルール26.4：抜けたら板を必ず取り除く）
  // ------------------------------------------------------------
  let board = null;
  let guideEl = null;
  let selectEl = null;
  let dimEl = null;
  let actionsEl = null;
  let printBtn = null;
  let retryBtn = null;
  let cancelBtn = null;

  /** canvasEl の今の位置・大きさに、透明な板をぴったり合わせる。 */
  function positionBoard() {
    if (!board) return;
    const rect = canvasEl.getBoundingClientRect();
    board.style.left = `${rect.left}px`;
    board.style.top = `${rect.top}px`;
    board.style.width = `${rect.width}px`;
    board.style.height = `${rect.height}px`;
  }

  /** clientX/clientY（マウス・指の生の座標）を canvasEl 基準の座標に直す。 */
  function toCanvasPoint(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function buildDom() {
    board = document.createElement('div');
    board.className = 'pr-board';

    board.innerHTML = `
      <p class="pr-guide">印刷したい範囲を指でなぞって囲んでください</p>
      <div class="pr-select" hidden></div>
      <div class="pr-dim" hidden></div>
      <div class="pr-actions" hidden>
        <button type="button" class="pr-btn pr-btn-print">この範囲を印刷</button>
        <div class="pr-actions-row">
          <button type="button" class="pr-btn pr-btn-retry">やり直す</button>
          <button type="button" class="pr-btn pr-btn-cancel">やめる</button>
        </div>
      </div>
    `;

    document.body.appendChild(board);

    guideEl = board.querySelector('.pr-guide');
    selectEl = board.querySelector('.pr-select');
    dimEl = board.querySelector('.pr-dim');
    actionsEl = board.querySelector('.pr-actions');
    printBtn = board.querySelector('.pr-btn-print');
    retryBtn = board.querySelector('.pr-btn-retry');
    cancelBtn = board.querySelector('.pr-btn-cancel');

    positionBoard();

    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerCancel);
    board.addEventListener('lostpointercapture', onLostPointerCapture);

    printBtn.addEventListener('click', onPrintClick);
    retryBtn.addEventListener('click', onRetryClick);
    cancelBtn.addEventListener('click', onCancelClick);

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', positionBoard);
    window.addEventListener('orientationchange', positionBoard);
  }

  function removeDom() {
    if (!board) return;

    board.removeEventListener('pointerdown', onPointerDown);
    board.removeEventListener('pointermove', onPointerMove);
    board.removeEventListener('pointerup', onPointerUp);
    board.removeEventListener('pointercancel', onPointerCancel);
    board.removeEventListener('lostpointercapture', onLostPointerCapture);
    printBtn.removeEventListener('click', onPrintClick);
    retryBtn.removeEventListener('click', onRetryClick);
    cancelBtn.removeEventListener('click', onCancelClick);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', positionBoard);
    window.removeEventListener('orientationchange', positionBoard);

    board.remove();
    board = null;
    guideEl = null;
    selectEl = null;
    dimEl = null;
    actionsEl = null;
    printBtn = null;
    retryBtn = null;
    cancelBtn = null;
  }

  // ------------------------------------------------------------
  // 見た目の更新
  // ------------------------------------------------------------

  /** なぞっている最中・確定後、四角と大きさの表示を rect の形に合わせる。 */
  function paintRect(rect) {
    selectEl.style.left = `${rect.x}px`;
    selectEl.style.top = `${rect.y}px`;
    selectEl.style.width = `${rect.width}px`;
    selectEl.style.height = `${rect.height}px`;
    selectEl.hidden = false;

    dimEl.textContent = formatSizeText(rect.width, rect.height);
    // 四角の少し上に出す。画面の上端に近いときは、四角の中（上のほう）に出す
    // （画面からはみ出て見えなくなるのを防ぐ）。
    const boardRect = board.getBoundingClientRect();
    const labelAboveFits = rect.y > 30;
    dimEl.style.top = labelAboveFits ? `${rect.y - 26}px` : `${rect.y + 6}px`;
    const maxLeft = Math.max(4, boardRect.width - 130);
    dimEl.style.left = `${Math.min(Math.max(rect.x, 4), maxLeft)}px`;
    dimEl.hidden = false;
  }

  function hideRect() {
    selectEl.hidden = true;
    dimEl.hidden = true;
  }

  function showActions() {
    actionsEl.hidden = false;
  }

  function hideActions() {
    actionsEl.hidden = true;
  }

  // ------------------------------------------------------------
  // 指・マウスの操作
  // ------------------------------------------------------------

  function onPointerDown(ev) {
    // ボタンの上を押したときは、なぞり操作として扱わない（ボタン自身の click に任せる）。
    if (ev.target.closest('.pr-btn')) return;
    // 新しく囲めるのは、まだ何もなぞっていない（'ready'）ときだけ。
    // 'dragging' 中に別の指が触れても無視する（1本指だけを見る）。
    // 'result' のときは「やり直す」を押してもらう（開発ルール26.4：単純なほうが安全）。
    if (phase !== 'ready') return;

    try {
      board.setPointerCapture(ev.pointerId);
    } catch (err) {
      // 対応していない環境でも、動作自体は続行できる
    }

    activePointerId = ev.pointerId;
    startPt = toCanvasPoint(ev.clientX, ev.clientY);
    phase = 'dragging';
    paintRect({ x: startPt.x, y: startPt.y, width: 0, height: 0 });
  }

  function onPointerMove(ev) {
    if (phase !== 'dragging' || ev.pointerId !== activePointerId) return;
    const pt = toCanvasPoint(ev.clientX, ev.clientY);
    const rect = normalizeRect(startPt, pt);
    paintRect(rect);
  }

  function onPointerUp(ev) {
    if (phase !== 'dragging' || ev.pointerId !== activePointerId) return;
    releaseCapture(ev.pointerId);

    const pt = toCanvasPoint(ev.clientX, ev.clientY);
    currentRect = normalizeRect(startPt, pt);
    activePointerId = null;
    phase = 'result';
    paintRect(currentRect);
    showActions();
  }

  /** 指を離し忘れた・画面の外へ出た（pointercancel）ときの事故対策。gestures.js と同じ考え方。 */
  function onPointerCancel(ev) {
    if (ev.pointerId !== activePointerId) return;
    releaseCapture(ev.pointerId);
    activePointerId = null;
    startPt = null;
    phase = 'ready';
    hideRect();
    hideActions();
  }

  function onLostPointerCapture(ev) {
    if (ev.pointerId === activePointerId) {
      onPointerCancel(ev);
    }
  }

  function releaseCapture(pointerId) {
    try {
      if (board.hasPointerCapture && board.hasPointerCapture(pointerId)) {
        board.releasePointerCapture(pointerId);
      }
    } catch (err) {
      // releaseに失敗しても、以降の処理には影響しない
    }
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape') {
      onCancelClick();
    }
  }

  // ------------------------------------------------------------
  // 3つのボタン
  // ------------------------------------------------------------

  function onPrintClick() {
    if (phase !== 'result' || !currentRect) return;
    const rect = currentRect;
    teardown();
    handlers.onPrint?.(rect);
  }

  function onRetryClick() {
    if (phase !== 'result') return;
    currentRect = null;
    phase = 'ready';
    hideRect();
    hideActions();
  }

  function onCancelClick() {
    if (!active) return;
    teardown();
    handlers.onCancel?.();
  }

  // ------------------------------------------------------------
  // 公開する関数
  // ------------------------------------------------------------

  /** モードから抜けて、状態をすべて空に戻す（何度呼んでも安全）。 */
  function teardown() {
    if (!active) return;
    removeDom();
    active = false;
    phase = 'ready';
    activePointerId = null;
    startPt = null;
    currentRect = null;
  }

  function start() {
    if (active) return;
    active = true;
    phase = 'ready';
    buildDom();
  }

  function stop() {
    teardown();
  }

  function isActive() {
    return active;
  }

  return { start, stop, isActive };
}
