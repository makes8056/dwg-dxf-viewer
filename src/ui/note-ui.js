// note-ui.js — 「文字を書く」画面（開発ルール43章・44章）
//
// 【この係の役目】
//   注記を置く・つまんで動かす・書き直す・消すための画面を出す。
//   注記そのものの決まりは src/notes.js、描くのは render.js の仕事（2.2・2.4）。
//
// 【測る画面（measure-ui.js）と同じ作りにしている】
//   板をかぶせない。指は canvas に素通しさせ、拡大縮小・移動は今までどおり効かせる。
//   受け取るのは**ボタンと、注記の取っ手だけ**。
//   取っ手の上で2本指を始められたら、つまむのをやめて拡大縮小に譲る（42.3）。
//
// 【文字そのものは、この画面では描かない】
//   注記は drawing.entities に text として入っているので、
//   render.js がふつうの文字として描く。画面も紙もPDFも同じ道を通る（43.1）。
//   ここが出すのは「つまむための小さな取っ手」だけである。

import {
  NOTE_COLORS,
  ROTATION_STEP,
  MAX_NOTE_LINES,
  MAX_LINE_LENGTH,
  DEFAULT_COLOR_KEY,
  MIN_NOTE_HEIGHT,
  MAX_NOTE_HEIGHT,
  normalizeNoteText,
  normalizeRotation,
  parseNoteHeight,
} from '../notes.js';

/**
 * 「文字を書く」画面を用意する。
 *
 * @param {HTMLElement} canvasEl 図面を描いているキャンバス
 * @param {object} handlers
 *   toScreen(x, y)  … 図面の座標 → キャンバス基準の画面座標
 *   getNotes()      … 今の注記の一覧
 *   onCreate(x, y, 中身)      … 新しく置いた
 *   onMove(noteId, sx, sy)   … つまみを動かした（キャンバス基準の画面座標）
 *   onEdit(noteId, 中身)      … 書き直した（中身.text が空なら消す）
 *   onDelete(noteId)         … 消した
 *   onExit()                 … 「終わる」で抜けた
 *
 *   中身 = { text, colorKey, height, rotation, sizeChanged }
 *   defaultHeight()  … 大きさをまだ決めていないときの初期値（図面のミリ）
 */
