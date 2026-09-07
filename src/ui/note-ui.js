// note-ui.js — 「文字を書く」画面（開発ルール43章）
//
// 【この係の役目】
//   注記を置く・つまんで動かす・書き直す・消すための画面を出す。
//   注記そのものの決まりは src/notes.js、描くのは render.js の仕事（2.2・2.4）。
//
// 【測る画面（measure-ui.js）と同じ作りにしている】
//   板をかぶせない。指は canvas に素通しさせ、拡大縮小・移動は今までどおり効かせる。
//   受け取るのは**ボタンと、注記のつまみだけ**。
//   つまみの上で2本指を始められたら、つまむのをやめて拡大縮小に譲る（42.3）。
//
// 【文字そのものは、この画面では描かない】
//   注記は drawing.entities に text として入っているので、
//   render.js がふつうの文字として描く。画面も紙もPDFも同じ道を通る（43.1）。
//   ここが出すのは「つまむための小さな取っ手」だけである。

import { MAX_NOTE_LENGTH, normalizeNoteText } from '../notes.js';

/**
 * 「文字を書く」画面を用意する。
 *
 * @param {HTMLElement} canvasEl 図面を描いているキャンバス
 * @param {object} handlers
 *   toScreen(x, y)        … 図面の座標 → キャンバス基準の画面座標
 *   getNotes()            … 今の注記の一覧（図形の形）
 *   onMove(noteId, sx, sy)… つまみを動かした（キャンバス基準の画面座標）
 *   onEdit(noteId, text)  … 書き直した（空文字なら消す）
 *   onDelete(noteId)      … 消した
 *   onExit()              … 「終わる」で抜けた
 */
export function createNoteUi(canvasEl, handlers = {}) {
  let active = false;

  let root = null;
  let 案内 = null;
  let 取っ手たち = new Map(); // noteId → 要素
  let 取っ手の入れ物 = null;
  let 終わる = null;
  let 大きさの見張り = null;

  // 文字を入れる小さな窓
  let 窓 = null;
  let 入力欄 = null;
  let 窓の見出し = null;
  let 消すボタン = null;
  /** 今その窓で編集している相手。{ mode:'新規', x, y } か { mode:'書き直し', noteId } */
  let 編集中 = null;

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
          <input class="nt-input" type="text" maxlength="${MAX_NOTE_LENGTH}"
                 inputmode="text" autocomplete="off" placeholder="例：ここ既設と接続">
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

    終わる.addEventListener('click', () => stop());
    root.querySelector('.nt-ok').addEventListener('click', 決定);
    root.querySelector('.nt-cancel').addEventListener('click', 窓を閉じる);
    消すボタン.addEventListener('click', 消す);

    // 【Enterで決定できるようにする】iPadのキーボードの「改行」で確定したい
    //
    // 【ただし、日本語の変換中は横取りしない（開発ルール43.6）】
    // 「せつぞく」と打って変換している最中のEnterは、**変換を確定するためのEnter**である。
    // ここで横取りすると、変換が終わる前に窓が閉じ、
    // ひらがなのまま書き込まれる。日本語で使うアプリでは必ず踏む。
    //   isComposing … 変換中かどうか（今どきのブラウザ）
    //   keyCode 229 … 同じことを表す古い言い方。iPadの古い版のために残す
    入力欄.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      if (ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      決定();
    });

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

  function 窓を開く(中身) {
    編集中 = 中身;
    const 書き直し = 中身.mode === '書き直し';
    窓の見出し.textContent = 書き直し ? '文字を書き直す' : '文字を書く';
    入力欄.value = 書き直し ? String(中身.text || '') : '';
    消すボタン.hidden = !書き直し;
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
    窓を閉じる();

    if (いま.mode === '書き直し') {
      handlers.onEdit && handlers.onEdit(いま.noteId, 文字);
      return;
    }
    // 新しく置く。空のまま決定を押したときは、何も置かない
    if (!文字) return;
    handlers.onCreate && handlers.onCreate(いま.x, いま.y, 文字);
  }

  function 消す() {
    if (!編集中 || 編集中.mode !== '書き直し') return;
    const id = 編集中.noteId;
    窓を閉じる();
    handlers.onDelete && handlers.onDelete(id);
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
      残す.add(n.noteId);
      let el = 取っ手たち.get(n.noteId);
      if (!el) {
        el = document.createElement('span');
        el.className = 'nt-handle';
        el.dataset.noteId = n.noteId;
        el.addEventListener('pointerdown', (ev) => つまむ(ev, n.noteId));
        el.addEventListener('pointermove', 動かす);
        el.addEventListener('pointerup', はなす);
        el.addEventListener('pointercancel', はなす);
        // 押しただけ（動かさなかった）なら、書き直しの窓を出す
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const いま = (handlers.getNotes ? handlers.getNotes() : []).find(
            (x) => x.noteId === n.noteId
          );
          if (いま) 窓を開く({ mode: '書き直し', noteId: n.noteId, text: いま.text });
        });
        取っ手の入れ物.appendChild(el);
        取っ手たち.set(n.noteId, el);
      }
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
          '<span class="nt-guide-sub">書いた文字は、印刷とPDFにも出ます</span>'
        : '文字を書きたいところをタップしてください<br>' +
          `<span class="nt-guide-sub">今 ${notes.length} 個。` +
          '赤い取っ手をつまむと動かせます。押すと書き直し・削除ができます</span>';
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
    /** 図面の上をタップされた（キャンバス基準の画面座標ではなく、図面の座標）。 */
    tapAt(x, y) {
      if (!active) return;
      if (窓 && !窓.hidden) return; // 窓が開いている間は置かない
      窓を開く({ mode: '新規', x, y });
    },
    /** 押されただけの注記を、書き直しの窓に出す。 */
    editNote(noteId, text) {
      if (!active) return;
      窓を開く({ mode: '書き直し', noteId, text });
    },
    /** 窓が開いているか（図面のタップを受けてよいかの判断に使う）。 */
    isDialogOpen: () => Boolean(窓 && !窓.hidden),
    refresh,
  };
}
