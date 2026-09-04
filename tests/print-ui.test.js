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
  pinchMidpoint,
  pinchDistance,
  rectToDrawing,
  rectFromDrawing,
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

// ============================================================
// 囲んでいる間の拡大縮小（v0.2.5／開発ルール32章）
// ============================================================

test('2本指の真ん中と距離を、正しく求める', () => {
  const a = { x: 100, y: 200 };
  const b = { x: 300, y: 200 };
  assert.deepEqual(pinchMidpoint(a, b), { x: 200, y: 200 });
  assert.equal(pinchDistance(a, b), 200);
  // 順番を入れ替えても同じ
  assert.deepEqual(pinchMidpoint(b, a), { x: 200, y: 200 });
  assert.equal(pinchDistance(b, a), 200);
});

// 図面の座標と画面の座標を行き来する、試験用の簡単な変換。
// viewport.js と同じで、**Y軸は上下が逆**（CADは上向き、画面は下向き）。
function 変換をつくる(scale, offsetX, offsetY) {
  return {
    toScreen: (x, y) => [(x - offsetX) * scale, (offsetY - y) * scale],
    toDrawing: (sx, sy) => [sx / scale + offsetX, offsetY - sy / scale],
  };
}

test('四角を図面の座標へ直して戻すと、元どおりになる', () => {
  const v = 変換をつくる(2, 50, 400);
  const 元 = { x: 120, y: 80, width: 300, height: 200 };
  const 図面での範囲 = rectToDrawing(元, v.toDrawing);
  const 戻り = rectFromDrawing(図面での範囲, v.toScreen);
  for (const k of ['x', 'y', 'width', 'height']) {
    assert.ok(
      Math.abs(戻り[k] - 元[k]) < 1e-9,
      `${k} が戻っていない（${元[k]} → ${戻り[k]}）`
    );
  }
});

test('【いちばん大事】拡大しても、四角は図面の同じ場所を指し続ける', () => {
  // これが無いと、図面だけが動いて四角は画面に取り残され、
  // 「囲んだつもりの場所」と「実際に印刷される場所」がずれる。
  const 前 = 変換をつくる(2, 50, 400);
  const 四角 = { x: 120, y: 80, width: 300, height: 200 };
  const 図面での範囲 = rectToDrawing(四角, 前.toDrawing);

  // 3倍に拡大し、位置もずらした（ピンチしたのと同じこと）
  const 後 = 変換をつくる(6, 90, 360);
  const 新しい四角 = rectFromDrawing(図面での範囲, 後.toScreen);

  // 新しい四角を、拡大後の変換で図面の座標に直すと、元と同じ範囲になるはず
  const 直した = rectToDrawing(新しい四角, 後.toDrawing);
  for (const k of ['minX', 'minY', 'maxX', 'maxY']) {
    assert.ok(
      Math.abs(直した[k] - 図面での範囲[k]) < 1e-9,
      `図面の ${k} がずれた（${図面での範囲[k]} → ${直した[k]}）`
    );
  }
  // 3倍に拡大したので、画面の上では3倍の大きさになる
  assert.ok(Math.abs(新しい四角.width - 四角.width * 3) < 1e-9, '横が3倍になっていない');
  assert.ok(Math.abs(新しい四角.height - 四角.height * 3) < 1e-9, '縦が3倍になっていない');
});

test('縮小しても、幅・高さが負にならない（上下が逆でも壊れない）', () => {
  // viewport.js はY軸をひっくり返すので、変換の向きを取り違えると
  // 高さが負になって、四角が消えたように見える
  const v = 変換をつくる(0.25, 1000, 2000);
  const 図面での範囲 = { minX: 100, minY: 100, maxX: 400, maxY: 300 };
  const r = rectFromDrawing(図面での範囲, v.toScreen);
  assert.ok(r.width > 0, `横が ${r.width}`);
  assert.ok(r.height > 0, `縦が ${r.height}`);
});

