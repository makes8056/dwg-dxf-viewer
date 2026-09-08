// notes.js — 図面に書き足した文字（注記）の中身だけ（開発ルール43章・44章）
//
// 【この係の役目】
//   注記の作り方・動かし方・書き直し方・消し方を決める。
//   画面には一切触らない（見た目は src/ui/note-ui.js の役目。開発ルール2.2）。
//
// 【本体は drawing.notes。図形はそこから作り直す（44.1）】
//   注記そのものは drawing.notes に1件ずつ持つ（色・大きさ・向き・文字）。
//   描くための図形（text）は、そこから **作り直す**（syncNoteEntities）。
//
//   こうする理由は「改行」である。
//   1つの注記が2行なら、text の図形は2つ要る。
//   図形の側を本体にすると、1つの注記が図形2つに散らばり、
//   動かす・消すのたびに「どれとどれが仲間か」を数えることになる。
//   本体を1つにしておけば、散らばるのは作り直すときだけで済む。
//
// 【なぜ「文字（text）」の図形にするのか（43.1）】
//   このアプリは text をすでに描ける。画面も、印刷の絵も、PDFもである。
//   回転も3つとも対応済みだった。
//   新しい種類を作ると、その3つすべてに描き方を足すことになり、
//   どれか1つを忘れれば「画面には出るのに紙に出ない」が起きる。
//
// 【元の図面には混ぜない】
//   作った図形には必ず isNote の印を付ける。
//   印が無いと、作り直すときに図面のもとの文字まで消してしまう。
//
// 【注記は「覚える対象」である（ユーザー判断）】
//   図面のファイル自体には書き戻さない（お客様のファイルを書き換えない）。
//   端末の中に、図面と別に覚えておく（src/storage.js）。

/** 注記を置くレイヤーの名前。図面のレイヤーとぶつからないようにする。 */
export const NOTE_LAYER = '__書き足した文字__';

/**
 * 選べる色（開発ルール44.2）。
 *
 * 【多くしない】ユーザーの指示。現場で迷わない数にする。
 * 白黒のプリンターで刷られることを考えて、**薄い色は入れない**。
 * どれも灰色に変わったときに読める濃さにしてある。
 */
export const NOTE_COLORS = [
  { key: '赤', css: '#c81e1e' },
  { key: '黒', css: '#111111' },
  { key: '青', css: '#1546a0' },
  { key: '緑', css: '#1b6b2f' },
  { key: 'だいだい', css: '#c25a12' },
];

export const DEFAULT_COLOR_KEY = '赤';

/**
 * 文字の大きさは「図面のミリ」で持つ（開発ルール49章。2026-09-08 ユーザーの指示）。
 *
 * もとは「小・中・大」の3段階で、画面で何ピクセルに見えるかで決めていた（43.2）。
 * ユーザーから「大中小ではなく数字で指定したい」と言われ、**図面のミリ**に変えた。
 *
 * 【なぜ画面のピクセルではなく、図面のミリにしたか（ユーザーが選んだ）】
 *   図面にもとからある寸法文字と**同じものさしで揃えられる**。
 *   実物の図面では、寸法文字が 35 や 100 というミリの値で書かれていた。
 *   拡大縮小しても大きさが変わらないので、あとから見ても迷わない。
 *
 * 【下限・上限を置く理由】
 *   0や負の数、けた違いの数を入れられると、文字が消えたり画面を埋め尽くしたりする。
 */
export const MIN_NOTE_HEIGHT = 0.01;
export const MAX_NOTE_HEIGHT = 100000;

/** 大きさを決めていないとき、画面でこれくらいに見える値を最初に出す。 */
const DEFAULT_NOTE_PX = 20;

/** 向きを変えるきざみ（度）。ユーザーの指示で15度。 */
export const ROTATION_STEP = 15;

/** 行と行のあいだ。文字の高さの何倍あけるか。 */
export const LINE_GAP = 1.5;

/** 1つの注記に入れられる行数と、1行の文字数。長すぎると紙からはみ出す。 */
export const MAX_NOTE_LINES = 6;
export const MAX_LINE_LENGTH = 40;

