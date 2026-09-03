// tests/print-ui.test.js — 囲んだ範囲を「あとから調整する」計算のテスト（開発ルール30章）
//
// 画面（DOM）はnodeに無いので、print-ui.js から**画面に触らない計算だけ**を
// ふつうの関数として取り出してあり、ここではそれを試す。
//
// 【なぜこの機能が要るのか】
// 一度で思いどおりに囲めることは、まずない。とくに手袋をした指では難しい。
// 囲み直しばかりでは現場で使えないので、つまんで直せるようにした。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HANDLE_HIT_PX,
  MIN_RECT_PX,
  EDGE_HANDLE_MIN_PX,
  HANDLE_NAMES,
  handlePositions,
  visibleHandles,
  hitTestHandle,
  isInsideRect,
  resizeRect,
  moveRect,
} from '../src/ui/print-ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const 板 = { width: 1000, height: 700 };
const 四角 = { x: 200, y: 150, width: 400, height: 300 };

// ============================================================
// つまみの場所と、当たり判定
// ============================================================

test('つまみは、四角の角4つと辺の真ん中4つに出る', () => {
  const p = handlePositions(四角);
  assert.deepEqual(p.nw, { x: 200, y: 150 }, '左上');
  assert.deepEqual(p.ne, { x: 600, y: 150 }, '右上');
  assert.deepEqual(p.sw, { x: 200, y: 450 }, '左下');
  assert.deepEqual(p.se, { x: 600, y: 450 }, '右下');
  assert.deepEqual(p.n, { x: 400, y: 150 }, '上の真ん中');
  assert.deepEqual(p.s, { x: 400, y: 450 }, '下の真ん中');
  assert.deepEqual(p.w, { x: 200, y: 300 }, '左の真ん中');
  assert.deepEqual(p.e, { x: 600, y: 300 }, '右の真ん中');
  assert.equal(HANDLE_NAMES.length, 8);
});

test('四角が小さいときは、辺の真ん中のつまみを出さない（角と重なって押せなくなるため）', () => {
  const 細長い = { x: 10, y: 10, width: 300, height: 30 };
  const 出るもの = visibleHandles(細長い);
  assert.ok(出るもの.includes('nw') && 出るもの.includes('se'), '角のつまみは必ず出す');
  assert.ok(出るもの.includes('n') && 出るもの.includes('s'), '横は長いので上下の真ん中は出す');
  assert.ok(!出るもの.includes('w') && !出るもの.includes('e'), '縦が短いので左右の真ん中は出さない');

  const ちいさい = { x: 10, y: 10, width: 30, height: 30 };
  assert.deepEqual(visibleHandles(ちいさい).sort(), ['ne', 'nw', 'se', 'sw']);
});

test('つまみの当たり判定は、指で押しやすい大きさ（44px以上）', () => {
  // 手袋をしていても押せるように（開発ルール11章）
  assert.ok(HANDLE_HIT_PX >= 44, `当たり判定が ${HANDLE_HIT_PX}px しかない`);

  // 丸のふちから少し外れたところを押しても、つまみとして拾えること
  const ずれ = HANDLE_HIT_PX / 2 - 2;
  assert.equal(hitTestHandle(四角, { x: 200 + ずれ, y: 150 }), 'nw');
  assert.equal(hitTestHandle(四角, { x: 600, y: 450 - ずれ }), 'se');
});

test('つまみから遠いところを押しても、つまみとして拾わない', () => {
  assert.equal(hitTestHandle(四角, { x: 400, y: 300 }), null, '四角の真ん中');
  assert.equal(hitTestHandle(四角, { x: 900, y: 650 }), null, '四角の外');
});

test('出していないつまみは、押しても拾わない', () => {
  // 出ていない丸が拾えてしまうと、「押していないのに形が変わる」ことになる
  const ちいさい = { x: 100, y: 100, width: 30, height: 30 };
  assert.equal(hitTestHandle(ちいさい, { x: 115, y: 100 }), 'nw', '角は拾う（近いほう）');
  const 細長い = { x: 100, y: 100, width: 300, height: 30 };
  // 左の真ん中(w)は出していない。その場所を押しても 'w' にはならない
  assert.notEqual(hitTestHandle(細長い, { x: 100, y: 115 }), 'w');
});

