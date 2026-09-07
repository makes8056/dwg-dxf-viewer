// tests/notes.test.js — 図面に書き足した文字（注記）のテスト（開発ルール43章）
//
// 【この機能で守るべきこと】
//   1. 書いた文字は消えない（覚えておく。開き直しても残る）
//   2. 書いた文字は紙にもPDFにも出る
//   3. 動かせる・書き直せる・消せる
// この3つはユーザーが決めた条件そのものである。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NOTE_LAYER,
  NOTE_HEIGHT_PX,
  MAX_NOTE_LENGTH,
  createNote,
  normalizeNoteText,
  noteHeightForScale,
  isNote,
  listNotes,
  addNote,
  findNote,
  moveNote,
  editNote,
  deleteNote,
  notesToStore,
  restoreNotes,
  findNoteAt,
} from '../src/notes.js';
import { renderPrintCanvas, printableDrawing } from '../src/print-area.js';
import { createPrintPdf } from '../src/print-pdf.js';
import { findSnapPoint } from '../src/measure.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 注記を入れられる、からっぽの図面。 */
const 空の図面 = () => ({
  units: 'mm',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  contentBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  layers: [],
  entities: [],
  unsupported: { count: 0, kinds: {} },
  source: 'dxf',
});

// ============================================================
// 作る
// ============================================================

test('注記は、ふつうの文字（text）として作られる', () => {
  // 【新しい種類にしない理由】
  // text はすでに画面・印刷の絵・PDFの3つすべてで描ける。
  // 新しい種類にすると3か所に描き方を足すことになり、
  // どれか1つを忘れれば「画面には出るのに紙に出ない」が起きる。
  const n = createNote({ x: 10, y: 20, text: 'ここ既設と接続', height: 5 });
  assert.equal(n.type, 'text');
  assert.equal(n.text, 'ここ既設と接続');
  assert.deepEqual([n.x, n.y], [10, 20]);
  assert.equal(n.height, 5);
  assert.equal(n.isNote, true, '注記の印が付いていない');
  assert.ok(n.noteId, '名札が無いと、動かすことも消すこともできない');
});

test('注記は、図面のレイヤーとぶつからない名前に置く', () => {
  const n = createNote({ x: 0, y: 0, text: 'あ', height: 1 });
  assert.equal(n.layer, NOTE_LAYER);
});

test('文字の縦位置に、Canvasが知らない名前を使っていない', () => {
  // 【実際に起きた不具合】Canvas は知らない名前を黙って無視する。
  // 無視されると直前の文字の縦位置が残り、文字がずれて出る（render.js 参照）。
  const n = createNote({ x: 0, y: 0, text: 'あ', height: 1 });
  const canvasが知っている = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];
  assert.ok(
    canvasが知っている.includes(n.vAlign),
    `Canvas が知らない縦位置（${n.vAlign}）。文字がずれて出る`
  );
});

test('空の文字では作らない', () => {
  assert.equal(createNote({ x: 0, y: 0, text: '', height: 1 }), null);
  assert.equal(createNote({ x: 0, y: 0, text: '   ', height: 1 }), null);
  assert.equal(createNote({ x: 0, y: 0, text: null, height: 1 }), null);
});

test('場所がおかしければ作らない', () => {
  assert.equal(createNote({ x: NaN, y: 0, text: 'あ', height: 1 }), null);
  assert.equal(createNote({ x: 0, y: Infinity, text: 'あ', height: 1 }), null);
});

test('改行やタブは、空白に直す', () => {
  // 1行の文字として描くので、改行はそのままでは出せない
  assert.equal(normalizeNoteText('上\n下'), '上 下');
  assert.equal(normalizeNoteText('前\tうしろ'), '前 うしろ');
  assert.equal(normalizeNoteText('  まわりの空白  '), 'まわりの空白');
});

test('長すぎる文字は切る（紙からはみ出すため）', () => {
  const 長い = 'あ'.repeat(MAX_NOTE_LENGTH + 20);
  assert.equal(normalizeNoteText(長い).length, MAX_NOTE_LENGTH);
});

