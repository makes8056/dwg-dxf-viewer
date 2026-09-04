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
//
// 【囲んだあとに調整できる（v0.2.4／開発ルール30章）】
//   一度で思いどおりに囲めることは、まずない。とくに手袋をした指では難しい。
//   そこで、囲んだあとに
//     - 四角のまわりの丸（つまみ）をつまんで、大きさを直せる
//     - 四角の中を押したまま動かすと、範囲ごと移動できる
//   ようにした。「やり直す」で最初から囲み直すこともできる（今までどおり）。
//
//   大きさや位置を計算する部分は、下の「四角を直す計算」に**ふつうの関数として**
//   切り出してある。画面が無くても試験できるようにするため（開発ルール7章）。
//
// 【囲んでいる間も、図面を拡大縮小できる（v0.2.5／開発ルール32章）】
//   指1本 … 範囲を囲む・つまみで直す・範囲ごと動かす（今までどおり）
//   指2本 … 図面そのものを拡大縮小・移動する（ピンチ）
//
//   **拡大縮小しても、囲んだ四角は図面の同じ場所に貼り付いたまま**にする。
//   画面の座標のまま置いておくと、図面だけが動いて、
//   囲んだつもりの場所と実際に印刷される場所がずれてしまう。
//   そこで拡大縮小の前に四角を図面の座標へ直し、あとで画面の座標へ戻している。
//   図面の座標との行き来は、決まりどおり viewport.js に任せる（10.6）。
//   ここでは呼び出し側（app.js）からもらった toDrawing / toScreen を使うだけ。

// ------------------------------------------------------------
// 四角を直す計算（画面に触らない。ここだけで試験できる）
// ------------------------------------------------------------

/** つまみの当たり判定の半径（ピクセル）。指で押しやすい大きさ（開発ルール11章：44px以上）。 */
export const HANDLE_HIT_PX = 44;

/** 四角をこれより小さくはできない。小さすぎると印刷できない（開発ルール26.7）。 */
export const MIN_RECT_PX = 28;

/** 辺の真ん中のつまみは、その辺がこれより短いと出さない（角のつまみと重なって押せなくなる）。 */
export const EDGE_HANDLE_MIN_PX = 72;

/** つまみの名前。n=上 s=下 w=左 e=右。'nw'なら左上の角。 */
export const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * それぞれのつまみが、画面のどこに来るか。
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @returns {Record<string,{x:number,y:number}>}
 */
export function handlePositions(rect) {
  const l = rect.x;
  const r = rect.x + rect.width;
  const t = rect.y;
  const b = rect.y + rect.height;
  const cx = (l + r) / 2;
  const cy = (t + b) / 2;
  return {
    nw: { x: l, y: t }, n: { x: cx, y: t }, ne: { x: r, y: t },
    w: { x: l, y: cy }, e: { x: r, y: cy },
    sw: { x: l, y: b }, s: { x: cx, y: b }, se: { x: r, y: b },
  };
}

/**
 * 今おなかに出してよいつまみ。
 * 四角が小さいときに辺の真ん中のつまみまで出すと、角のつまみと重なって押せなくなる。
 * 角の4つは、どんなに小さくても必ず出す。
 * @returns {string[]}
 */
export function visibleHandles(rect) {
  const names = ['nw', 'ne', 'sw', 'se'];
  if (rect.width >= EDGE_HANDLE_MIN_PX) names.push('n', 's');
  if (rect.height >= EDGE_HANDLE_MIN_PX) names.push('w', 'e');
  return names;
}

/**
 * 押した場所が、どのつまみか。どれでもなければ null。
 * 近いものが2つあるときは、いちばん近いほうを返す。
 * @param {object} rect
 * @param {{x:number,y:number}} point
 * @param {number} [tolerance] 当たり判定の半径
 */