let 連番 = 0;

/** 注記に付ける名札を作る。消したり書き直したりするときに、これで見分ける。 */
export function makeNoteId() {
  連番 += 1;
  return `note-${Date.now().toString(36)}-${連番}`;
}

/** 色の名前から、実際の色を引く。知らない名前なら赤にする。 */
export function colorCssFor(key) {
  const found = NOTE_COLORS.find((c) => c.key === key);
  return (found || NOTE_COLORS[0]).css;
}

/**
 * 入れられた大きさ（図面のミリ）を確かめる。
 *
 * 【全角の数字も受ける】iPadの日本語キーボードでは、うっかり「３．５」と
 * 全角で入ってしまうことがある。そこで弾くと、**なぜ入らないのか分からない。**
 * 半角に直してから読む。
 *
 * @param {string|number} value
 * @returns {number|null} 使える大きさ。数でない・範囲の外なら null
 */
export function parseNoteHeight(value) {
  if (value === null || value === undefined) return null;
  const 半角 = String(value)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[，,\s]/g, '')
    .trim();
  if (半角 === '') return null;
  const v = Number(半角);
  if (!Number.isFinite(v)) return null;
  // 0以下も、けた違いも、下限と上限の1か所でまとめて弾く。
  // 同じことを2か所で判定すると、片方を直したときにもう片方が取り残される。
  if (v < MIN_NOTE_HEIGHT || v > MAX_NOTE_HEIGHT) return null;
  return v;
}

/**
 * 大きさをまだ決めていないときに、最初に出す値（図面のミリ）。
 *
 * 図面の縮尺はまちまちなので、決め打ちの数を出すと
 * **点のように小さい**か**画面を埋め尽くす**かのどちらかになる。
 * 今見えている拡大率から「画面で20pxに見える大きさ」を求めて出す。
 * そのあとはユーザーが数字を直せばよい。
 */
export function defaultNoteHeight(scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return 読みやすい数にする(DEFAULT_NOTE_PX / s);
}

/**
 * 上から2けたで丸めて、読みやすい数にする（37.4218… → 37、0.0432… → 0.043）。
 * 最初に出す数が「37.42184…」では、直そうという気にならない。
 */
function 読みやすい数にする(v) {
  if (!(v > 0)) return 1;
  const けた = Math.floor(Math.log10(v));
  const きざみ = Math.pow(10, けた - 1);
  const 丸め = Math.round(v / きざみ) * きざみ;
  // 掛け算・割り算で出る小数のごみを落とす（0.30000000000000004 のような値）
  const 出す = Number(丸め.toPrecision(6));
  if (出す < MIN_NOTE_HEIGHT) return MIN_NOTE_HEIGHT;
  if (出す > MAX_NOTE_HEIGHT) return MAX_NOTE_HEIGHT;
  return 出す;
}

/**
 * 入れられた文字を整える。
 *
 * 【改行は残す（44.3）】1行に詰めない。ただし行数と1行の長さには上限を置く。
 * タブは空白に直す（1行の文字として描けないため）。
 */
export function normalizeNoteText(text) {
  if (text == null) return '';
  const 行 = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, '').slice(0, MAX_LINE_LENGTH));

  // 前後のからっぽの行は落とす（間のからっぽの行は、あけたくて入れたものとして残す）
  while (行.length && !行[0].trim()) 行.shift();
  while (行.length && !行[行.length - 1].trim()) 行.pop();

  return 行.slice(0, MAX_NOTE_LINES).join('\n');
}

/** 注記を行ごとに分ける。 */
export function noteLines(text) {
  const t = normalizeNoteText(text);
  return t ? t.split('\n') : [];
}

/** 向きを15度きざみに丸めて、0〜345度におさめる。 */
export function normalizeRotation(deg) {
  const d = Number.isFinite(deg) ? deg : 0;
  const 丸め = Math.round(d / ROTATION_STEP) * ROTATION_STEP;
  return ((丸め % 360) + 360) % 360;
}

/**
 * 注記を1つ作る（図形ではなく、注記そのもの）。
 * @returns {object|null} 文字が空なら null
 */