test('文字の大きさは、置いたときに見えている大きさで決まる', () => {
  // 図面の単位で決め打ちすると、図面の縮尺しだいで極端な大きさになる
  assert.equal(noteHeightForScale(1), NOTE_HEIGHT_PX);
  assert.equal(noteHeightForScale(2), NOTE_HEIGHT_PX / 2);
  assert.equal(noteHeightForScale(0.5), NOTE_HEIGHT_PX * 2);
});

test('拡大率がおかしくても、大きさは0にならない', () => {
  // 0や負の高さの文字は描けない。図面が開いた直後は拡大率が決まっていないことがある
  assert.ok(noteHeightForScale(0) > 0);
  assert.ok(noteHeightForScale(NaN) > 0);
  assert.ok(noteHeightForScale(-3) > 0);
});

// ============================================================
// 足す・動かす・書き直す・消す（ユーザーの条件「すべて」）
// ============================================================

test('足す・動かす・書き直す・消すが、ひととおりできる', () => {
  const d = 空の図面();
  const n = createNote({ x: 10, y: 10, text: '最初', height: 5 });
  addNote(d, n);
  assert.equal(listNotes(d).length, 1);

  assert.equal(moveNote(d, n.noteId, 50, 60), true);
  assert.deepEqual([findNote(d, n.noteId).x, findNote(d, n.noteId).y], [50, 60]);

  assert.equal(editNote(d, n.noteId, '書き直した'), '書き直した');
  assert.equal(findNote(d, n.noteId).text, '書き直した');

  assert.equal(deleteNote(d, n.noteId), true);
  assert.equal(listNotes(d).length, 0);
});

test('空にして決定したら、その注記は消える', () => {
  // 空の文字を残しても読めない。押せない何かが図面に残るほうが困る
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 0, y: 0, text: 'けす', height: 5 }));
  assert.equal(editNote(d, n.noteId, '   '), '消した');
  assert.equal(listNotes(d).length, 0);
});

test('無い注記を動かそうとしても、落ちない', () => {
  const d = 空の図面();
  assert.equal(moveNote(d, 'ない名札', 1, 2), false);
  assert.equal(editNote(d, 'ない名札', 'あ'), '見つからない');
  assert.equal(deleteNote(d, 'ない名札'), false);
});

test('名札は、注記ごとに違う', () => {
  // 同じ名札だと、1つ動かしたつもりが別のものまで動く
  const a = createNote({ x: 0, y: 0, text: 'あ', height: 1 });
  const b = createNote({ x: 1, y: 1, text: 'い', height: 1 });
  assert.notEqual(a.noteId, b.noteId);
});

test('消すのは、指定した1つだけ', () => {
  const d = 空の図面();
  const a = addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 1 }));
  const b = addNote(d, createNote({ x: 5, y: 5, text: 'い', height: 1 }));
  deleteNote(d, a.noteId);
  assert.deepEqual(listNotes(d).map((n) => n.text), ['い']);
  assert.ok(findNote(d, b.noteId));
});

test('図面のもとの図形は、注記の操作で消えない', () => {
  // 【ここが崩れると図面が壊れる】
  const d = 空の図面();
  d.entities.push({ type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 10, y2: 0 });
  const n = addNote(d, createNote({ x: 5, y: 5, text: 'あ', height: 1 }));
  deleteNote(d, n.noteId);
  assert.equal(d.entities.length, 1);
  assert.equal(d.entities[0].type, 'line');
});

// ============================================================
// 覚えておく（ユーザーの条件「残す」）
// ============================================================

test('覚える形に直して、また戻せる', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 10, y: 20, text: '既設', height: 5 }));
  addNote(d, createNote({ x: 30, y: 40, text: '新設', height: 7 }));

  const 覚えたもの = notesToStore(d);
  assert.equal(覚えたもの.length, 2);

  const 別の図面 = 空の図面();
  assert.equal(restoreNotes(別の図面, 覚えたもの), 2);
  const 戻った = listNotes(別の図面);
  assert.deepEqual(戻った.map((n) => n.text), ['既設', '新設']);
  assert.deepEqual(戻った.map((n) => [n.x, n.y]), [[10, 20], [30, 40]]);
  assert.deepEqual(戻った.map((n) => n.height), [5, 7]);
});

test('名札も、そのまま覚えて戻る', () => {
  // 名札が変わると、覚えたあとに動かした注記が「別のもの」になってしまう
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 1 }));
  const 別 = 空の図面();
  restoreNotes(別, notesToStore(d));
  assert.equal(listNotes(別)[0].noteId, n.noteId);
});

