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
//   そのため、この画面の部品はすべて `pointer-events: none` にして、
//   指をいっさい受け取らない（ボタンだけは受け取る）。
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
      <div class="ms-result" hidden>
        <p class="ms-result-text"></p>
        <div class="ms-buttons">
          <button type="button" class="ms-btn ms-again">もう一度測る</button>
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

    root.querySelector('.ms-again').addEventListener('click', () => {
      points = [];
      refresh();
    });
    root.querySelector('.ms-close').addEventListener('click', () => stop());

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', position);
    window.addEventListener('orientationchange', position);
    position();
  }

  function destroy() {
    if (!root) return;
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', position);
    window.removeEventListener('orientationchange', position);
    root.remove();
    root = null;
    svg = null;
    線 = null;
    丸たち = [];
    ラベル = null;
    案内 = null;
    結果 = null;
    結果の文字 = null;
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
        `<span class="ms-sub">合わせた先：${points[0].kind || '—'} → ${points[1].kind || '—'}</span>`;
      結果.hidden = false;
      案内.hidden = true;
    } else {
      線.hidden = true;
      ラベル.hidden = true;
      結果.hidden = true;
      案内.hidden = false;
      案内.innerHTML =
        points.length === 0
          ? '測りたいところを2つタップしてください<br>' +
            '<span class="ms-guide-sub">線の端・真ん中・円の中心に吸い付きます</span>'
          : 'もう1つタップしてください<br>' +
            `<span class="ms-guide-sub">1つ目は「${points[0].kind || 'そのまま'}」に合わせました。` +
            '2本指で拡大・縮小しても、印はそのままです</span>';
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      points = [];
      build();
      refresh();
    },
    stop() {
      if (!active) return;
      active = false;
      points = [];
      destroy();
      handlers.onExit && handlers.onExit();
    },
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
