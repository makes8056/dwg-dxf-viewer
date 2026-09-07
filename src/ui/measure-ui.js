// measure-ui.js — 「長さを測る」画面（開発ルール39章）
//
// 【この係の役目】
//   測った印（丸・線・長さの文字）を、キャンバスの上に出すだけ。
//   長さの計算は src/measure.js、座標の変換は viewport.js に任せる（2.4・10.6）。
//
// 【印刷する範囲を囲む画面（print-ui.js）とは、作りを変えている】
//   あちらは「透明な板をかぶせて指を全部受け取る」作りだった。
//   こちらは**板をかぶせない。**
//     - 指1本のタップ … gestures.js の onTap がすでに拾ってくれる
//     - 指2本・ホイール … 今までどおり図面の拡大縮小・移動がそのまま効く
//   板をかぶせると、その拡大縮小をもう一度作り直すことになる（32章・33章）。
//   **動いているものを作り直さない。**
//
//   そのため、この画面の部品は原則 `pointer-events: none` にして、指を素通しさせる。
//   受け取るのは**ボタンと、測った丸だけ**。
//   丸は「つまんで動かす」ために受け取る（42章）。丸の上で2本指を始められたときは、
//   つまむのをやめて拡大縮小に譲る。
//
// 【図面を動かしたら、印も一緒に動かす】
//   印は画面の座標で置いてあるので、拡大縮小や移動のたびに置き直す必要がある。
//   app.js が描き直しのたびに refresh() を呼ぶ。

import { measureBetween, formatLength, formatAngle } from '../measure.js';

/**
 * 「長さを測る」画面を用意する。
 *
 * @param {object} handlers
 *   toScreen(x, y) … 図面の座標 → 画面の座標（[sx, sy] を返す）
 *   onExit()       … 「終わる」で抜けた
 * @returns {{
 *   start: () => void,
 *   stop: () => void,
 *   isActive: () => boolean,
 *   addPoint: (point: {x:number,y:number,kind?:string}) => void,
 *   refresh: () => void
 * }}
 */