test('覚えるのは、必要な値だけ', () => {
  // 色や配置の決まりをあとで変えたときに、古い値に引きずられないため
  const d = 空の図面();
  addNote(d, createNote({ x: 1, y: 2, text: 'あ', height: 3 }));
  assert.deepEqual(Object.keys(notesToStore(d)[0]).sort(), ['height', 'id', 'text', 'x', 'y']);
});

test('壊れた記録が混ざっていても、他は戻る', () => {
  // 1件おかしいだけで図面が開かなくなるほうが困る
  const d = 空の図面();
  const 戻した = restoreNotes(d, [
    { id: 'a', x: 1, y: 2, text: 'よい', height: 3 },
    null,
    { id: 'b', x: NaN, y: 2, text: 'ばしょが変', height: 3 },
    { id: 'c', x: 1, y: 2, text: '', height: 3 },
    { id: 'd', x: 5, y: 6, text: 'これもよい', height: 3 },
  ]);
  assert.equal(戻した, 2);
  assert.deepEqual(listNotes(d).map((n) => n.text), ['よい', 'これもよい']);
});

test('覚えていないものを戻そうとしても、落ちない', () => {
  const d = 空の図面();
  assert.equal(restoreNotes(d, null), 0);
  assert.equal(restoreNotes(d, undefined), 0);
  assert.equal(restoreNotes(null, []), 0);
});

test('図面を覚え直しても、書いた文字は消えない', () => {
  // 【同じ図面をもう一度開いたとき】
  // saveDrawing は記録を丸ごと置き換える。そのまま書くと注記が黙って消える。
  const src = read('src/storage.js');
  const i = src.indexOf('export async function saveDrawing');
  const body = src.slice(i, src.indexOf('export async function loadLatestDrawing'));
  // 【ゆるく見てはいけない】「前の記録」という字があるかを見るだけだと、
  // 値を notes: [] に書き換えても通ってしまう（実際にすり抜けた）。
  // **前の記録の中身を入れていること**まで見る。
  assert.match(
    body,
    /notes:\s*\(?\s*前の記録/,
    '注記が前の記録から来ていない。図面を開き直すと書いた文字が消える'
  );
});

test('文字を書いただけでは、図面の新しさの順が入れ替わらない', () => {
  // 入れ替わると、次に開いたときに別の図面が出てきて驚かせる
  const src = read('src/storage.js');
  const i = src.indexOf('export async function saveNotes');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.doesNotMatch(body, /savedAt: nextSavedAt\(\)/, 'savedAt を書き換えている');
});

// ============================================================
// 紙とPDFに出す（ユーザーの条件「印刷・PDF両方に入れる」）
// ============================================================

const 注記入りの図面 = () => {
  const d = 空の図面();
  d.entities.push({ type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: 100, y2: 0 });
  addNote(d, createNote({ x: 20, y: 50, text: 'ABC', height: 8 }));
  return d;
};

test('書いた文字は、印刷の絵に描かれる', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const 注記なし = 空の図面();
  注記なし.entities.push({ type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: 100, y2: 0 });

  const a = renderPrintCanvas(注記なし, area, { createCanvas: makeFakeCanvas });
  const b = renderPrintCanvas(注記入りの図面(), area, { createCanvas: makeFakeCanvas });
  assert.equal(b.drawn, a.drawn + 1, '書いた文字が紙に出ていない');
});

test('書いた文字は、PDFにも入る', () => {
  // 【絵だけ直してPDFを忘れると】確認画面には出るのに紙にだけ出ない、が起きる（36.2）
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const r = createPrintPdf(注記入りの図面(), area, { createCanvas: makeFakeCanvas });
  assert.ok(!r.error, `PDFが作れなかった：${r.error}`);
  const 中身 = 文字にする(r.bytes);
  assert.match(中身, /ABC/, '書いた文字がPDFに入っていない');
});

test('「印刷しない」の仕組みが、書いた文字を巻き添えにしない', () => {
  // 注記はレイヤーが違うだけで、印刷しない設定にはなっていない
  const d = 注記入りの図面();
  const 紙 = printableDrawing(d);
  assert.equal(listNotes(紙).length, 1, '書いた文字が紙から外れている');
});