export function createNote({ x, y, text, height, rotation, colorKey, id } = {}) {
  const 文字 = normalizeNoteText(text);
  if (!文字) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    id: id || makeNoteId(),
    x,
    y,
    text: 文字,
    height: Number.isFinite(height) && height > 0 ? height : 1,
    rotation: normalizeRotation(rotation),
    colorKey: NOTE_COLORS.some((c) => c.key === colorKey) ? colorKey : DEFAULT_COLOR_KEY,
  };
}

/** その図形は、注記から作ったものか。 */
export function isNote(e) {
  return Boolean(e && e.isNote);
}

/** 図面が持っている注記の一覧（本体のほう）。 */
export function listNotes(drawing) {
  if (!drawing || !Array.isArray(drawing.notes)) return [];
  return drawing.notes;
}

/** 注記を入れる場所を用意する（まだ無ければ作る）。 */
function ensureNotes(drawing) {
  if (!drawing) return null;
  if (!Array.isArray(drawing.notes)) drawing.notes = [];
  return drawing.notes;
}

/**
 * 注記から、描くための図形（text）を作り直す（開発ルール44.1）。
 *
 * **1行につき1つの図形**にする。こうすると render.js も print-area.js も
 * print-pdf.js も、ふつうの1行の文字として扱うだけでよく、
 * 改行のために3か所を直さずに済む。
 *
 * 行を下へずらす向きは、注記の向きに合わせて回す。
 * 回さないと、傾けた注記の2行目が明後日の方向へ出る。
 */
export function syncNoteEntities(drawing) {
  if (!drawing || !Array.isArray(drawing.entities)) return 0;

  // 前に作った図形を全部どける。isNote の印だけを頼りにする
  for (let i = drawing.entities.length - 1; i >= 0; i--) {
    if (isNote(drawing.entities[i])) drawing.entities.splice(i, 1);
  }

  let 作った = 0;
  for (const note of listNotes(drawing)) {
    const 行たち = noteLines(note.text);
    if (行たち.length === 0) continue;

    const rad = (note.rotation * Math.PI) / 180;
    // 文字が並ぶ向きは (cos, sin)。行が下がる向きは、それを右へ90度回した (sin, -cos)
    const 下へx = Math.sin(rad);
    const 下へy = -Math.cos(rad);
    const 行間 = note.height * LINE_GAP;
    const css = colorCssFor(note.colorKey);

    行たち.forEach((行, i) => {
      drawing.entities.push({
        type: 'text',
        layer: NOTE_LAYER,
        color: css,
        x: note.x + 下へx * 行間 * i,
        y: note.y + 下へy * 行間 * i,
        height: note.height,
        rotation: note.rotation,
        text: 行,
        hAlign: 'left',
        // 【'baseline' と書かない】Canvas に無い名前を渡すとブラウザは黙って無視し、
        // 直前の文字の縦位置が残って文字がずれる（render.js の toCanvasBaseline 参照）。
        vAlign: 'alphabetic',
        isNote: true,
        noteId: note.id,
        noteLine: i,
      });
      作った += 1;
    });
  }
  return 作った;
}

/**
 * 注記を足す。**元の図面を書き換える**（同じ図面を画面でも使っているため）。
 * @returns {object|null} 足した注記
 */
export function addNote(drawing, note) {
  const list = ensureNotes(drawing);
  if (!list || !note) return null;
  list.push(note);
  syncNoteEntities(drawing);
  return note;
}

/** 名札で注記を探す。 */
export function findNote(drawing, noteId) {
  if (!noteId) return null;
  return listNotes(drawing).find((n) => n.id === noteId) || null;
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
  syncNoteEntities(drawing);
  return true;
}

/**
 * 注記を書き直す。文字・色・大きさ・向きをまとめて直せる。
 *
 * 文字を空にしたときは**消す**（空の文字を残しても読めないため）。
 *
 * @param {object} 変更 { text, colorKey, height, rotation } のうち、変えたいものだけ
 * @returns {'書き直した'|'消した'|'見つからない'}
 */