export function createMeasureUi(canvasEl, handlers = {}) {
  let active = false;
  /** 測った点（図面の座標）。0個・1個・2個のどれか。 */
  let points = [];

  let root = null;
  let svg = null;
  let 線 = null;
  let 丸たち = [];
  let ラベル = null;
  let 案内 = null;
  let 結果 = null;
  let 結果の文字 = null;
  let やり直し = null;
  /** キャンバスの大きさを見張る係（42.5）。 */
  let 大きさの見張り = null;

  function build() {
    root = document.createElement('div');
    root.className = 'ms-root';
    root.innerHTML = `
      <svg class="ms-svg"><line class="ms-line" hidden /></svg>
      <span class="ms-dot ms-dot-1" hidden></span>
      <span class="ms-dot ms-dot-2" hidden></span>
      <span class="ms-label" hidden></span>
      <p class="ms-guide">測りたいところを2つタップしてください<br>
        <span class="ms-guide-sub">線の端・真ん中・円の中心に吸い付きます。<br>
        細かく測るときは、2本指で拡大してからタップしてください</span></p>
      <div class="ms-result">
        <p class="ms-result-text"></p>
        <div class="ms-buttons">
          <button type="button" class="ms-btn ms-again">はじめから</button>
          <button type="button" class="ms-btn ms-close">終わる</button>
        </div>
      </div>`;
    document.body.appendChild(root);

    svg = root.querySelector('.ms-svg');
    線 = root.querySelector('.ms-line');
    丸たち = [root.querySelector('.ms-dot-1'), root.querySelector('.ms-dot-2')];
    ラベル = root.querySelector('.ms-label');
    案内 = root.querySelector('.ms-guide');
    結果 = root.querySelector('.ms-result');
    結果の文字 = root.querySelector('.ms-result-text');

    やり直し = root.querySelector('.ms-again');

    // 【印をつまんで動かせるようにする（開発ルール42章）】
    // 以前は「1つ前にもどる」で消して置き直す形だった。
    // 実機で「戻るのではなく、その印を動かしたい」と言われた。
    // ずれているのは位置だけなので、位置だけ直せるほうが手数が少ない。
    丸たち.forEach((el, i) => {
      if (!el) return;
      el.addEventListener('pointerdown', (ev) => つまむ(ev, i));
      // 指を捕まえてあるので、動きも離しもこの丸に届く
      el.addEventListener('pointermove', 動かす);
      el.addEventListener('pointerup', はなす);
      el.addEventListener('pointercancel', はなす);
    });

    やり直し.addEventListener('click', () => {
      points = [];
      refresh();
    });
    root.querySelector('.ms-close').addEventListener('click', () => stop());

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', position);
    window.addEventListener('orientationchange', position);

    // 【イベント頼みにしない（開発ルール42.5）】
    // 画面の向きを変えた直後は、resize が届いた時点でまだ
    // **キャンバスが古い大きさのまま**のことがある。
    // そのとき position() は古い値を読み、この画面だけ大きさが取り残される。
    // 実測で、iPadの幅（768px）に変えたあとも枠が1280pxのままだった。
    // 「終わる」ボタンが画面の外へ出てしまう（右端が846pxで、画面は768px）。
    //
    // そこで、イベントを待つのではなく**キャンバスの大きさを直接見張る**。
    // app.js の watchLayoutChanges と同じ考え方（30章）。
    if (typeof ResizeObserver === 'function') {
      大きさの見張り = new ResizeObserver(() => {
        // ブラウザが位置を決め終わるのを1コマ待ってから測る
        requestAnimationFrame(position);
      });
      大きさの見張り.observe(canvasEl);
    }

    position();
  }

  // 【必ずこの形で持つこと（開発ルール41章）】
  //
  // 以前は、下の「終わる」ボタンから返り値の側の stop() を呼ぼうとしていた。
  // その stop は**ここからは見えない**ので、呼ばれていたのは
  // ブラウザが最初から持っている window.stop（ページの読み込みを止めるもの）だった。
  //
  // 名前が同じものが世の中にあるせいで、**エラーにもならず、静かに何も起きない。**
  // 実機で「終わるボタンを押しても反応がない」となった。
  // ファイルの中で呼ぶものは、ファイルの中で必ず定義する。
  function stop() {
    if (!active) return;
    active = false;
    points = [];
    destroy();
    handlers.onExit && handlers.onExit();
  }

  // ------------------------------------------------------------
  // 印をつまんで動かす（開発ルール42章）
  //
  // 【いちばん気をつけたこと：2本指の拡大縮小を壊さない】
  // この画面は板をかぶせない作りで、指は canvas に素通しさせている（39章）。
  // 丸だけが指を受け取るので、丸の上で2本指を始められると
  // 拡大縮小が効かなくなる。そこで**2本目の指が来たら、動かすのをやめて譲る。**
  // 32章・33章で作った拡大縮小を、ここでもう一度作らないための決まりでもある。
  // ------------------------------------------------------------

  /** 今つまんでいる丸。{ index, pointerId } か null。 */
  let つまみ中 = null;

  function つまむ(ev, index) {
    if (つまみ中) return;
    if (index >= points.length) return;      // まだ置いていない丸
    if (ev.button !== undefined && ev.button > 0) return; // 右クリックなどは無視

    // ここで止めないと、図面まで一緒に動いてしまう
    ev.preventDefault();
    ev.stopPropagation();

    つまみ中 = { index, pointerId: ev.pointerId };
    const el = 丸たち[index];
    el.classList.add('ms-dot-tsumami');
    try {
      el.setPointerCapture(ev.pointerId);
    } catch (e) {
      // 捕まえられなくても、下の見張りで動きは追える
    }
    // 2本目の指を見張る。捕まえている指には届かないので window で受ける
    window.addEventListener('pointerdown', 二本目が来た, true);
    refresh();
  }

  function 二本目が来た(ev) {
    if (!つまみ中 || ev.pointerId === つまみ中.pointerId) return;
    // 拡大縮小をしようとしている。つまむのをやめて、指を図面に返す
    はなす();
  }

  function 動かす(ev) {
    if (!つまみ中 || ev.pointerId !== つまみ中.pointerId) return;
    ev.preventDefault();
    if (!handlers.snapAt) return;

    // 丸の位置はキャンバスの左上が基準（toScreen と同じ物差しにそろえる）
    const r = canvasEl.getBoundingClientRect();
    const p = handlers.snapAt(ev.clientX - r.left, ev.clientY - r.top);
    if (!p) return;

    points[つまみ中.index] = { x: p.x, y: p.y, kind: p.kind };
    refresh();
  }

  function はなす() {
    if (!つまみ中) return;
    const el = 丸たち[つまみ中.index];
    if (el) {
      el.classList.remove('ms-dot-tsumami');
      try {
        el.releasePointerCapture(つまみ中.pointerId);
      } catch (e) {
        // すでに離れている
      }
    }
    つまみ中 = null;
    window.removeEventListener('pointerdown', 二本目が来た, true);
    refresh();
  }

  function destroy() {
    if (!root) return;
    // 【必ず先に呼ぶ】window に付けた見張りを外さないと、
    // 画面を閉じたあとも残り続ける（触っていないのに動く不具合のもと）
    はなす();
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', position);
    window.removeEventListener('orientationchange', position);
    if (大きさの見張り) {
      大きさの見張り.disconnect();
      大きさの見張り = null;
    }
    root.remove();
    root = null;
    svg = null;
    線 = null;
    丸たち = [];
    ラベル = null;
    案内 = null;
    結果 = null;
    結果の文字 = null;
    やり直し = null;
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape') stop();
  }

  /** キャンバスの位置・大きさに合わせる。 */
  function position() {
    if (!root) return;
    const r = canvasEl.getBoundingClientRect();
    root.style.left = `${r.left}px`;
    root.style.top = `${r.top}px`;
    root.style.width = `${r.width}px`;
    root.style.height = `${r.height}px`;
    if (svg) {
      svg.setAttribute('width', String(r.width));
      svg.setAttribute('height', String(r.height));
    }
  }

  /** 印を、今の表示に合わせて置き直す。 */
  function refresh() {
    if (!active || !root) return;
    position();

    const 画面の点 = points.map((p) => {
      const [sx, sy] = handlers.toScreen ? handlers.toScreen(p.x, p.y) : [0, 0];
      return { sx, sy };
    });

    丸たち.forEach((el, i) => {
      if (!el) return;
      if (i < 画面の点.length) {
        el.style.left = `${画面の点[i].sx}px`;
        el.style.top = `${画面の点[i].sy}px`;
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });

    if (画面の点.length === 2) {
      線.setAttribute('x1', String(画面の点[0].sx));
      線.setAttribute('y1', String(画面の点[0].sy));
      線.setAttribute('x2', String(画面の点[1].sx));
      線.setAttribute('y2', String(画面の点[1].sy));
      線.hidden = false;

      const m = measureBetween(points[0], points[1]);
      const 長さ = formatLength(m.distance, handlers.units || 'mm');
      ラベル.textContent = 長さ;
      ラベル.style.left = `${(画面の点[0].sx + 画面の点[1].sx) / 2}px`;
      ラベル.style.top = `${(画面の点[0].sy + 画面の点[1].sy) / 2}px`;
      ラベル.hidden = false;

      const 単位 = handlers.units || 'mm';
      // 【どこに吸い付いたかを必ず見せる（開発ルール39.4）】
      // 縮小したまま測ると、吸い付く範囲が図面の上ではとても広くなり、
      // **狙っていない点に吸い付いても気づけない。**
      // 何に合わせたのかを出しておけば、おかしければ気づける。
      結果の文字.innerHTML =
        `<strong>${長さ}</strong>` +
        `<span class="ms-sub">よこ ${formatLength(Math.abs(m.dx), 単位)}` +
        ` ／ たて ${formatLength(Math.abs(m.dy), 単位)}` +
        ` ／ 角度 ${formatAngle(m.angleDeg)}</span>` +
        `<span class="ms-sub">合わせた先：${points[0].kind || '—'} → ${points[1].kind || '—'}</span>` +
        '<span class="ms-sub">ずれていたら、赤い印をつまんで動かせます</span>';
      案内.hidden = true;
    } else {
      線.hidden = true;
      ラベル.hidden = true;
      // 【結果の箱は隠さない（開発ルール41章）】
      // 以前は2点そろうまで隠していた。そのため、測っている途中は
      // **「終わる」ボタンが画面のどこにも無かった。**
      // 抜ける道は、いつでも見えているようにする。
      結果の文字.innerHTML =
        points.length === 0
          ? '<span class="ms-sub">まだ測っていません</span>'
          : `<span class="ms-sub">1つ目：${points[0].kind || 'そのまま'}に合わせました</span>`;
      案内.hidden = false;
      案内.innerHTML =
        points.length === 0
          ? '測りたいところを2つタップしてください<br>' +
            '<span class="ms-guide-sub">線の端・真ん中・円の中心に吸い付きます</span>'
          : 'もう1つタップしてください<br>' +
            `<span class="ms-guide-sub">1つ目は「${points[0].kind || 'そのまま'}」に合わせました。` +
            '赤い印はつまんで動かせます</span>';
    }

    // 何も測っていないときは、戻す先も消す先も無い
    やり直し.disabled = points.length === 0;
  }

  return {
    start() {
      if (active) return;
      active = true;
      points = [];
      build();
      refresh();
    },
    stop,
    isActive: () => active,
    /** タップされた場所（図面の座標）を足す。3つ目からは、新しく測り直す。 */
    addPoint(point) {
      if (!active || !point) return;
      if (points.length >= 2) points = [];
      points.push({ x: point.x, y: point.y, kind: point.kind });
      refresh();
    },
    /** 今までに測った点（テストと不具合調査のため）。 */
    getPoints: () => points.slice(),
    refresh,
  };
}
