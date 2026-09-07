// notes.js — 図面に書き足した文字（注記）の中身だけ（開発ルール43章）
//
// 【この係の役目】
//   注記の作り方・動かし方・書き直し方・消し方を決める。
//   画面には一切触らない（見た目は src/ui/note-ui.js の役目。開発ルール2.2）。
//
// 【なぜ「文字（text）」として持つのか】
//   このアプリは text という図形をすでに描ける。画面も、印刷の絵も、PDFもである。
//   注記を新しい種類にすると、その3つすべてに描き方を足すことになり、
//   どれか1つを忘れれば「画面には出るのに紙に出ない」といった食い違いが起きる。
//   すでに通っている道に乗せるのが、いちばん確実である。
//
// 【元の図面には混ぜない】
//   注記は drawing.entities に足すが、必ず isNote の印を付ける。
//   印が無いと、保存するときに図面の文字と見分けが付かなくなる。
//
// 【注記は「覚える対象」である（ユーザー判断）】
//   図面のファイル自体には書き戻さない（お客様のファイルを書き換えない）。
//   端末の中に、図面と別に覚えておく（src/storage.js）。

/** 注記を置くレイヤーの名前。図面のレイヤーとぶつからないようにする。 */
export const NOTE_LAYER = '__書き足した文字__';

/** 注記の色。白黒のプリンターでも濃い灰色になって読める赤にする。 */
export const NOTE_COLOR = '#c81e1e';

/**
 * 注記の文字の大きさ（画面のピクセル）。
 *
 * 【なぜ画面の大きさで決めるのか】
 * 図面の単位（ミリ）で決め打ちすると、図面の縮尺によって
 * 極端に大きくなったり小さくなったりする。
 * 「置いたときに見えている大きさ」で決めれば、置いた本人の感覚と合う。
 * 実際に図面へ書き込むときは、今の拡大率で割って図面の単位に直す。
 */
export const NOTE_HEIGHT_PX = 20;

/** 1つの注記に入れられる文字数。長すぎる文字は紙からはみ出すので止める。 */
export const MAX_NOTE_LENGTH = 60;

let 連番 = 0;

/** 注記に付ける名札を作る。消したり書き直したりするときに、これで見分ける。 */
export function makeNoteId() {
  連番 += 1;
  return `note-${Date.now().toString(36)}-${連番}`;
}

/**
 * 注記を1つ作る。
 *
 * @param {object} 中身 { x, y, text, height }（図面の座標）
 * @returns {object|null} 図形（text）の形。文字が空なら null
 */
export function createNote({ x, y, text, height, id } = {}) {
  const 文字 = normalizeNoteText(text);
  if (!文字) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const h = Number.isFinite(height) && height > 0 ? height : 1;

  return {
    type: 'text',
    layer: NOTE_LAYER,
    color: NOTE_COLOR,
    x,
    y,
    height: h,
    rotation: 0,
    text: 文字,
    hAlign: 'left',
    // 【'baseline' と書かない】Canvas に無い名前を渡すとブラウザは黙って無視し、
    // 直前の文字の縦位置が残って文字がずれる（render.js の toCanvasBaseline 参照）。
    vAlign: 'alphabetic',
    isNote: true,
    noteId: id || makeNoteId(),
  };
}

/**
 * 入れられた文字を整える。
 *
 * 改行やタブは1行の文字として描けないので空白に直す。
 * 長すぎるものは切る（紙からはみ出す）。
 */
export function normalizeNoteText(text) {
  if (text == null) return '';
  const 一行 = String(text).replace(/[\r\n\t]+/g, ' ').trim();
  if (!一行) return '';
  return 一行.slice(0, MAX_NOTE_LENGTH);
}

/**
 * 置いたときに見えている大きさから、図面の単位での文字の高さを出す。
 * @param {number} scale 今の拡大率（viewport の scale）
 */
export function noteHeightForScale(scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return NOTE_HEIGHT_PX / s;
}

/** その図形は、書き足した注記か。 */
export function isNote(e) {
  return Boolean(e && e.isNote);
}

/** 図面に入っている注記だけを取り出す。 */
export function listNotes(drawing) {
  if (!drawing || !Array.isArray(drawing.entities)) return [];
  return drawing.entities.filter(isNote);
}