// ============================================================
// 測るときに邪魔をしない
// ============================================================

test('長さを測るとき、書いた文字には吸い付かない', () => {
  // 【文字に吸い付くと測れなくなる】
  // 注記は図面の形ではないので、寸法の基準にはならない。
  // 文字の位置ちょうどをタップしても、文字そのものは候補に出ない
  const 文字だけ = [createNote({ x: 20, y: 50, text: 'ABC', height: 8 })];
  assert.equal(findSnapPoint(文字だけ, 20, 50, 30), null, '文字に吸い付いている');

  // 文字のすぐ横に線があるときは、**線のほうに**吸い付く
  const 線と文字 = [
    createNote({ x: 20, y: 50, text: 'ABC', height: 8 }),
    { type: 'line', layer: '0', color: '#000', x1: 25, y1: 50, x2: 60, y2: 50 },
  ];
  const p = findSnapPoint(線と文字, 21, 50, 30);
  assert.ok(p, '近くに線があるのに、何にも吸い付かない');
  assert.deepEqual([p.x, p.y], [25, 50], '文字に引っぱられている');
});

// ============================================================
// タップした注記を見つける
// ============================================================

test('文字の上をタップすると、その注記が見つかる', () => {
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 10, y: 10, text: 'あいう', height: 4 }));
  // 書き出す点のすぐ右上（文字はそこから右上へ伸びる）
  assert.equal(findNoteAt(d, 12, 12, 0)?.noteId, n.noteId);
  assert.equal(findNoteAt(d, 10, 10, 0)?.noteId, n.noteId);
});

test('遠いところをタップしても、見つからない', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 10, y: 10, text: 'あ', height: 4 }));
  assert.equal(findNoteAt(d, 500, 500, 0), null);
});

test('近くに2つあるときは、いちばん近いほうが選ばれる', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: 'とおい', height: 4 }));
  const 近い = addNote(d, createNote({ x: 8, y: 0, text: 'ちかい', height: 4 }));
  assert.equal(findNoteAt(d, 9, 0, 2)?.noteId, 近い.noteId);
});

test('おかしな場所を渡しても落ちない', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 4 }));
  assert.equal(findNoteAt(d, NaN, 0, 1), null);
  assert.equal(findNoteAt(null, 0, 0, 1), null);
});

test('注記かどうかを見分けられる', () => {
  assert.equal(isNote(createNote({ x: 0, y: 0, text: 'あ', height: 1 })), true);
  assert.equal(isNote({ type: 'text', x: 0, y: 0, text: '図面の文字' }), false);
  assert.equal(isNote(null), false);
});

// ============================================================
// つなぎ方
// ============================================================

test('文字を書く画面は、指を通す（図面の拡大縮小を邪魔しない）', () => {
  // 測る画面と同じ決まり（39章・42.3）
  const css = read('src/ui/note-ui.css');
  const i = css.indexOf('.nt-root');
  const body = css.slice(i, css.indexOf('}', i));
  assert.match(body, /pointer-events:\s*none/, '指を通していない。図面が動かせなくなる');
});

test('取っ手の上で2本指を始めたら、つまむのをやめて拡大縮小に譲る', () => {
  const ui = read('src/ui/note-ui.js');
  const i = ui.indexOf('function 二本目が来た');
  assert.ok(i >= 0, '2本目の指を見張っていない');
  assert.match(ui.slice(i, ui.indexOf('function 動かす')), /はなす\(\)/, '譲っていない');
});

test('取っ手は、指で押せる大きさの当たり判定を持つ', () => {
  // inset では box-sizing のぶんだけ小さくなる（開発ルール42.4で実際に6px足りなかった）
  const css = read('src/ui/note-ui.css');
  const i = css.indexOf('.nt-handle::before');
  assert.ok(i >= 0, '当たり判定を広げていない');
  const body = css.slice(i, css.indexOf('}', i));
  assert.doesNotMatch(body, /inset:/, 'inset で広げている。box-sizing のぶんだけ小さくなる');
  const w = body.match(/width:\s*(\d+)px/);
  assert.ok(w && Number(w[1]) >= 44, `当たり判定が ${w ? w[1] : '?'}px しかない`);
});