test('四角の中かどうかを正しく見分ける（範囲ごと動かす操作の判定）', () => {
  assert.equal(isInsideRect(四角, { x: 400, y: 300 }), true);
  assert.equal(isInsideRect(四角, { x: 200, y: 150 }), true, 'ちょうど角の上も中');
  assert.equal(isInsideRect(四角, { x: 199, y: 300 }), false);
  assert.equal(isInsideRect(四角, { x: 400, y: 451 }), false);
});

// ============================================================
// 大きさを直す
// ============================================================

test('角のつまみを動かすと、その角だけが動く（反対の角は動かない）', () => {
  const r = resizeRect(四角, 'nw', { x: 250, y: 200 }, 板);
  assert.deepEqual(r, { x: 250, y: 200, width: 350, height: 250 });
  // 右下の角は動いていない
  assert.equal(r.x + r.width, 600);
  assert.equal(r.y + r.height, 450);
});

test('辺の真ん中のつまみは、その辺だけを動かす（もう一方の向きは変わらない）', () => {
  const r = resizeRect(四角, 'e', { x: 800, y: 999 }, 板);
  assert.equal(r.x, 200, '左辺は動かない');
  assert.equal(r.width, 600, '右辺だけが動く');
  assert.equal(r.y, 150, '上下は変わらない');
  assert.equal(r.height, 300, '上下は変わらない');
});

test('つまんだまま反対側まで行っても壊れない（左右が入れ替わるだけ）', () => {
  // 左のつまみを、右辺よりさらに右へ引っぱった場合
  const r = resizeRect(四角, 'w', { x: 700, y: 300 }, 板);
  assert.ok(r.width > 0, '幅が負にならない');
  assert.equal(r.x, 600);
  assert.equal(r.width, 100);
});

test('画面（キャンバス）の外へははみ出さない', () => {
  const r = resizeRect(四角, 'se', { x: 5000, y: 5000 }, 板);
  assert.ok(r.x >= 0 && r.y >= 0, '左上が外に出ている');
  assert.ok(r.x + r.width <= 板.width, `右が外に出ている（${r.x + r.width}）`);
  assert.ok(r.y + r.height <= 板.height, `下が外に出ている（${r.y + r.height}）`);

  const r2 = resizeRect(四角, 'nw', { x: -5000, y: -5000 }, 板);
  assert.equal(r2.x, 0);
  assert.equal(r2.y, 0);
});

test('小さくつぶしても、印刷できない大きさにはならない', () => {
  // つぶれた範囲は印刷できない（開発ルール26.7）。つまみで作れてしまってはいけない。
  const r = resizeRect(四角, 'se', { x: 200, y: 150 }, 板);
  assert.ok(r.width >= MIN_RECT_PX, `幅が ${r.width} しかない`);
  assert.ok(r.height >= MIN_RECT_PX, `高さが ${r.height} しかない`);
  assert.ok(MIN_RECT_PX >= 20, '印刷できる最小の大きさ（20px）を下回っている');
});

test('画面のすみでつぶしても、外へはみ出さないまま最小の大きさになる', () => {
  const すみ = { x: 0, y: 0, width: 100, height: 100 };
  const r = resizeRect(すみ, 'se', { x: 0, y: 0 }, 板);
  assert.ok(r.x >= 0 && r.y >= 0, `すみからはみ出した（${r.x}, ${r.y}）`);
  assert.ok(r.width >= MIN_RECT_PX && r.height >= MIN_RECT_PX);
});

// ============================================================
// 範囲ごと動かす
// ============================================================

test('範囲ごと動かしても、大きさは変わらない', () => {
  const r = moveRect(四角, 60, -40, 板);
  assert.deepEqual(r, { x: 260, y: 110, width: 400, height: 300 });
});

test('範囲ごと動かしても、画面の外へは出ない', () => {
  const r = moveRect(四角, 9999, 9999, 板);
  assert.equal(r.x + r.width, 板.width);
  assert.equal(r.y + r.height, 板.height);
  assert.equal(r.width, 400, '端に当たっても大きさは変わらない');
  assert.equal(r.height, 300, '端に当たっても大きさは変わらない');

  const r2 = moveRect(四角, -9999, -9999, 板);
  assert.deepEqual(r2, { x: 0, y: 0, width: 400, height: 300 });
});