export function createNoteUi(canvasEl, handlers = {}) {
  let active = false;

  let root = null;
  let 案内 = null;
  let 取っ手たち = new Map(); // noteId → 要素
  let 取っ手の入れ物 = null;
  let 終わる = null;
  let 大きさの見張り = null;

  // 文字を入れる窓
  let 窓 = null;
  let 入力欄 = null;
  let 窓の見出し = null;
  let 消すボタン = null;
  let 向きの表示 = null;
  /** 今その窓で編集している相手。{ mode:'新規', x, y } か { mode:'書き直し', noteId } */
  let 編集中 = null;
  /** 窓で選んでいる中身 */
  let 選んだ色 = DEFAULT_COLOR_KEY;
  /**
   * 選んでいる大きさ（図面のミリ）。まだ一度も決めていなければ null（49章）。
   * 続けて書くときは前の値を引き継ぐので、毎回入れ直さなくてよい。
   */
  let 選んだ高さ = null;
  let 選んだ向き = 0;
  /** 大きさを触ったか。触っていなければ、書き直しても大きさを変えない（44.2） */
  let 大きさを触った = false;
  let 大きさ欄 = null;
  let 大きさの注意 = null;

  function 色の選び(c) {
    return (
      `<button type="button" class="nt-chip nt-color" data-color="${c.key}" ` +
      `style="background:${c.css}" aria-label="${c.key}"></button>`
    );
  }


  function build() {
    root = document.createElement('div');
    root.className = 'nt-root';
    root.innerHTML = `
      <div class="nt-handles"></div>
      <p class="nt-guide"></p>
      <div class="nt-bar">
        <button type="button" class="nt-btn nt-close">終わる</button>
      </div>
      <div class="nt-dialog" hidden>
        <div class="nt-dialog-box" role="dialog" aria-modal="true" aria-label="文字を書く">
          <p class="nt-dialog-title">文字を書く</p>
          <textarea class="nt-input" rows="3" autocomplete="off"
                    placeholder="例：ここ既設と接続&#10;（改行できます）"></textarea>
          <p class="nt-hint">改行は${MAX_NOTE_LINES}行まで。1行${MAX_LINE_LENGTH}文字まで</p>

          <div class="nt-row">
            <span class="nt-row-label">色</span>
            <div class="nt-choices">${NOTE_COLORS.map(色の選び).join('')}</div>
          </div>

          <div class="nt-row">
            <span class="nt-row-label">大きさ</span>
            <div class="nt-choices">
              <input type="text" class="nt-size-input" inputmode="decimal"
                     autocomplete="off" aria-label="文字の大きさ（図面のミリ）">
              <span class="nt-unit">ミリ（図面の寸法と同じものさし）</span>
            </div>
          </div>
          <p class="nt-size-warn" hidden></p>

          <div class="nt-row">
            <span class="nt-row-label">向き</span>
            <div class="nt-choices">
              <button type="button" class="nt-chip nt-rot-left" aria-label="左にまわす">◀</button>
              <span class="nt-rot-now">0°</span>
              <button type="button" class="nt-chip nt-rot-right" aria-label="右にまわす">▶</button>
              <button type="button" class="nt-chip nt-rot-reset">まっすぐ</button>
            </div>
          </div>

          <div class="nt-dialog-buttons">
            <button type="button" class="nt-btn nt-cancel">やめる</button>
            <button type="button" class="nt-btn nt-delete" hidden>消す</button>
            <button type="button" class="nt-btn nt-ok">決定</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);

    取っ手の入れ物 = root.querySelector('.nt-handles');
    案内 = root.querySelector('.nt-guide');
    終わる = root.querySelector('.nt-close');
    窓 = root.querySelector('.nt-dialog');
    入力欄 = root.querySelector('.nt-input');
    窓の見出し = root.querySelector('.nt-dialog-title');
    消すボタン = root.querySelector('.nt-delete');
    向きの表示 = root.querySelector('.nt-rot-now');
    大きさ欄 = root.querySelector('.nt-size-input');
    大きさの注意 = root.querySelector('.nt-size-warn');

    終わる.addEventListener('click', () => stop());
    root.querySelector('.nt-ok').addEventListener('click', 決定);
    root.querySelector('.nt-cancel').addEventListener('click', 窓を閉じる);
    消すボタン.addEventListener('click', 消す);

    for (const b of root.querySelectorAll('.nt-color')) {
      b.addEventListener('click', () => {
        選んだ色 = b.dataset.color;
        選び直しを見せる();
      });
    }
    大きさ欄.addEventListener('input', () => {
      大きさを触った = true;
      大きさの注意を出す();
    });
    root.querySelector('.nt-rot-left').addEventListener('click', () => {
      選んだ向き = normalizeRotation(選んだ向き + ROTATION_STEP);
      選び直しを見せる();
    });
    root.querySelector('.nt-rot-right').addEventListener('click', () => {
      選んだ向き = normalizeRotation(選んだ向き - ROTATION_STEP);
      選び直しを見せる();
    });
    root.querySelector('.nt-rot-reset').addEventListener('click', () => {
      選んだ向き = 0;
      選び直しを見せる();
    });

    // 【改行できるようにしたので、Enterで決定しない（開発ルール44.3）】
    // 以前は Enter で決定していた。改行を入れられるようにした以上、
    // Enter は改行のためのものである。両方に使うと、どちらも思いどおりにならない。
    // 決定は「決定」ボタンだけで行う。

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', position);
    window.addEventListener('orientationchange', position);

    // 向きを変えた直後は、合図が届いた時点でキャンバスがまだ古い大きさのことがある。
    // 合図を待たず、大きさそのものを見張る（開発ルール42.5）。
    if (typeof ResizeObserver === 'function') {
      大きさの見張り = new ResizeObserver(() => {
        requestAnimationFrame(position);
      });
      大きさの見張り.observe(canvasEl);
    }

    position();
  }

  function stop() {
    if (!active) return;
    active = false;
    destroy();
    handlers.onExit && handlers.onExit();
  }

  function destroy() {
    if (!root) return;
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
    案内 = null;
    取っ手の入れ物 = null;
    取っ手たち = new Map();
    終わる = null;
    窓 = null;
    入力欄 = null;
    窓の見出し = null;
    消すボタン = null;
    向きの表示 = null;
    編集中 = null;
  }

  function onKeyDown(ev) {
    if (ev.key !== 'Escape') return;
    // 窓が開いていれば、まず窓だけ閉じる（いきなりモードごと抜けない）
    if (窓 && !窓.hidden) 窓を閉じる();
    else stop();
  }

  /** キャンバスの位置・大きさに合わせる。 */
  function position() {
    if (!root) return;
    const r = canvasEl.getBoundingClientRect();
    root.style.left = `${r.left}px`;
    root.style.top = `${r.top}px`;
    root.style.width = `${r.width}px`;
    root.style.height = `${r.height}px`;
  }

  // ------------------------------------------------------------
  // つまんで動かす（開発ルール42.3 と同じ作り）
  // ------------------------------------------------------------

  let つまみ中 = null; // { noteId, pointerId }

  function つまむ(ev, noteId) {
    if (つまみ中) return;
    if (ev.button !== undefined && ev.button > 0) return;
    ev.preventDefault();
    ev.stopPropagation(); // ここで止めないと図面まで動く

    つまみ中 = { noteId, pointerId: ev.pointerId };
    const el = 取っ手たち.get(noteId);
    if (el) {
      el.classList.add('nt-handle-tsumami');
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (e) {
        // 捕まえられなくても、下の見張りで動きは追える
      }
    }
    window.addEventListener('pointerdown', 二本目が来た, true);
  }

  function 二本目が来た(ev) {
    if (!つまみ中 || ev.pointerId === つまみ中.pointerId) return;
    // 拡大縮小をしようとしている。つまむのをやめて指を図面に返す
    はなす();
  }

  function 動かす(ev) {
    if (!つまみ中 || ev.pointerId !== つまみ中.pointerId) return;
    ev.preventDefault();
    if (!handlers.onMove) return;
    const r = canvasEl.getBoundingClientRect();
    handlers.onMove(つまみ中.noteId, ev.clientX - r.left, ev.clientY - r.top);
  }

  function はなす() {
    if (!つまみ中) return;
    const el = 取っ手たち.get(つまみ中.noteId);
    if (el) {
      el.classList.remove('nt-handle-tsumami');
      try {
        el.releasePointerCapture(つまみ中.pointerId);
      } catch (e) {
        // すでに離れている
      }
    }
    つまみ中 = null;
    window.removeEventListener('pointerdown', 二本目が来た, true);
  }

  // ------------------------------------------------------------
  // 文字を入れる窓
  // ------------------------------------------------------------

  /** 今どれを選んでいるかを、見て分かるようにする。 */
  function 選び直しを見せる() {
    if (!root) return;
    for (const b of root.querySelectorAll('.nt-color')) {
      b.classList.toggle('nt-chip-on', b.dataset.color === 選んだ色);
    }
    向きの表示.textContent = `${選んだ向き}°`;
    大きさの注意を出す();
  }

  /**
   * 大きさの数字がおかしいときに、その場で知らせる（49章）。
   *
   * 黙って別の値に直してしまうと、**入れたはずの大きさと違うものが出て**
   * なぜそうなったのか分からない。決定を押す前に理由を出す。
   */
  function 大きさの注意を出す() {
    if (!大きさ欄 || !大きさの注意) return;
    const 生 = 大きさ欄.value;
    if (String(生).trim() === '') {
      大きさの注意.hidden = true;
      return;
    }
    const 高さ = parseNoteHeight(生);
    if (高さ === null) {
      大きさの注意.textContent =
        `大きさは ${MIN_NOTE_HEIGHT} 〜 ${MAX_NOTE_HEIGHT} ミリの数字で入れてください`;
      大きさの注意.hidden = false;
      return;
    }
    大きさの注意.hidden = true;
  }

  function 窓を開く(中身) {
    編集中 = 中身;
    const 書き直し = 中身.mode === '書き直し';
    窓の見出し.textContent = 書き直し ? '文字を書き直す' : '文字を書く';
    入力欄.value = 書き直し ? String(中身.text || '') : '';
    消すボタン.hidden = !書き直し;

    // 書き直しのときは今の設定を出す。新しく置くときは、前に選んだものを引き継ぐ
    // （同じ色・同じ大きさで続けて書くことが多いため）
    if (書き直し) {
      選んだ色 = 中身.colorKey || DEFAULT_COLOR_KEY;
      選んだ高さ = parseNoteHeight(中身.height);
      選んだ向き = normalizeRotation(中身.rotation);
    } else if (選んだ高さ === null) {
      // まだ一度も決めていないときだけ、今の拡大率から出した値を入れておく（49章）。
      // 2つめからは前の値を引き継ぐので、続けて書くときに入れ直さなくてよい。
      選んだ高さ = (handlers.defaultHeight && handlers.defaultHeight()) || 1;
    }
    大きさ欄.value = 選んだ高さ === null ? '' : String(選んだ高さ);
    大きさを触った = false;
    選び直しを見せる();

    窓.hidden = false;
    // iPadでキーボードを出すため、少し待ってから焦点を当てる
    setTimeout(() => {
      try {
        入力欄.focus();
        入力欄.select();
      } catch (e) {
        // 焦点が当たらなくても、指で触れば入力できる
      }
    }, 30);
  }

  function 窓を閉じる() {
    編集中 = null;
    if (窓) 窓.hidden = true;
    if (入力欄) 入力欄.value = '';
  }

  function 決定() {
    if (!編集中) return;
    const 文字 = normalizeNoteText(入力欄.value);
    const いま = 編集中;
    // 【おかしい数字のまま決定させない（49章）】
    // 黙って前の大きさで置くと、入れたはずの数と違うものが出て、理由が分からない。
    const 入れた高さ = parseNoteHeight(大きさ欄.value);
    if (入れた高さ === null) {
      大きさの注意を出す();
      try {
        大きさ欄.focus();
        大きさ欄.select();
      } catch (e) {
        // 焦点が当たらなくても、注意書きは出ている
      }
      return; // 窓は閉じない。直してもらう
    }
    選んだ高さ = 入れた高さ;

    const 選び = {
      text: 文字,
      colorKey: 選んだ色,
      height: 選んだ高さ,
      rotation: 選んだ向き,
      sizeChanged: 大きさを触った,
    };
    窓を閉じる();

    if (いま.mode === '書き直し') {
      handlers.onEdit && handlers.onEdit(いま.noteId, 選び);
      return;
    }
    // 新しく置く。空のまま決定を押したときは、何も置かない
    if (!文字) return;
    handlers.onCreate && handlers.onCreate(いま.x, いま.y, 選び);
  }

  function 消す() {
    if (!編集中 || 編集中.mode !== '書き直し') return;
    const id = 編集中.noteId;
    窓を閉じる();
    handlers.onDelete && handlers.onDelete(id);
  }

  /** 書き直しの窓を出す（取っ手を押したときと、文字の上をタップしたとき）。 */
  function 書き直しを開く(note) {
    if (!note) return;
    窓を開く({
      mode: '書き直し',
      noteId: note.id,
      text: note.text,
      colorKey: note.colorKey,
      height: note.height,
      rotation: note.rotation,
    });
  }

  // ------------------------------------------------------------
  // 取っ手を置き直す
  // ------------------------------------------------------------

  function refresh() {
    if (!active || !root) return;
    position();

    const notes = handlers.getNotes ? handlers.getNotes() : [];
    const 残す = new Set();

    for (const n of notes) {
      残す.add(n.id);
      let el = 取っ手たち.get(n.id);
      if (!el) {
        el = document.createElement('span');
        el.className = 'nt-handle';
        el.dataset.noteId = n.id;
        el.addEventListener('pointerdown', (ev) => つまむ(ev, n.id));
        el.addEventListener('pointermove', 動かす);
        el.addEventListener('pointerup', はなす);
        el.addEventListener('pointercancel', はなす);
        // 押しただけ（動かさなかった）なら、書き直しの窓を出す
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const いま = (handlers.getNotes ? handlers.getNotes() : []).find((x) => x.id === n.id);
          書き直しを開く(いま);
        });
        取っ手の入れ物.appendChild(el);
        取っ手たち.set(n.id, el);
      }
      // 取っ手の色を、その注記の色に合わせる（どれがどれか、見て分かるように）
      el.style.borderColor = handlers.colorOf ? handlers.colorOf(n) : '#c81e1e';
      const [sx, sy] = handlers.toScreen ? handlers.toScreen(n.x, n.y) : [0, 0];
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
    }

    // 消された注記の取っ手を片付ける
    for (const [id, el] of 取っ手たち) {
      if (残す.has(id)) continue;
      el.remove();
      取っ手たち.delete(id);
    }

    案内.innerHTML =
      notes.length === 0
        ? '文字を書きたいところをタップしてください<br>' +
          '<span class="nt-guide-sub">色・大きさ・向きを選べます。書いた文字は印刷とPDFにも出ます</span>'
        : '文字を書きたいところをタップしてください<br>' +
          `<span class="nt-guide-sub">今 ${notes.length} 個。` +
          '取っ手をつまむと動かせます。押すと書き直し・削除ができます</span>';
  }

  return {
    start() {
      if (active) return;
      active = true;
      build();
      refresh();
    },
    stop,
    isActive: () => active,
    /**
     * 図面の上をタップされた（図面の座標）。
     * すでに文字があるところなら、重ねずに書き直しにする（44.4）。
     */
    tapAt(x, y, あった注記) {
      if (!active) return;
      if (窓 && !窓.hidden) return; // 窓が開いている間は置かない
      if (あった注記) 書き直しを開く(あった注記);
      else 窓を開く({ mode: '新規', x, y });
    },
    /** 窓が開いているか（図面のタップを受けてよいかの判断に使う）。 */
    isDialogOpen: () => Boolean(窓 && !窓.hidden),
    refresh,
  };
}
