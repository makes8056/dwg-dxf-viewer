// tests/notes.test.js — 図面に書き足した文字（注記）のテスト（開発ルール43章・44章）
//
// 【この機能で守るべきこと】
//   1. 書いた文字は消えない（覚えておく。開き直しても残る）
//   2. 書いた文字は紙にもPDFにも出る
//   3. 動かせる・書き直せる・消せる
//   4. 色・大きさ・向き（15度きざみ）を選べて、改行できる
// どれもユーザーが決めた条件そのものである。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NOTE_LAYER,
  NOTE_COLORS,
  NOTE_SIZES,
  ROTATION_STEP,
  LINE_GAP,
  MAX_NOTE_LINES,
  MAX_LINE_LENGTH,
  DEFAULT_COLOR_KEY,
  DEFAULT_SIZE_KEY,
  colorCssFor,
  sizePxFor,
  noteHeightFor,
  createNote,
  normalizeNoteText,
  normalizeRotation,
  noteLines,
  isNote,
  listNotes,
  addNote,
  findNote,
  moveNote,
  editNote,
  deleteNote,
  syncNoteEntities,
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

/** 注記から作られた図形（text）だけを取り出す。 */
const 図形 = (d) => d.entities.filter(isNote);

// ============================================================
// 作る
// ============================================================

test('注記は、ふつうの文字（text）の図形になる', () => {
  // 【新しい種類にしない理由】
  // text はすでに画面・印刷の絵・PDFの3つすべてで描ける（回転も対応ずみ）。
  // 新しい種類にすると3か所に描き方を足すことになり、
  // どれか1つを忘れれば「画面には出るのに紙に出ない」が起きる。
  const d = 空の図面();
  addNote(d, createNote({ x: 10, y: 20, text: 'ここ既設と接続', height: 5 }));
  const e = 図形(d)[0];
  assert.equal(e.type, 'text');
  assert.equal(e.text, 'ここ既設と接続');
  assert.deepEqual([e.x, e.y], [10, 20]);
  assert.equal(e.isNote, true, '注記の印が付いていない');
  assert.equal(e.layer, NOTE_LAYER);
});

test('文字の縦位置に、Canvasが知らない名前を使っていない', () => {
  // 【実際に起きた不具合】Canvas は知らない名前を黙って無視する。
  // 無視されると直前の文字の縦位置が残り、文字がずれて出る（render.js 参照）。
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 1 }));
  const canvasが知っている = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];
  assert.ok(
    canvasが知っている.includes(図形(d)[0].vAlign),
    'Canvas が知らない縦位置。文字がずれて出る'
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

test('名札は、注記ごとに違う', () => {
  // 同じ名札だと、1つ動かしたつもりが別のものまで動く
  const a = createNote({ x: 0, y: 0, text: 'あ', height: 1 });
  const b = createNote({ x: 1, y: 1, text: 'い', height: 1 });
  assert.notEqual(a.id, b.id);
});

// ============================================================
// 改行（ユーザーの条件）
// ============================================================

test('改行はそのまま残る（1行に詰めない）', () => {
  assert.equal(normalizeNoteText('上\n下'), '上\n下');
  assert.deepEqual(noteLines('上\n下'), ['上', '下']);
});

test('改行のちがう書き方も、同じものとして扱う', () => {
  // Windowsの改行（CRLF）と、古いMacの改行（CR）
  assert.equal(normalizeNoteText('上\r\n下'), '上\n下');
  assert.equal(normalizeNoteText('上\r下'), '上\n下');
});

test('タブは空白に直す（1行の文字として描けないため）', () => {
  assert.equal(normalizeNoteText('前\tうしろ'), '前 うしろ');
});

test('前後のからっぽの行は落とす。間のからっぽの行は残す', () => {
  // 間の空行は「あけたくて入れたもの」。勝手に詰めない
  assert.equal(normalizeNoteText('\n\n上\n\n下\n\n'), '上\n\n下');
});

test('行数と1行の長さには上限がある（紙からはみ出すため）', () => {
  const 多い = Array.from({ length: MAX_NOTE_LINES + 5 }, (_, i) => `行${i}`).join('\n');
  assert.equal(noteLines(多い).length, MAX_NOTE_LINES);

  const 長い = 'あ'.repeat(MAX_LINE_LENGTH + 20);
  assert.equal(noteLines(長い)[0].length, MAX_LINE_LENGTH);
});

test('2行の注記は、2つの文字の図形になる', () => {
  // 【1行につき1つにする理由（44.1）】
  // こうすると render.js も print-area.js も print-pdf.js も
  // ふつうの1行の文字として扱うだけでよい。改行のために3か所を直さずに済む。
  const d = 空の図面();
  addNote(d, createNote({ x: 10, y: 100, text: '1行目\n2行目', height: 5 }));
  const es = 図形(d);
  assert.equal(es.length, 2);
  assert.deepEqual(es.map((e) => e.text), ['1行目', '2行目']);
});

test('2行目は、1行目の下に来る', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 10, y: 100, text: '上\n下', height: 5 }));
  const [一, 二] = 図形(d);
  assert.equal(二.x, 一.x, '横にずれている');
  // 図面の座標はYが上向きなので、下の行はYが小さい
  assert.ok(二.y < 一.y, '2行目が下に来ていない');
  assert.ok(Math.abs((一.y - 二.y) - 5 * LINE_GAP) < 1e-9, '行間が違う');
});