// ------------------------------------------------------------
// 画面の作り（ソースを読んで確かめる）
// ------------------------------------------------------------

test('指2本のときは、範囲を囲まずに図面を拡大縮小する', () => {
  const js = read('src/ui/print-ui.js');
  assert.match(js, /pointers\.size >= 2/, '2本目の指を見分けていない');
  assert.match(js, /function switchToPinch/, '2本指の操作に切り替える処理が無い');
  assert.match(js, /handlers\.onZoom/, '拡大縮小を呼び出していない');
  assert.match(js, /handlers\.onPan/, '移動を呼び出していない');
});

test('拡大縮小したとき、四角を図面に貼り付け直している', () => {
  // ここを忘れると、図面だけ動いて四角が取り残される
  const js = read('src/ui/print-ui.js');
  const i = js.indexOf('function moveView');
  assert.ok(i >= 0, '図面を動かす処理が無い');
  const body = js.slice(i, js.indexOf('\n  }\n', i));
  assert.match(body, /rectToDrawing/, '動かす前に図面の座標へ直していない');
  assert.match(body, /rectFromDrawing/, '動かしたあとに画面の座標へ戻していない');
});

test('図面の座標との行き来を、print-ui.js が自前で計算していない', () => {
  // 座標の変換は viewport.js だけの仕事（開発ルール10.6）。
  // ここで自前にY軸をひっくり返すと、直す場所が2か所になって必ず食い違う。
  const js = read('src/ui/print-ui.js');
  assert.match(js, /handlers\.toDrawing/, '呼び出し側からの変換を使っていない');
  assert.match(js, /handlers\.toScreen/, '呼び出し側からの変換を使っていない');
  assert.ok(
    !/offsetY|vp\.scale/.test(js),
    'print-ui.js が自分で座標の計算をしている（viewport.js に任せること）'
  );
});

test('app.js が、拡大縮小の道を print-ui につないでいる', () => {
  const app = read('src/ui/app.js');
  const i = app.indexOf('const printUi = createPrintUi(');
  assert.ok(i >= 0, 'printUi を作っていない');
  const body = app.slice(i, app.indexOf('\n});', i));
  assert.match(body, /onZoom:/, '拡大縮小をつないでいない');
  assert.match(body, /onPan:/, '移動をつないでいない');
  assert.match(body, /toDrawing:/, '図面の座標への変換をつないでいない');
  assert.match(body, /toScreen:/, '画面の座標への変換をつないでいない');
  assert.match(body, /viewportMod\.zoomAt/, 'viewport.js の拡大縮小を使っていない');
});

test('縮小してから印刷しても「範囲が小さすぎます」と断られない', () => {
  // 図面ぜんたいを見ようと縮小すると、四角は画面上では小さく見える。
  // だが範囲そのものは変わっていないので、断ってはいけない。
  const js = read('src/ui/print-ui.js');
  assert.match(js, /sizedRect/, '囲んだときの大きさを渡していない');
  const app = read('src/ui/app.js');
  assert.match(
    app,
    /isAreaBigEnough\(info\.sizedRect \|\| rectScreen\)/,
    '囲んだときの大きさで判定していない'
  );
});

test('モードから抜けるとき、おさえている指の記録も空に戻す', () => {
  // 残ると「触っていないのに図面が動き続ける」不具合になる（gestures.js と同じ事故対策）
  const js = read('src/ui/print-ui.js');
  const i = js.indexOf('function teardown');
  assert.ok(i >= 0, '後片付けが無い');
  const body = js.slice(i, js.indexOf('\n  }\n', i));
  assert.match(body, /pointers\.clear\(\)/, '指の記録を消していない');
});

test('2本指の説明が、画面に出ている', () => {
  // 出していないと、そもそも拡大縮小できることに気づかない
  const js = read('src/ui/print-ui.js');
  assert.match(js, /2本指で図面を拡大・縮小できます/, '案内が無い');
});

