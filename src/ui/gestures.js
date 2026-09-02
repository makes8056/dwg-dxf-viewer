// gestures.js — キャンバスの上の指・マウスの操作を受け取る係（開発ルール2.2・2.3・2.4）
//
// このファイルは「操作を分かりやすい形にして、呼び出し側に渡す」だけをする。
// 図面そのものを動かしたり描いたりはしない（それは呼び出し側＝src/ui/app.js の役目）。
//
// 対応する操作
//   指1本でなぞる           → 移動（pan）
//   指2本でつまむ           → 拡大縮小（pinch）。2本指の真ん中を中心にする
//   指2本でなぞる           → 移動（つまみながらでも動かせる）
//   マウスのドラッグ         → 移動（pan）
//   マウスのホイール         → 拡大縮小（zoom）
//   タップ／クリック（動かなかったとき） → onTap
//
// Pointer Events（pointerdown/move/up/cancel）を使うことで、
// 指もマウスも同じ書き方で扱える。
//
// 【事故対策】指を離し忘れたり、画面の外へ指が出て pointerup が取れなかったりしても、
// 状態（押されている指の一覧）が残らないようにしてある。
// ここが残ると「触っていないのに図面が動き続ける」不具合になる（実際に起きた事故）。

// タップと判定する条件：動いた距離がこれ未満なら「タップ」とみなす（指のブレを許す）
const TAP_MOVE_THRESHOLD_PX = 8;

/**
 * キャンバス（などの要素）に指・マウスの操作を取り付ける。
 * @param {HTMLElement} element 操作を受け取る要素（例：canvas）
 * @param {object} handlers
 *   onPan(dxScreen, dyScreen)         … 画面上でこれだけ動かしたい（px）
 *   onZoom(centerX, centerY, factor)  … element基準の座標(centerX, centerY)を中心に、factor倍する
 *   onTap(x, y)                       … element基準の座標をタップした（あとで寸法測定に使う）
 * @returns {() => void} detach。呼ぶと操作の受け取りをやめる。
 */
export function attachGestures(element, handlers = {}) {
  // 今押されている指（マウスなら1つ）。 pointerId → { x, y }（clientX/Y そのまま）
  const pointers = new Map();

  // 2本指のとき、前回の「真ん中の点」と「指の間の距離」。差分計算に使う。
  let lastMidpoint = null;
  let lastDistance = null;

  // タップ判定用。指が1本になった瞬間の開始位置と、そこから動いた総距離。
  let singleStart = null;
  let movedDistance = 0;

  function toPoints() {
    return Array.from(pointers.values());
  }

  function midpointOf(pts) {
    return [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
  }

  function distanceOf(pts) {
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function elementRelative(clientX, clientY) {
    const rect = element.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  // すべての状態を空に戻す（事故対策の要）
  function resetState() {
    pointers.clear();
    lastMidpoint = null;
    lastDistance = null;
    singleStart = null;
    movedDistance = 0;
  }

  function onPointerDown(ev) {
    // 以後、この指が画面の外へ出ても、このpointerIdのイベントはこの要素に届き続ける。
    try {
      element.setPointerCapture(ev.pointerId);
    } catch (err) {
      // 対応していない環境でも、動作自体は続行できる
    }

    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size === 1) {
      singleStart = { x: ev.clientX, y: ev.clientY };
      movedDistance = 0;
      lastMidpoint = null;
      lastDistance = null;
    } else if (pointers.size === 2) {
      const pts = toPoints();
      lastMidpoint = midpointOf(pts);
      lastDistance = distanceOf(pts);
      // 2本目が触れた時点でタップの可能性は消える
      singleStart = null;
    }
    // 3本目以降は無視する（pointersには入れておくが、動きの計算には使わない）
  }

  function onPointerMove(ev) {
    if (!pointers.has(ev.pointerId)) return;
    const prev = pointers.get(ev.pointerId);
    const next = { x: ev.clientX, y: ev.clientY };
    pointers.set(ev.pointerId, next);

    if (pointers.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (dx !== 0 || dy !== 0) {
        movedDistance += Math.hypot(dx, dy);
        handlers.onPan && handlers.onPan(dx, dy);
      }
      return;
    }

    if (pointers.size >= 2) {
      // 3本以上のときも、先頭の2本だけを見て「2本指の操作」として扱う
      const pts = toPoints().slice(0, 2);
      const mid = midpointOf(pts);
      const dist = distanceOf(pts);

      if (lastMidpoint) {
        const dx = mid[0] - lastMidpoint[0];
        const dy = mid[1] - lastMidpoint[1];
        if (dx !== 0 || dy !== 0) {
          handlers.onPan && handlers.onPan(dx, dy);
        }
      }

      if (lastDistance && lastDistance > 0 && dist > 0) {
        const factor = dist / lastDistance;
        if (factor !== 1 && handlers.onZoom) {
          // 中心は「2本指の真ん中」。element基準の座標に直してから渡す。
          const [cx, cy] = elementRelative(mid[0], mid[1]);
          handlers.onZoom(cx, cy, factor);
        }
      }

      lastMidpoint = mid;
      lastDistance = dist;
    }
  }

  function endPointer(ev) {
    if (!pointers.has(ev.pointerId)) return;

    const wasSingle = pointers.size === 1;
    pointers.delete(ev.pointerId);

    try {
      if (element.hasPointerCapture && element.hasPointerCapture(ev.pointerId)) {
        element.releasePointerCapture(ev.pointerId);
      }
    } catch (err) {
      // releaseに失敗しても、以降の処理には影響しない
    }

    if (pointers.size === 0) {
      if (wasSingle && singleStart && movedDistance < TAP_MOVE_THRESHOLD_PX && handlers.onTap) {
        const [x, y] = elementRelative(ev.clientX, ev.clientY);
        handlers.onTap(x, y);
      }
      resetState();
      return;
    }

    if (pointers.size === 1) {
      // 2本 → 1本になった。残った指を新しい基準にして、そこから移動扱いに切り替える。
      // （ここでタップにはしない。もともと2本指で操作していたときの続きのため）
      const [remaining] = toPoints();
      singleStart = { x: remaining.x, y: remaining.y };
      movedDistance = TAP_MOVE_THRESHOLD_PX; // タップ扱いにしない
      lastMidpoint = null;
      lastDistance = null;
    }
  }

  // 指を離し忘れた・画面外に出た場合の最後の砦。
  // pointercancel と lostpointercapture の両方で状態を確実に空にする。
  function onPointerCancel(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size === 0) {
      resetState();
    } else if (pointers.size === 1) {
      const [remaining] = toPoints();
      singleStart = { x: remaining.x, y: remaining.y };
      movedDistance = TAP_MOVE_THRESHOLD_PX;
      lastMidpoint = null;
      lastDistance = null;
    }
  }

  function onLostPointerCapture(ev) {
    if (pointers.has(ev.pointerId)) {
      onPointerCancel(ev);
    }
  }

  // --- マウスのホイールで拡大縮小（パソコンでの確認用） ---
  function onWheel(ev) {
    ev.preventDefault();
    const [cx, cy] = elementRelative(ev.clientX, ev.clientY);
    // deltaYが負＝手前に回す＝拡大、が一般的な感覚に近い
    const factor = Math.pow(1.0015, -ev.deltaY);
    handlers.onZoom && handlers.onZoom(cx, cy, factor);
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endPointer);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onLostPointerCapture);
  element.addEventListener('wheel', onWheel, { passive: false });

  return function detach() {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', endPointer);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onLostPointerCapture);
    element.removeEventListener('wheel', onWheel);
    resetState();
  };
}