export function hitTestHandle(rect, point, tolerance = HANDLE_HIT_PX / 2) {
  const pos = handlePositions(rect);
  let best = null;
  let bestDist = Infinity;
  for (const name of visibleHandles(rect)) {
    const p = pos[name];
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d <= tolerance && d < bestDist) {
      best = name;
      bestDist = d;
    }
  }
  return best;
}

/** 押した場所が、四角の中かどうか（範囲ごと動かす操作の判定に使う）。 */
export function isInsideRect(rect, point) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * つまみを動かして、四角の大きさを直す。
 *
 * - つまんだまま反対側まで行っても壊れない（左右・上下が入れ替わるだけ）
 * - 画面（キャンバス）の外へははみ出さない
 * - 小さくなりすぎない（MIN_RECT_PX 未満にはしない）
 *
 * @param {object} rect いまの四角
 * @param {string} handle つまみの名前（'nw' など）
 * @param {{x:number,y:number}} point 指の位置
 * @param {{width:number,height:number}|null} bounds 画面（キャンバス）の大きさ
 * @param {number} [minSize]
 * @returns {{x:number,y:number,width:number,height:number}} 新しい四角
 */
export function resizeRect(rect, handle, point, bounds = null, minSize = MIN_RECT_PX) {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  const name = String(handle || '');
  if (name.includes('w')) left = point.x;
  if (name.includes('e')) right = point.x;
  if (name.includes('n')) top = point.y;
  if (name.includes('s')) bottom = point.y;

  // つまんだまま反対側へ行ったとき。入れ替えるだけで、そのまま操作を続けられる
  if (left > right) [left, right] = [right, left];
  if (top > bottom) [top, bottom] = [bottom, top];

  const maxW = bounds ? bounds.width : Infinity;
  const maxH = bounds ? bounds.height : Infinity;

  if (bounds) {
    left = clamp(left, 0, maxW);
    right = clamp(right, 0, maxW);
    top = clamp(top, 0, maxH);
    bottom = clamp(bottom, 0, maxH);
  }

  // 小さくなりすぎないように、真ん中から広げ直す
  const minW = Math.min(minSize, maxW);
  const minH = Math.min(minSize, maxH);
  if (right - left < minW) {
    const c = (left + right) / 2;
    left = c - minW / 2;
    right = c + minW / 2;
  }
  if (bottom - top < minH) {
    const c = (top + bottom) / 2;
    top = c - minH / 2;
    bottom = c + minH / 2;
  }

  // 広げ直したことで外へ出たぶんを、中へ押し戻す
  if (bounds) {
    if (left < 0) { right -= left; left = 0; }
    if (top < 0) { bottom -= top; top = 0; }
    if (right > maxW) { left -= right - maxW; right = maxW; }
    if (bottom > maxH) { top -= bottom - maxH; bottom = maxH; }
    left = Math.max(0, left);
    top = Math.max(0, top);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 2本指の真ん中の点。ピンチの中心にする。 */
export function pinchMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 2本指の間の距離。これが広がれば拡大、縮まれば縮小。 */
export function pinchDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 画面の四角 → 図面の座標での範囲。
 * 拡大縮小の前にこれを取っておき、あとで rectFromDrawing で戻すと、
 * **四角が図面の同じ場所に貼り付いたまま**になる。
 * @param {object} rect 画面の四角
 * @param {(x:number,y:number)=>[number,number]} toDrawing viewport.js の変換
 */
export function rectToDrawing(rect, toDrawing) {
  const [x1, y1] = toDrawing(rect.x, rect.y);
  const [x2, y2] = toDrawing(rect.x + rect.width, rect.y + rect.height);
  return {
    minX: Math.min(x1, x2), minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
  };
}

/**
 * 図面の座標での範囲 → 画面の四角（rectToDrawing の逆）。
 * @param {object} area 図面の座標での範囲
 * @param {(x:number,y:number)=>[number,number]} toScreen viewport.js の変換
 */
export function rectFromDrawing(area, toScreen) {
  const [x1, y1] = toScreen(area.minX, area.minY);
  const [x2, y2] = toScreen(area.maxX, area.maxY);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * 四角を、形を変えずにそのまま動かす。画面の外へは出さない。
 * @param {object} rect
 * @param {number} dx 横の移動量
 * @param {number} dy 縦の移動量
 * @param {{width:number,height:number}|null} bounds
 */
export function moveRect(rect, dx, dy, bounds = null) {
  let x = rect.x + dx;
  let y = rect.y + dy;
  if (bounds) {
    x = clamp(x, 0, Math.max(0, bounds.width - rect.width));
    y = clamp(y, 0, Math.max(0, bounds.height - rect.height));
  }
  return { x, y, width: rect.width, height: rect.height };
}

// ------------------------------------------------------------
// ここから下は画面（DOM）を作る部分
// ------------------------------------------------------------

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
  // 'ready'     … モードに入った直後。指が触れるのを待っている（案内だけ出ている）
  // 'dragging'  … 指でなぞって囲んでいる最中
  // 'result'    … 指を離した。つまみとボタンを出している
  // 'adjusting' … つまみをつまんで、大きさを直している最中
  // 'moving'    … 四角の中を押したまま、範囲ごと動かしている最中
  // 'pinching'  … 指2本で、図面そのものを拡大縮小・移動している最中
  let phase = 'ready';

  let activePointerId = null;
  let startPt = null; // canvasEl 基準の座標（開始点）
  let currentRect = null; // canvasEl 基準の座標（確定した四角。'ready' 以外で意味がある）
  let adjustHandle = null; // つまんでいるつまみの名前
  let grabOffset = { x: 0, y: 0 }; // つまんだ瞬間の、指とつまみのずれ
  let movePrev = null; // 範囲ごと動かすときの、前回の指の位置
  // 指で囲んだ・つまんで直した直後の四角（画面の大きさ）。
  // 拡大縮小では更新しない。「指が滑っただけか」の判定に使う（32.3）。
  let lastUserSizedRect = null;

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

  /** 板（＝キャンバス）の大きさ。四角がここから出ないようにするために使う。 */
  function boardSize() {
    if (!board) return null;
    const r = board.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  /** clientX/clientY（マウス・指の生の座標）を canvasEl 基準の座標に直す。 */
  function toCanvasPoint(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function buildDom() {
    board = document.createElement('div');
    board.className = 'pr-board';

    const handlesHtml = HANDLE_NAMES.map(
      (name) => `<span class="pr-handle pr-handle-${name}" data-handle="${name}" hidden></span>`
    ).join('');

    board.innerHTML = `
      <p class="pr-guide">印刷したい範囲を指でなぞって囲んでください<br><span class="pr-guide-sub">2本指で図面を拡大・縮小できます</span></p>
      <div class="pr-select" hidden>${handlesHtml}</div>
      <div class="pr-dim" hidden></div>
      <div class="pr-actions" hidden>
        <p class="pr-hint">丸をつまむと大きさを直せます。四角の中を押したまま動かすと、範囲ごと動かせます。<br>2本指で図面を拡大・縮小できます（範囲は図面についてきます）。</p>
        <button type="button" class="pr-btn pr-btn-print">この範囲を印刷</button>
        <div class="pr-actions-row">
          <button type="button" class="pr-btn pr-btn-retry">囲み直す</button>
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
    // passive:false … 拡大縮小のときにページ自体が動くのを止めるため
    board.addEventListener('wheel', onWheel, { passive: false });

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
    board.removeEventListener('wheel', onWheel);
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

  /** つまみを出す（なぞっている最中は出さない。囲み終わってから出す）。 */
  function paintHandles(rect, show) {
    const 出すもの = show ? visibleHandles(rect) : [];
    for (const el of selectEl.querySelectorAll('.pr-handle')) {
      el.hidden = !出すもの.includes(el.dataset.handle);
    }
  }

  function hideRect() {
    selectEl.hidden = true;
    dimEl.hidden = true;
    paintHandles({ width: 0, height: 0 }, false);
  }

  /**
   * ボタンの箱が、つまみを隠さない場所を選ぶ。
   *
   * 【隠れると調整できなくなる】
   * 四角が画面の下のほうにあると、ボタンの箱が下のつまみの上に重なる。
   * 重なると指が箱に取られて、**下の辺を動かせなくなる。**
   *
   * 箱の高さを決め打ちで見積もると、数ピクセルの差で判定を外す（実機で外した）。
   * ここでは**実際に置いてみて、本当に重なるかを測る。**
   */
  function positionActions(rect) {
    if (!board || actionsEl.hidden) return; // 隠れている間は大きさを測れない

    const 重なるか = (上に置く) => {
      actionsEl.classList.toggle('pr-actions-top', 上に置く);
      const a = actionsEl.getBoundingClientRect();
      const b = board.getBoundingClientRect();
      const 箱 = {
        left: a.left - b.left,
        top: a.top - b.top,
        right: a.right - b.left,
        bottom: a.bottom - b.top,
      };
      const 半径 = HANDLE_HIT_PX / 2;
      return visibleHandles(rect).some((name) => {
        const pt = handlePositions(rect)[name];
        return (
          pt.x + 半径 > 箱.left &&
          pt.x - 半径 < 箱.right &&
          pt.y + 半径 > 箱.top &&
          pt.y - 半径 < 箱.bottom
        );
      });
    };

    if (!重なるか(false)) return; // 下のままでよい
    if (重なるか(true)) {
      // 上でも下でも重なる（画面いっぱいに囲んだとき）。下に戻しておく
      actionsEl.classList.toggle('pr-actions-top', false);
    }
  }

  function showActions(rect) {
    // 先に出す。隠れたままだと大きさが測れず、置き場所を決められない
    actionsEl.hidden = false;
    positionActions(rect);
    // ボタンが出ている間は、上の案内は消す（つまみと重なるし、案内は箱の中にある）
    guideEl.hidden = true;
  }

  function hideActions() {
    actionsEl.hidden = true;
    guideEl.hidden = false;
  }

  /** 囲み終わった（または調整し終わった）状態にする。 */
  function settle(rect, 指で決めた = true) {
    currentRect = rect;
    if (指で決めた) lastUserSizedRect = rect;
    phase = 'result';
    paintRect(currentRect);
    paintHandles(currentRect, true);
    showActions(currentRect);
  }

  // ------------------------------------------------------------
  // 指・マウスの操作
  //
  // 指1本 … 範囲を囲む・つまみで直す・範囲ごと動かす
  // 指2本 … 図面そのものを拡大縮小・移動する（開発ルール32章）
  // ------------------------------------------------------------

  /** 今おさえている指。pointerId → { x, y }（clientX/Y そのまま）。gestures.js と同じ持ち方。 */
  const pointers = new Map();
  let lastPinchMid = null;
  let lastPinchDist = null;
  /** 1本指の操作を始める直前の四角。2本目の指が触れたときに、ここまで戻す。 */
  let rectBeforeGesture = null;

  function beginPointer(ev) {
    try {
      board.setPointerCapture(ev.pointerId);
    } catch (err) {
      // 対応していない環境でも、動作自体は続行できる
    }
    activePointerId = ev.pointerId;
    rectBeforeGesture = currentRect;
  }

  /** 今おさえている指のうち、先頭の2本（3本目以降は見ない）。 */
  function twoPoints() {
    return Array.from(pointers.values()).slice(0, 2);
  }

  /**
   * 図面を動かす（拡大縮小・移動）。
   *
   * 【四角は図面に貼り付けたまま動かす（開発ルール32.2）】
   * 何もしないと、図面だけが動いて四角は画面に取り残される。
   * すると「囲んだつもりの場所」と「実際に印刷される場所」がずれる。
   * そこで、動かす前に四角を図面の座標へ直し、動かしたあとで画面の座標へ戻す。
   */
  function moveView(動かす) {
    const 貼り付け先 =
      currentRect && handlers.toDrawing && handlers.toScreen
        ? rectToDrawing(currentRect, handlers.toDrawing)
        : null;

    動かす();

    if (!貼り付け先) return;
    currentRect = rectFromDrawing(貼り付け先, handlers.toScreen);
    paintRect(currentRect);
    paintHandles(currentRect, phase !== 'dragging');
    positionActions(currentRect);
  }

  /** 2本目の指が触れた。1本指でやりかけていたことを、なかったことにする。 */
  function switchToPinch() {
    if (activePointerId !== null) releaseCapture(activePointerId);
    activePointerId = null;
    adjustHandle = null;
    movePrev = null;
    startPt = null;

    if (phase === 'dragging') {
      // 囲みかけだった。まだ四角として確定していないので、捨てて元に戻す
      currentRect = rectBeforeGesture;
      if (currentRect) settle(currentRect);
      else {
        phase = 'ready';
        hideRect();
        hideActions();
      }
    } else if ((phase === 'adjusting' || phase === 'moving') && rectBeforeGesture) {
      // つまみ始めていた。2本指で拡大したいだけなので、つまむ前の形に戻す
      currentRect = rectBeforeGesture;
      settle(currentRect);
    }

    phase = 'pinching';
    const pts = twoPoints();
    lastPinchMid = pinchMidpoint(pts[0], pts[1]);
    lastPinchDist = pinchDistance(pts[0], pts[1]);
  }

  function onPointerDown(ev) {
    // ボタンの箱の上を押したときは、なぞり操作として扱わない（ボタン自身の click に任せる）。
    if (ev.target.closest('.pr-actions')) return;

    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size >= 2) {
      switchToPinch();
      return;
    }

    const pt = toCanvasPoint(ev.clientX, ev.clientY);

    // まだ何もなぞっていない → 新しく囲む
    if (phase === 'ready') {
      beginPointer(ev);
      startPt = pt;
      phase = 'dragging';
      paintRect({ x: startPt.x, y: startPt.y, width: 0, height: 0 });
      paintHandles({ width: 0, height: 0 }, false);
      return;
    }

    // 囲み終わっている → つまみ／範囲ごとの移動（v0.2.4で追加）
    if (phase === 'result' && currentRect) {
      const handle = hitTestHandle(currentRect, pt);
      if (handle) {
        beginPointer(ev);
        adjustHandle = handle;
        const pos = handlePositions(currentRect)[handle];
        // つまんだ瞬間のずれを覚えておく。これが無いと、つまんだ辺が指の位置へ飛ぶ
        grabOffset = { x: pos.x - pt.x, y: pos.y - pt.y };
        phase = 'adjusting';
        return;
      }
      if (isInsideRect(currentRect, pt)) {
        beginPointer(ev);
        movePrev = pt;
        phase = 'moving';
        return;
      }
      // 四角の外を押したときは何もしない。囲み直すときは「囲み直す」を押してもらう
    }
  }

  function onPointerMove(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    // 指2本：図面を拡大縮小・移動する
    if (phase === 'pinching' && pointers.size >= 2) {
      const pts = twoPoints();
      const mid = pinchMidpoint(pts[0], pts[1]);
      const dist = pinchDistance(pts[0], pts[1]);

      moveView(() => {
        if (lastPinchMid) {
          const dx = mid.x - lastPinchMid.x;
          const dy = mid.y - lastPinchMid.y;
          if ((dx !== 0 || dy !== 0) && handlers.onPan) handlers.onPan(dx, dy);
        }
        if (lastPinchDist > 0 && dist > 0 && handlers.onZoom) {
          const factor = dist / lastPinchDist;
          if (factor !== 1) {
            const c = toCanvasPoint(mid.x, mid.y);
            handlers.onZoom(c.x, c.y, factor);
          }
        }
      });

      lastPinchMid = mid;
      lastPinchDist = dist;
      return;
    }

    if (ev.pointerId !== activePointerId) return;
    const pt = toCanvasPoint(ev.clientX, ev.clientY);

    if (phase === 'dragging') {
      paintRect(normalizeRect(startPt, pt));
      return;
    }

    if (phase === 'adjusting') {
      currentRect = resizeRect(
        currentRect,
        adjustHandle,
        { x: pt.x + grabOffset.x, y: pt.y + grabOffset.y },
        boardSize()
      );
      paintRect(currentRect);
      paintHandles(currentRect, true);
      positionActions(currentRect);
      return;
    }

    if (phase === 'moving') {
      currentRect = moveRect(currentRect, pt.x - movePrev.x, pt.y - movePrev.y, boardSize());
      movePrev = pt;
      paintRect(currentRect);
      positionActions(currentRect);
    }
  }

  function onPointerUp(ev) {
    const いた = pointers.delete(ev.pointerId);
    if (!いた) return;

    // 指2本 → 1本以下。拡大縮小は終わり。
    // 残った指はそのまま置いておく（続けて囲み始めたりはしない）。
    if (phase === 'pinching') {
      if (pointers.size < 2) {
        lastPinchMid = null;
        lastPinchDist = null;
        if (currentRect) settle(currentRect, false);
        else {
          phase = 'ready';
          hideRect();
          hideActions();
        }
      }
      return;
    }

    if (ev.pointerId !== activePointerId) return;
    releaseCapture(ev.pointerId);
    activePointerId = null;

    if (phase === 'dragging') {
      const pt = toCanvasPoint(ev.clientX, ev.clientY);
      settle(normalizeRect(startPt, pt));
      return;
    }

    if (phase === 'adjusting' || phase === 'moving') {
      adjustHandle = null;
      movePrev = null;
      settle(currentRect);
    }
  }

  /** 指を離し忘れた・画面の外へ出た（pointercancel）ときの事故対策。gestures.js と同じ考え方。 */
  function onPointerCancel(ev) {
    pointers.delete(ev.pointerId);

    if (phase === 'pinching') {
      if (pointers.size < 2) {
        lastPinchMid = null;
        lastPinchDist = null;
        if (currentRect) settle(currentRect, false);
        else {
          phase = 'ready';
          hideRect();
          hideActions();
        }
      }
      return;
    }

    if (ev.pointerId !== activePointerId) return;
    releaseCapture(ev.pointerId);
    activePointerId = null;

    // 調整の途中で中断したときは、**そこまでの四角を残す。**
    // せっかく合わせた範囲を消してしまうと、また一から囲み直しになる。
    if ((phase === 'adjusting' || phase === 'moving') && currentRect) {
      adjustHandle = null;
      movePrev = null;
      settle(currentRect);
      return;
    }

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

  /** マウスのホイールでも拡大縮小できるようにする（パソコンでの確認用。gestures.js と同じ）。 */
  function onWheel(ev) {
    ev.preventDefault();
    if (!handlers.onZoom) return;
    const pt = toCanvasPoint(ev.clientX, ev.clientY);
    const factor = Math.pow(1.0015, -ev.deltaY);
    moveView(() => {
      handlers.onZoom(pt.x, pt.y, factor);
    });
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
    // 【開発ルール32.3】「指が滑っただけか」の判定は、**囲んだときの大きさ**で行う。
    // 縮小して図面ぜんたいを見てから印刷すると、四角は画面上では小さく見える。
    // それを「範囲が小さすぎる」と断ってはいけない。範囲そのものは変わっていない。
    const 囲んだときの大きさ = lastUserSizedRect || rect;
    teardown();
    handlers.onPrint?.(rect, { sizedRect: 囲んだときの大きさ });
  }

  function onRetryClick() {
    if (phase !== 'result') return;
    currentRect = null;
    lastUserSizedRect = null;
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
    lastUserSizedRect = null;
    adjustHandle = null;
    movePrev = null;
    pointers.clear();
    lastPinchMid = null;
    lastPinchDist = null;
    rectBeforeGesture = null;
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