// ============================================================
// パソコンでも図面を動かせる（v0.2.6／開発ルール33章）
// ============================================================

test('パソコンでも、図面を動かす手が用意してある', () => {
  // 【実機で見つかった不具合】
  // パソコンには指2本が無い。左ボタンで引っぱるのは「範囲を囲む」なので、
  // 拡大縮小はできるのに**図面を動かす手が1つも無かった。**
  const js = read('src/ui/print-ui.js');
  const i = js.indexOf('function isMousePan');
  assert.ok(i >= 0, 'マウスで図面を動かす判定が無い');
  const body = js.slice(i, js.indexOf('\n  }\n', i));
  assert.match(body, /button === 1/, 'ホイールボタンで動かせない（AutoCADと同じ操作）');
  assert.match(body, /shiftKey/, 'Shiftキーで動かせない（ホイールボタンが無いとき用）');
  assert.match(js, /'panning'/, '図面を動かしている最中の状態が無い');
});

test('マウスで図面を動かしても、四角は図面についてくる', () => {
  // 拡大縮小のときと同じ。ここを忘れると、動かしたぶんだけ印刷位置がずれる
  const js = read('src/ui/print-ui.js');
  const i = js.indexOf("if (phase === 'panning' && ev.pointerId === activePointerId)");
  assert.ok(i >= 0, 'マウスで動かす処理が無い');
  // この if の中だけを見る（あとに出てくるピンチの処理を巻き込まないように）
  const body = js.slice(i, js.indexOf('\n    }\n', i));
  assert.match(body, /handlers\.onPan/, '図面を動かしていない');
  assert.match(body, /moveView\(/, '四角を図面に貼り付け直していない');
});

test('マウスの左ボタンは、今までどおり「範囲を囲む」', () => {
  // ここを変えると、囲めなくなる
  const js = read('src/ui/print-ui.js');
  assert.match(
    js,
    /ev\.pointerType === 'mouse' && ev\.button !== 0/,
    '左ボタン以外を除けていない（右クリックで囲み始めてしまう）'
  );
});

test('図面を動かし終わったときの後始末が、1か所にまとまっている', () => {
  // ピンチとマウスで別々に書くと、片方だけ直し忘れる
  const js = read('src/ui/print-ui.js');
  assert.match(js, /function endViewGesture/, '後始末が1か所にまとまっていない');
  const i = js.indexOf('function endViewGesture');
  const body = js.slice(i, js.indexOf('\n  }\n', i));
  assert.match(body, /panPrev = null/, 'マウスの位置を消していない');
  assert.match(body, /settle\(currentRect, false\)/, '囲んだときの大きさを上書きしている');
});

test('操作の案内を、使っている機械に合わせて出し分けている', () => {
  // パソコンの人に「2本指で」と書いても分からない（開発ルール33.3）
  const js = read('src/ui/print-ui.js');
  const i = js.indexOf('function 動かし方の案内');
  assert.ok(i >= 0, '案内の出し分けが無い');
  const body = js.slice(i, js.indexOf('\n}\n', i));
  assert.match(body, /2本指/, '指で触る機械むけの案内が無い');
  assert.match(body, /ホイール/, 'パソコンむけの案内が無い');
  assert.match(js, /pointer: coarse/, '機械の見分け方が無い');
});

test('機械の見分けに失敗しても落ちない', () => {
  // matchMedia が無い・例外を投げる環境でも、案内が出せないだけで動くこと
  const js = read('src/ui/print-ui.js');
  const i = js.indexOf('function 指で触る機械か');
  assert.ok(i >= 0, '見分ける処理が無い');
  const body = js.slice(i, js.indexOf('\n}\n', i));
  assert.match(body, /try\s*\{/, '例外を受け止めていない');
  assert.match(body, /matchMedia !== 'function'/, 'matchMedia が無い環境を見ていない');
});