test('傾けた注記でも、2行目は文字の向きに合わせて下がる', () => {
  // 【ここを回さないと】傾けた注記の2行目が明後日の方向へ出る
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: '上\n下', height: 10, rotation: 90 }));
  const [一, 二] = 図形(d);
  // 90度回すと、文字は下から上へ読む向き。行は右へ下がる
  assert.ok(Math.abs(二.x - (一.x + 10 * LINE_GAP)) < 1e-9, `2行目のXが違う（${二.x}）`);
  assert.ok(Math.abs(二.y - 一.y) < 1e-9, `2行目のYが動いている（${二.y}）`);
});

// ============================================================
// 色（ユーザーの条件「数は多くなくて結構」）
// ============================================================

test('選べる色は、多すぎない', () => {
  assert.ok(NOTE_COLORS.length >= 3 && NOTE_COLORS.length <= 6,
    `色が ${NOTE_COLORS.length} 色ある。現場で迷う`);
});

test('選んだ色が、図形の色になる', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 1, colorKey: '青' }));
  assert.equal(図形(d)[0].color, colorCssFor('青'));
});

test('どの色も、白黒で刷っても読める濃さにする', () => {
  // 【薄い色を入れない】現場のプリンターは白黒のことがある。
  // 明るさが高い色は、灰色に変わったときに読めない。
  for (const c of NOTE_COLORS) {
    const R = parseInt(c.css.slice(1, 3), 16);
    const G = parseInt(c.css.slice(3, 5), 16);
    const B = parseInt(c.css.slice(5, 7), 16);
    const 明るさ = 0.299 * R + 0.587 * G + 0.114 * B;
    assert.ok(明るさ < 140, `${c.key}（${c.css}）は明るすぎる。白黒で読めない`);
  }
});

test('知らない色を渡されても落ちない（決めた色にする）', () => {
  assert.equal(colorCssFor('むらさき'), colorCssFor(DEFAULT_COLOR_KEY));
  const n = createNote({ x: 0, y: 0, text: 'あ', height: 1, colorKey: 'むらさき' });
  assert.equal(n.colorKey, DEFAULT_COLOR_KEY);
});

// ============================================================
// 大きさ（ユーザーの条件）
// ============================================================

test('大きさは3段階から選べる', () => {
  assert.deepEqual(NOTE_SIZES.map((s) => s.key), ['小', '中', '大']);
  assert.ok(sizePxFor('小') < sizePxFor('中'), '小が中より大きい');
  assert.ok(sizePxFor('中') < sizePxFor('大'), '中が大より大きい');
});

test('大きさは、置いたときに見えている大きさで決まる', () => {
  // 図面の単位で決め打ちすると、図面の縮尺しだいで極端な大きさになる（43.2）
  assert.equal(noteHeightFor('中', 1), sizePxFor('中'));
  assert.equal(noteHeightFor('中', 2), sizePxFor('中') / 2);
  assert.equal(noteHeightFor('大', 0.5), sizePxFor('大') * 2);
});