test('入力欄の文字は16px以上（iPadが画面ごと拡大しないように）', () => {
  // 【16px未満だと何が起きるか】
  // iPadのSafariは、小さい文字の入力欄に触れると画面ぜんたいを勝手に拡大する。
  // 図面を見ている位置がずれて驚かせる。
  const css = read('src/ui/note-ui.css');
  const i = css.indexOf('.nt-input {');
  const body = css.slice(i, css.indexOf('}', i));
  const m = body.match(/font-size:\s*(\d+)px/);
  assert.ok(m, '入力欄の文字の大きさが書いていない');
  assert.ok(Number(m[1]) >= 16, `入力欄が ${m[1]}px。iPadが画面ごと拡大してしまう`);
});

test('文字を書く画面と、他のモードは同時に出さない', () => {
  const app = read('src/ui/app.js');
  assert.match(app, /if \(noteUi\.isActive\(\)\) noteUi\.stop\(\)/, '文字の画面を閉じていない');
  const i = app.indexOf('onNote: () => {');
  assert.ok(i >= 0, 'ツールバーにつないでいない');
  const body = app.slice(i, app.indexOf('onFit:', i));
  assert.match(body, /printUi\.isActive\(\)/, '囲む画面を閉じていない');
  assert.match(body, /measureUi\.isActive\(\)/, '測る画面を閉じていない');
});

test('図面を動かしたら、取っ手も置き直す', () => {
  // 忘れると、取っ手だけ取り残されて別の場所を指すようになる（39.3と同じ）
  const app = read('src/ui/app.js');
  const i = app.indexOf('function redraw()');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(body, /noteUi\.refresh\(\)/, '取っ手を置き直していない');
});

test('書いたらすぐ覚える', () => {
  // 現場では、書いた直後にアプリを閉じることがふつうにある
  const app = read('src/ui/app.js');
  const i = app.indexOf('function noteChanged()');
  assert.ok(i >= 0, '覚え直す処理が無い');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(body, /saveNotes\(/, '覚えていない');
  assert.match(body, /scheduleRedraw\(\)/, '描き直していない');
});

test('別の図面に切り替えたあと、前の図面の文字が現れない', () => {
  // 大きな図面だと、覚えてある文字を取り出している間に切り替えられる
  const app = read('src/ui/app.js');
  const i = app.indexOf('async function restoreNotesFor');
  assert.ok(i >= 0, '注記を戻す処理が無い');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(body, /drawing !== currentDrawing/, '取り違えの確認をしていない');
});

// ------------------------------------------------------------
// 道具
// ------------------------------------------------------------

/** ctx（描く先）のふり。呼ばれた命令を記録するだけ。 */
function makeFakeCtx(pixelWidth, pixelHeight) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    canvas: { width: pixelWidth, height: pixelHeight },
    save: record('save'), restore: record('restore'), setTransform: record('setTransform'),
    fillRect: record('fillRect'), fill: record('fill'), rect: record('rect'), clip: record('clip'),
    beginPath: record('beginPath'), closePath: record('closePath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'), stroke: record('stroke'),
    arc: record('arc'), ellipse: record('ellipse'), fillText: record('fillText'),
    translate: record('translate'), rotate: record('rotate'),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    font: '', textAlign: '', textBaseline: '',
  };
}

function makeFakeCanvas(width, height) {
  const ctx = makeFakeCtx(width, height);
  return { width, height, ctx, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,X' };
}

/** PDFのバイト列を、中身を調べられる文字にする。 */
function 文字にする(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

test('日本語を変換している最中のEnterを、横取りしない', () => {
  // 【日本語で使うアプリでは必ず踏む】
  // 「せつぞく」と打って変換している最中のEnterは、変換を確定するためのEnter。
  // ここで横取りすると、変換が終わる前に窓が閉じ、ひらがなのまま書き込まれる。
  const ui = read('src/ui/note-ui.js');
  const i = ui.indexOf("入力欄.addEventListener('keydown'");
  assert.ok(i >= 0, 'Enterの処理が無い');
  const body = ui.slice(i, ui.indexOf('});', i));
  assert.match(body, /isComposing/, '変換中かどうかを見ていない');
  assert.match(body, /229/, '古いブラウザの言い方（keyCode 229）を見ていない');
});