// ============================================================
// 画面の作り（ソースを読んで確かめる）
// ============================================================

test('つまみの当たり判定は、見た目の丸より広くしてある', () => {
  // 見た目26px＋まわり12pxずつ＝50px。手袋でもつまめる大きさ（開発ルール11章）
  const css = read('src/ui/print-ui.css');
  assert.match(css, /\.pr-handle::before\s*\{[\s\S]*?top:\s*-\d+px/, '当たり判定を広げていない');
});

test('ボタンの箱が、下のつまみを隠さないようにしてある', () => {
  // 隠れると、下の辺を調整できなくなる
  const js = read('src/ui/print-ui.js');
  const css = read('src/ui/print-ui.css');
  assert.match(js, /pr-actions-top/, '箱を上へ移す処理が無い');
  assert.match(css, /\.pr-actions\.pr-actions-top\s*\{[\s\S]*?top:/, '箱を上へ移す見た目が無い');
});

test('調整の途中で指が外れても、それまでの範囲を消さない', () => {
  // 消してしまうと、また一から囲み直しになる
  const js = read('src/ui/print-ui.js');
  const i = js.indexOf('function onPointerCancel');
  assert.ok(i >= 0, '中断したときの処理が無い');
  const body = js.slice(i, js.indexOf('\n  }\n', i));
  assert.match(body, /adjusting|moving/, '調整中の中断を区別していない');
  assert.match(body, /settle\(currentRect\)/, '調整中に中断すると範囲が消える');
});

test('つまみは、なぞっている最中には出さない', () => {
  // 囲んでいる最中に丸が出ると、指の下でちらついて分かりにくい
  const js = read('src/ui/print-ui.js');
  assert.match(js, /paintHandles\(\{ width: 0, height: 0 \}, false\)/, 'なぞり中につまみを消していない');
});

test('印刷のときは、この画面を紙に出さない', () => {
  const css = read('src/ui/print-ui.css');
  assert.match(
    css,
    /@media\s+print\s*\{[\s\S]*?\.pr-board[\s\S]*?display\s*:\s*none/,
    '囲む画面が紙に印刷されてしまう'
  );
});

test('辺の真ん中のつまみを出す目安は、丸2つが重ならない大きさ', () => {
  // 目安が小さすぎると、角の丸と辺の丸が重なって、どちらを押したか分からなくなる
  assert.ok(
    EDGE_HANDLE_MIN_PX >= HANDLE_HIT_PX,
    `目安(${EDGE_HANDLE_MIN_PX}px)が当たり判定(${HANDLE_HIT_PX}px)より小さい`
  );
});

// ============================================================
// ツールバーのボタン（v0.2.4：拡大・縮小を外した）
// ============================================================

test('ボタンは4つだけ（図面を開く／図面を選ぶ／全体表示／印刷する範囲）', () => {
  // ボタンをむやみに増やさない（開発ルール11章）。
  // 「拡大」「縮小」はユーザー判断で外した。2本指のつまむ操作でできるため。
  const js = read('src/ui/toolbar.js');
  const labels = [...js.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['図面を開く', '図面を選ぶ', '全体表示', '印刷する範囲']);
});

test('拡大・縮小ボタンの残りかすが無い', () => {
  // 押しても何も起きないボタンや、呼ばれない処理が残っていると、あとで混乱する
  const toolbar = read('src/ui/toolbar.js');
  const app = read('src/ui/app.js');
  assert.ok(!/zoom-in|zoom-out|zoomIn|zoomOut/.test(toolbar), 'toolbar.js に残っている');
  assert.ok(!/onZoomIn|onZoomOut|ZOOM_STEP/.test(app), 'app.js に残っている');
});

test('拡大縮小そのものは無くなっていない（2本指のつまむ操作は残す）', () => {
  // ボタンを外しただけ。拡大縮小できなくなってはいけない
  const app = read('src/ui/app.js');
  assert.match(app, /attachGestures\(/, '指の操作をつないでいない');
  assert.match(app, /onZoom/, 'つまむ操作での拡大縮小が無い');
});