test('拡大率がおかしくても、大きさは0にならない', () => {
  // 0や負の高さの文字は描けない。図面が開いた直後は拡大率が決まっていないことがある
  assert.ok(noteHeightFor('中', 0) > 0);
  assert.ok(noteHeightFor('中', NaN) > 0);
  assert.ok(noteHeightFor('中', -3) > 0);
});

test('知らない大きさを渡されても落ちない', () => {
  assert.equal(sizePxFor('特大'), sizePxFor(DEFAULT_SIZE_KEY));
});

test('大きさを触っていなければ、書き直しても大きさが変わらない', () => {
  // 【これが崩れると】文字を直しただけで大きさが変わる。
  // 置いたときと今とで拡大率が違うため。
  const app = read('src/ui/app.js');
  const i = app.indexOf('onEdit: (noteId, 選び) => {');
  assert.ok(i >= 0, '書き直しのつなぎ込みが無い');
  const body = app.slice(i, app.indexOf('onDelete:', i));
  assert.match(body, /選び\.sizeChanged/, '大きさを触ったかを見ていない');
});

// ============================================================
// 向き（ユーザーの条件「15度きざみ」）
// ============================================================

test('向きは15度きざみ', () => {
  assert.equal(ROTATION_STEP, 15);
  assert.equal(normalizeRotation(0), 0);
  assert.equal(normalizeRotation(15), 15);
  assert.equal(normalizeRotation(14), 15, '15度きざみに丸めていない');
  assert.equal(normalizeRotation(7), 0);
});

test('向きは0〜345度におさまる（何周してもよい）', () => {
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation(375), 15);
  assert.equal(normalizeRotation(-15), 345);
  assert.equal(normalizeRotation(-360), 0);
});

test('おかしな向きでも落ちない', () => {
  assert.equal(normalizeRotation(NaN), 0);
  assert.equal(normalizeRotation(undefined), 0);
  assert.equal(normalizeRotation(Infinity), 0);
});

test('選んだ向きが、図形の向きになる', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 1, rotation: 45 }));
  assert.equal(図形(d)[0].rotation, 45);
});

// ============================================================
// 足す・動かす・書き直す・消す
// ============================================================

test('足す・動かす・書き直す・消すが、ひととおりできる', () => {
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 10, y: 10, text: '最初', height: 5 }));
  assert.equal(listNotes(d).length, 1);

  assert.equal(moveNote(d, n.id, 50, 60), true);
  assert.deepEqual([findNote(d, n.id).x, findNote(d, n.id).y], [50, 60]);
  assert.deepEqual([図形(d)[0].x,図形(d)[0].y], [50, 60], '図形が付いてきていない');

  assert.equal(editNote(d, n.id, { text: '書き直した' }), '書き直した');
  assert.equal(図形(d)[0].text, '書き直した');

  assert.equal(deleteNote(d, n.id), true);
  assert.equal(listNotes(d).length, 0);
  assert.equal(図形(d).length, 0, '図形が残っている');
});

test('色・大きさ・向きも、あとから直せる', () => {
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 5 }));
  editNote(d, n.id, { colorKey: '青', sizeKey: '大', height: 9, rotation: 30 });
  const e = 図形(d)[0];
  assert.equal(e.color, colorCssFor('青'));
  assert.equal(e.height, 9);
  assert.equal(e.rotation, 30);
  assert.equal(findNote(d, n.id).sizeKey, '大');
});

test('空にして決定したら、その注記は消える', () => {
  // 空の文字を残しても読めない。押せない何かが図面に残るほうが困る
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 0, y: 0, text: 'けす', height: 5 }));
  assert.equal(editNote(d, n.id, { text: '   ' }), '消した');
  assert.equal(listNotes(d).length, 0);
});

test('無い注記を動かそうとしても、落ちない', () => {
  const d = 空の図面();
  assert.equal(moveNote(d, 'ない名札', 1, 2), false);
  assert.equal(editNote(d, 'ない名札', { text: 'あ' }), '見つからない');
  assert.equal(deleteNote(d, 'ない名札'), false);
});