export function editNote(drawing, noteId, 変更 = {}) {
  const n = findNote(drawing, noteId);
  if (!n) return '見つからない';

  if (変更.text !== undefined) {
    const 文字 = normalizeNoteText(変更.text);
    if (!文字) {
      deleteNote(drawing, noteId);
      return '消した';
    }
    n.text = 文字;
  }
  if (変更.colorKey !== undefined && NOTE_COLORS.some((c) => c.key === 変更.colorKey)) {
    n.colorKey = 変更.colorKey;
  }
  // 大きさを変えたときだけ、図面の単位での高さを計算し直す。
  // 変えていないのに計算し直すと、**書き直しただけで大きさが変わる**
  // （そのときの拡大率が置いたときと違うため）。
  if (Number.isFinite(変更.height) && 変更.height > 0) n.height = 変更.height;
  if (変更.rotation !== undefined) n.rotation = normalizeRotation(変更.rotation);

  syncNoteEntities(drawing);
  return '書き直した';
}

/**
 * 注記を消す。
 * @returns {boolean} 消せたか
 */
export function deleteNote(drawing, noteId) {
  const list = listNotes(drawing);
  if (!list.length || !noteId) return false;
  const i = list.findIndex((n) => n.id === noteId);
  if (i < 0) return false;
  list.splice(i, 1);
  syncNoteEntities(drawing);
  return true;
}

// ------------------------------------------------------------
// 覚えておくための形（src/storage.js に渡す）
//
// 図形ではなく、注記そのものを覚える。
// 図形は、開くたびに作り直せばよい。
// ------------------------------------------------------------

/** 覚えるための形にする。 */
export function notesToStore(drawing) {
  return listNotes(drawing).map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    height: n.height,
    text: n.text,
    rotation: n.rotation,
    colorKey: n.colorKey,
  }));
}

/**
 * 覚えてあったものを、図面に戻す。**元の図面を書き換える**。
 *
 * 壊れた値は黙って捨てる。1件おかしいだけで図面が開かなくなるほうが困る。
 * @returns {number} 戻せた件数
 */
export function restoreNotes(drawing, stored) {
  const list = ensureNotes(drawing);
  if (!list || !Array.isArray(stored)) return 0;

  let 戻した = 0;
  for (const s of stored) {
    if (!s) continue;
    const note = createNote(s);
    if (!note) continue;
    list.push(note);
    戻した += 1;
  }
  syncNoteEntities(drawing);
  return 戻した;
}

/**
 * タップした場所にある注記を探す（開発ルール44.4）。
 *
 * 【何のために要るか】
 * すでに文字があるところをタップしたとき、その上に新しい文字を重ねてしまうと
 * 読めなくなる。そこを押したら「書き直し」にする。
 *
 * 当たり判定は、回す前の四角で見る。
 * 回した四角で正確に見てもよいが、**指の誤差のほうがずっと大きい**ので、
 * 手間に見合わない。まわりに余裕を足したほうが実用的である。
 *
 * @param {number} 余裕 図面の座標での余裕（画面のピクセルを拡大率で割ったもの）
 * @returns {object|null} 見つかった注記
 */
export function findNoteAt(drawing, x, y, 余裕 = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const m = Number.isFinite(余裕) && 余裕 > 0 ? 余裕 : 0;

  let best = null;
  let bestD2 = Infinity;
  for (const n of listNotes(drawing)) {
    const 行たち = noteLines(n.text);
    if (!行たち.length) continue;

    const h = Math.abs(n.height || 0);
    // 1文字あたり高さの0.9倍で見積もる（日本語は正方形に近い）
    const 最長 = 行たち.reduce((a, l) => Math.max(a, l.length), 1);
    const 幅 = h * 0.9 * 最長;
    const 全高 = h * (1 + LINE_GAP * (行たち.length - 1));
    // 回っていると、幅と高さが入れ替わることがある。大きいほうで見る
    const r = Math.max(幅, 全高) + m;

    if (x < n.x - r || x > n.x + r || y < n.y - r || y > n.y + r) continue;

    const d2 = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best;
}