/**
 * 注記を図面に足す。**元の配列を書き換える**（同じ図面を画面でも使っているため）。
 * @returns {object|null} 足した注記
 */
export function addNote(drawing, note) {
  if (!drawing || !Array.isArray(drawing.entities) || !note) return null;
  drawing.entities.push(note);
  return note;
}

/** 名札で注記を探す。 */
export function findNote(drawing, noteId) {
  if (!noteId) return null;
  return listNotes(drawing).find((n) => n.noteId === noteId) || null;
}

/**
 * 注記を動かす。
 * @returns {boolean} 動かせたか
 */
export function moveNote(drawing, noteId, x, y) {
  const n = findNote(drawing, noteId);
  if (!n || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  n.x = x;
  n.y = y;
  return true;
}

/**
 * 注記を書き直す。空にしたときは**消す**（空の文字を残しても読めないため）。
 * @returns {'書き直した'|'消した'|'見つからない'}
 */
export function editNote(drawing, noteId, text) {
  const n = findNote(drawing, noteId);
  if (!n) return '見つからない';
  const 文字 = normalizeNoteText(text);
  if (!文字) {
    deleteNote(drawing, noteId);
    return '消した';
  }
  n.text = 文字;
  return '書き直した';
}

/**
 * 注記を消す。
 * @returns {boolean} 消せたか
 */
export function deleteNote(drawing, noteId) {
  if (!drawing || !Array.isArray(drawing.entities) || !noteId) return false;
  const i = drawing.entities.findIndex((e) => isNote(e) && e.noteId === noteId);
  if (i < 0) return false;
  drawing.entities.splice(i, 1);
  return true;
}

// ------------------------------------------------------------
// 覚えておくための形（src/storage.js に渡す）
//
// 図形そのままではなく、**必要な値だけ**にして覚える。
// 色や配置の決まりをあとで変えたときに、覚えてある古い値に引きずられないため。
// ------------------------------------------------------------

/** 覚えるための形にする。 */
export function notesToStore(drawing) {
  return listNotes(drawing).map((n) => ({
    id: n.noteId,
    x: n.x,
    y: n.y,
    height: n.height,
    text: n.text,
  }));
}

/**
 * 覚えてあったものを、図面に戻す。**元の配列を書き換える**。
 *
 * 壊れた値は黙って捨てる。1件おかしいだけで図面が開かなくなるほうが困る。
 * @returns {number} 戻せた件数
 */
export function restoreNotes(drawing, stored) {
  if (!drawing || !Array.isArray(drawing.entities) || !Array.isArray(stored)) return 0;
  let 戻した = 0;
  for (const s of stored) {
    if (!s) continue;
    const note = createNote({ x: s.x, y: s.y, text: s.text, height: s.height, id: s.id });
    if (!note) continue;
    drawing.entities.push(note);
    戻した += 1;
  }
  return 戻した;
}

/**
 * タップした場所にいちばん近い注記を探す。
 *
 * 文字の当たり判定は、書き出す点から**右上に広がる四角**とみなす
 * （hAlign が左・vAlign が下 なので、文字はそこから右上へ伸びる）。
 * 指のブレを見込んで、まわりに余裕を足す。
 *
 * @param {object} drawing
 * @param {number} x タップした場所（図面の座標）
 * @param {number} y
 * @param {number} 余裕 図面の座標での余裕（画面のピクセルを拡大率で割ったもの）
 * @returns {object|null}
 */
export function findNoteAt(drawing, x, y, 余裕 = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const m = Number.isFinite(余裕) && 余裕 > 0 ? 余裕 : 0;

  let best = null;
  let bestD2 = Infinity;
  for (const n of listNotes(drawing)) {
    const h = Math.abs(n.height || 0);
    // 文字の幅は正確には測れないので、1文字あたり高さの0.9倍で見積もる（日本語は正方形に近い）
    const w = h * 0.9 * Math.max(1, String(n.text || '').length);
    const 左 = n.x - m;
    const 右 = n.x + w + m;
    const 下 = n.y - h * 0.3 - m; // 文字は書き出す点より少し下にも出る
    const 上 = n.y + h + m;
    if (x < 左 || x > 右 || y < 下 || y > 上) continue;

    // 重なっているときは、書き出す点がいちばん近いものを選ぶ
    const d2 = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best;
}