test('消すのは、指定した1つだけ', () => {
  const d = 空の図面();
  const a = addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 1 }));
  const b = addNote(d, createNote({ x: 5, y: 5, text: 'い', height: 1 }));
  deleteNote(d, a.id);
  assert.deepEqual(listNotes(d).map((n) => n.text), ['い']);
  assert.ok(findNote(d, b.id));
});

test('図面のもとの図形は、注記の操作で消えない', () => {
  // 【ここが崩れると図面が壊れる】
  // 作り直しは isNote の印だけを頼りにする。印が無いものには触らない。
  const d = 空の図面();
  d.entities.push({ type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 10, y2: 0 });
  d.entities.push({ type: 'text', layer: '0', color: '#000', x: 1, y: 1, height: 2, text: '図面の文字' });
  const n = addNote(d, createNote({ x: 5, y: 5, text: 'あ', height: 1 }));
  deleteNote(d, n.id);
  assert.equal(d.entities.length, 2, '図面のもとの図形まで消えた');
  assert.deepEqual(d.entities.map((e) => e.type), ['line', 'text']);
});

test('作り直しても、図形が増え続けない', () => {
  // 【毎回作り直す作りの落とし穴】前のぶんを消し忘れると、
  // 動かすたびに文字が重なって濃くなっていく
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: 'あ\nい', height: 1 }));
  assert.equal(図形(d).length, 2);
  syncNoteEntities(d);
  syncNoteEntities(d);
  assert.equal(図形(d).length, 2, '図形が増えている');
});

// ============================================================
// 覚えておく（ユーザーの条件「残す」）
// ============================================================

test('覚える形に直して、また戻せる', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 10, y: 20, text: '既設\n2行目', height: 5, colorKey: '青', sizeKey: '大', rotation: 45 }));

  const 覚えたもの = notesToStore(d);
  const 別の図面 = 空の図面();
  assert.equal(restoreNotes(別の図面, 覚えたもの), 1);

  const n = listNotes(別の図面)[0];
  assert.equal(n.text, '既設\n2行目', '改行が失われている');
  assert.equal(n.colorKey, '青', '色が失われている');
  assert.equal(n.sizeKey, '大', '大きさが失われている');
  assert.equal(n.rotation, 45, '向きが失われている');
  assert.deepEqual([n.x, n.y], [10, 20]);
  assert.equal(図形(別の図面).length, 2, '戻したのに図形ができていない');
});

test('名札も、そのまま覚えて戻る', () => {
  // 名札が変わると、覚えたあとに動かした注記が「別のもの」になってしまう
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 1 }));
  const 別 = 空の図面();
  restoreNotes(別, notesToStore(d));
  assert.equal(listNotes(別)[0].id, n.id);
});

test('覚えるのは、必要な値だけ', () => {
  // 図形そのものは覚えない。開くたびに作り直せばよい
  const d = 空の図面();
  addNote(d, createNote({ x: 1, y: 2, text: 'あ', height: 3 }));
  assert.deepEqual(
    Object.keys(notesToStore(d)[0]).sort(),
    ['colorKey', 'height', 'id', 'rotation', 'sizeKey', 'text', 'x', 'y']
  );
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

test('古い記録（色や向きが無いもの）も、そのまま開ける', () => {
  // 【v0.3.8で書いた注記が、v0.3.9で開けなくなってはいけない】
  const d = 空の図面();
  assert.equal(restoreNotes(d, [{ id: 'x', x: 1, y: 2, text: '古い', height: 3 }]), 1);
  const n = listNotes(d)[0];
  assert.equal(n.colorKey, DEFAULT_COLOR_KEY);
  assert.equal(n.sizeKey, DEFAULT_SIZE_KEY);
  assert.equal(n.rotation, 0);
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
  //
  // 【ゆるく見てはいけない】「前の記録」という字があるかを見るだけだと、
  // 値を notes: [] に書き換えても通ってしまう（43.6で実際にすり抜けた）。
  const src = read('src/storage.js');
  const i = src.indexOf('export async function saveDrawing');
  const body = src.slice(i, src.indexOf('export async function loadLatestDrawing'));
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

const 注記入りの図面 = (中身) => {
  const d = 空の図面();
  d.entities.push({ type: 'line', layer: '0', color: '#000000', x1: 0, y1: 0, x2: 100, y2: 0 });
  addNote(d, createNote({ x: 20, y: 50, text: 'ABC', height: 8, ...中身 }));
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

test('2行の注記は、紙にも2行として出る', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const 一行 = renderPrintCanvas(注記入りの図面({ text: 'ABC' }), area, { createCanvas: makeFakeCanvas });
  const 二行 = renderPrintCanvas(注記入りの図面({ text: 'ABC\nDEF' }), area, { createCanvas: makeFakeCanvas });
  assert.equal(二行.drawn, 一行.drawn + 1, '2行目が紙に出ていない');
});

test('書いた文字は、PDFにも入る', () => {
  // 【絵だけ直してPDFを忘れると】確認画面には出るのに紙にだけ出ない、が起きる（36.2）
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const r = createPrintPdf(注記入りの図面(), area, { createCanvas: makeFakeCanvas });
  assert.ok(!r.error, `PDFが作れなかった：${r.error}`);
  assert.match(文字にする(r.bytes), /ABC/, '書いた文字がPDFに入っていない');
});

test('2行の注記は、PDFにも2行として入る', () => {
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const r = createPrintPdf(注記入りの図面({ text: 'ABC\nDEF' }), area, { createCanvas: makeFakeCanvas });
  assert.ok(!r.error);
  const 中身 = 文字にする(r.bytes);
  assert.match(中身, /ABC/, '1行目が入っていない');
  assert.match(中身, /DEF/, '2行目が入っていない');
});

test('傾けた注記も、PDFで傾いて入る', () => {
  // PDFは Tm（置き方の行列）で傾きを表す。傾き0なら「1 0 0 1」になる
  const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const まっすぐ = createPrintPdf(注記入りの図面({ rotation: 0 }), area, { createCanvas: makeFakeCanvas });
  const 傾けた = createPrintPdf(注記入りの図面({ rotation: 45 }), area, { createCanvas: makeFakeCanvas });
  assert.ok(!まっすぐ.error && !傾けた.error);
  assert.notEqual(
    文字にする(まっすぐ.bytes).match(/[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ Tm/)?.[0],
    文字にする(傾けた.bytes).match(/[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ Tm/)?.[0],
    'PDFで傾いていない'
  );
});

test('「印刷しない」の仕組みが、書いた文字を巻き添えにしない', () => {
  // 注記はレイヤーが違うだけで、印刷しない設定にはなっていない
  const 紙 = printableDrawing(注記入りの図面());
  assert.equal(紙.entities.filter(isNote).length, 1, '書いた文字が紙から外れている');
});

// ============================================================
// 測るときに邪魔をしない
// ============================================================

test('長さを測るとき、書いた文字には吸い付かない', () => {
  // 【文字に吸い付くと測れなくなる】注記は図面の形ではないので、寸法の基準にならない
  const d = 空の図面();
  addNote(d, createNote({ x: 20, y: 50, text: 'ABC', height: 8 }));
  assert.equal(findSnapPoint(d.entities, 20, 50, 30), null, '文字に吸い付いている');

  // 文字のすぐ横に線があるときは、線のほうに吸い付く
  d.entities.push({ type: 'line', layer: '0', color: '#000', x1: 25, y1: 50, x2: 60, y2: 50 });
  const p = findSnapPoint(d.entities, 21, 50, 30);
  assert.ok(p, '近くに線があるのに、何にも吸い付かない');
  assert.deepEqual([p.x, p.y], [25, 50], '文字に引っぱられている');
});

// ============================================================
// タップした注記を見つける
// ============================================================

test('文字の上をタップすると、その注記が見つかる', () => {
  const d = 空の図面();
  const n = addNote(d, createNote({ x: 10, y: 10, text: 'あいう', height: 4 }));
  assert.equal(findNoteAt(d, 12, 12, 0)?.id, n.id);
  assert.equal(findNoteAt(d, 10, 10, 0)?.id, n.id);
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
  assert.equal(findNoteAt(d, 9, 0, 2)?.id, 近い.id);
});

test('おかしな場所を渡しても落ちない', () => {
  const d = 空の図面();
  addNote(d, createNote({ x: 0, y: 0, text: 'あ', height: 4 }));
  assert.equal(findNoteAt(d, NaN, 0, 1), null);
  assert.equal(findNoteAt(null, 0, 0, 1), null);
});

test('すでに文字があるところをタップしたら、重ねずに書き直しにする', () => {
  // 【重ねると読めなくなる】
  const app = read('src/ui/app.js');
  const i = app.indexOf('function onNoteTap');
  assert.ok(i >= 0, 'タップの処理が無い');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(body, /findNoteAt\(/, 'すでに文字があるかを見ていない');
  assert.match(body, /noteUi\.tapAt\(x, y, あった\)/, '見つけたものを渡していない');
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

test('取っ手と選びボタンは、指で押せる大きさ', () => {
  // inset では box-sizing のぶんだけ小さくなる（開発ルール42.4で実際に6px足りなかった）
  const css = read('src/ui/note-ui.css');
  const i = css.indexOf('.nt-handle::before');
  assert.ok(i >= 0, '取っ手の当たり判定を広げていない');
  const 取っ手 = css.slice(i, css.indexOf('}', i));
  assert.doesNotMatch(取っ手, /inset:/, 'inset で広げている。box-sizing のぶんだけ小さくなる');
  const w = 取っ手.match(/width:\s*(\d+)px/);
  assert.ok(w && Number(w[1]) >= 44, `取っ手の当たり判定が ${w ? w[1] : '?'}px しかない`);

  const j = css.indexOf('.nt-chip {');
  assert.ok(j >= 0, '選びボタンの決まりが無い');
  const chip = css.slice(j, css.indexOf('}', j));
  const mw = chip.match(/min-width:\s*(\d+)px/);
  const mh = chip.match(/min-height:\s*(\d+)px/);
  assert.ok(mw && Number(mw[1]) >= 44, '色・大きさの選びが押しにくい（横）');
  assert.ok(mh && Number(mh[1]) >= 44, '色・大きさの選びが押しにくい（縦）');
});

test('入力欄の文字は16px以上（iPadが画面ごと拡大しないように）', () => {
  // 【16px未満だと何が起きるか】
  // iPadのSafariは、小さい文字の入力欄に触れると画面ぜんたいを勝手に拡大する。
  // 図面を見ている位置がずれて驚かせる。
  const css = read('src/ui/note-ui.css');
  const i = css.indexOf('.nt-input {\n  display: block;');
  assert.ok(i >= 0, '入力欄の決まりが無い');
  const body = css.slice(i, css.indexOf('}', i));
  const m = body.match(/font-size:\s*(\d+)px/);
  assert.ok(m, '入力欄の文字の大きさが書いていない');
  assert.ok(Number(m[1]) >= 16, `入力欄が ${m[1]}px。iPadが画面ごと拡大してしまう`);
});

test('改行できるので、Enterを決定に使っていない', () => {
  // 【両方に使うと、どちらも思いどおりにならない】
  // 改行を入れられるようにした以上、Enterは改行のためのもの。
  const ui = read('src/ui/note-ui.js');
  assert.match(ui, /<textarea class="nt-input"/, '改行できる入力欄になっていない');
  assert.doesNotMatch(ui, /ev\.key === 'Enter'/, 'Enterを横取りしている。改行できない');
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

test('キーボードが出ても、窓の中をスクロールして「決定」に届く', () => {
  // 【色・大きさ・向きの段を足したぶん、窓が高くなった（44.5）】
  // iPadでキーボードが出ると見える範囲が半分ほどになり、
  // そのままでは「決定」が画面の外へ出て、書いたものを確定できない。
  const css = read('src/ui/note-ui.css');
  const i = css.indexOf('.nt-dialog-box {');
  assert.ok(i >= 0, '窓の箱の決まりが無い');
  const body = css.slice(i, css.indexOf('}', i));
  assert.match(body, /max-height:/, '窓の高さに上限が無い');
  assert.match(body, /overflow-y:\s*auto/, '窓の中をスクロールできない');
});
