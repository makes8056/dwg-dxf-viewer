// tests/measure.test.js — 長さを測る計算のテスト（開発ルール39章）
//
// 【なぜ「吸い付き」が要るのか】
// 指で正確な位置をタップするのは無理である。1ミリずれれば、測った長さも1ミリ狂う。
// それでは現場で使えないので、近くの「線の端・真ん中・円の中心」へ吸い付かせる。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SNAP_RADIUS_PX,
  insunitsToUnits,
  unitLabel,
  formatLength,
  formatAngle,
  measureBetween,
  forEachSnapPoint,
  findSnapPoint,
} from '../src/measure.js';
import { parseDxf } from '../src/dxf-parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = (name) => read(path.join('tests', 'fixtures', name));

const 集める = (e) => {
  const out = [];
  forEachSnapPoint(e, (x, y, kind) => out.push({ x, y, kind }));
  return out;
};

// ============================================================
// 吸い付く先
// ============================================================

test('線は、両端と真ん中に吸い付く', () => {
  const pts = 集める({ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 });
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map((p) => [p.x, p.y]), [[0, 0], [100, 0], [50, 0]]);
  assert.deepEqual(pts.map((p) => p.kind), ['端', '端', '真ん中']);
});

test('円は、中心と上下左右に吸い付く', () => {
  const pts = 集める({ type: 'circle', cx: 10, cy: 20, r: 5 });
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], { x: 10, y: 20, kind: '中心' });
  const 円周 = pts.slice(1).map((p) => [p.x, p.y]);
  assert.deepEqual(円周, [[15, 20], [5, 20], [10, 25], [10, 15]]);
});

test('円弧は、中心と両端に吸い付く', () => {
  const pts = 集める({ type: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: 90 });
  assert.equal(pts.length, 3);
  assert.deepEqual(pts[0], { x: 0, y: 0, kind: '中心' });
  assert.ok(Math.abs(pts[1].x - 10) < 1e-9 && Math.abs(pts[1].y) < 1e-9, '0度の端が違う');
  assert.ok(Math.abs(pts[2].x) < 1e-9 && Math.abs(pts[2].y - 10) < 1e-9, '90度の端が違う');
});

test('折れ線は、すべての角に吸い付く', () => {
  const pts = 集める({ type: 'polyline', points: [[0, 0], [10, 0], [10, 10]] });
  assert.equal(pts.length, 3);
  assert.ok(pts.every((p) => p.kind === '角'));
});

test('点は、その点に吸い付く', () => {
  const pts = 集める({ type: 'point', x: 3, y: 4 });
  assert.deepEqual(pts, [{ x: 3, y: 4, kind: '点' }]);
});

test('文字には吸い付かない（形が無いため）', () => {
  assert.deepEqual(集める({ type: 'text', x: 0, y: 0, height: 10, text: 'あ' }), []);
});

// ============================================================
// いちばん近い点をさがす
// ============================================================

const 図形 = [
  { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 100, y2: 0 },
  { type: 'circle', layer: '0', color: '#000', cx: 200, cy: 0, r: 20 },
];

test('少しずれてタップしても、線の端に吸い付く', () => {
  // 【これが無いと現場で使えない】指の誤差がそのまま長さの誤差になる
  const p = findSnapPoint(図形, 3, -4, 20);
  assert.deepEqual([p.x, p.y], [0, 0]);
  assert.equal(p.kind, '端');
});

test('いちばん近い点が選ばれる', () => {
  // 真ん中（50,0）のほうが近い場所をタップする
  const p = findSnapPoint(図形, 48, 2, 20);
  assert.deepEqual([p.x, p.y], [50, 0]);
  assert.equal(p.kind, '真ん中');
});

test('吸い付く範囲に2つ以上あるときも、いちばん近いほうが選ばれる', () => {
  // 【ここを「最初に見つけたもの」にすると、狙っていない点に吸い付く】
  // 配管の継ぎ目のように、点が近くに集まっているところで必ず起きる
  const 二つ = [
    { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: -50, y2: 0 },
    { type: 'line', layer: '0', color: '#000', x1: 10, y1: 0, x2: 60, y2: 0 },
  ];
  // (9,0) は (10,0) に1、(0,0) に9 の近さ。どちらも範囲20の中にある
  const p = findSnapPoint(二つ, 9, 0, 20);
  assert.deepEqual([p.x, p.y], [10, 0], '遠いほうに吸い付いている');

  // 逆向きでも同じ（並び順に左右されないこと）
  const q = findSnapPoint(二つ, 1, 0, 20);
  assert.deepEqual([q.x, q.y], [0, 0], '並び順で結果が変わっている');
});

test('近くに何も無ければ、吸い付かない（null を返す）', () => {
  assert.equal(findSnapPoint(図形, 1000, 1000, 20), null);
});

test('吸い付く範囲を超えたら、吸い付かない', () => {
  assert.equal(findSnapPoint(図形, 0, 30, 20), null, '範囲の外なのに吸い付いている');
  assert.ok(findSnapPoint(図形, 0, 15, 20), '範囲の中なのに吸い付かない');
});

test('図形がからっぽでも落ちない', () => {
  assert.equal(findSnapPoint([], 0, 0, 20), null);
  assert.equal(findSnapPoint(null, 0, 0, 20), null);
  assert.equal(findSnapPoint(図形, 0, 0, 0), null, '範囲0で吸い付いている');
});

// ============================================================
// 長さと向き
// ============================================================

test('2点の間の長さと向きが正しい', () => {
  const m = measureBetween({ x: 0, y: 0 }, { x: 3, y: 4 });
  assert.equal(m.distance, 5);
  assert.equal(m.dx, 3);
  assert.equal(m.dy, 4);
  assert.ok(Math.abs(m.angleDeg - 53.130102) < 1e-4);
});

test('45度の向きが、45度と出る', () => {
  // 配管は45度のエルボをよく使うので、ここがずれると困る
  const m = measureBetween({ x: 0, y: 0 }, { x: 100, y: 100 });
  assert.ok(Math.abs(m.angleDeg - 45) < 1e-9);
  assert.equal(formatAngle(m.angleDeg), '45.0°');
});

// ============================================================
// 見せ方
// ============================================================

test('長さは、3桁ごとに区切って読みやすく出す', () => {
  assert.equal(formatLength(1234.56, 'mm'), '1,234.6 mm');
  assert.equal(formatLength(400, 'mm'), '400 mm');
  assert.equal(formatLength(12.345, 'mm'), '12.35 mm');
  assert.equal(formatLength(0, 'mm'), '0 mm');
});

test('単位は、図面の単位に合わせて変わる', () => {
  assert.equal(formatLength(5, 'm'), '5 m');
  assert.equal(formatLength(5, 'cm'), '5 cm');
  assert.equal(unitLabel('inch'), 'インチ');
});

test('おかしな数でも落ちない', () => {
  assert.equal(formatLength(NaN, 'mm'), '—');
  assert.equal(formatLength(Infinity, 'mm'), '—');
  assert.equal(formatAngle(NaN), '—');
});

// ============================================================
// 図面の単位（$INSUNITS）
// ============================================================

test('図面の単位を、DXFのヘッダーから読む', () => {
  assert.equal(insunitsToUnits(4), 'mm');
  assert.equal(insunitsToUnits(5), 'cm');
  assert.equal(insunitsToUnits(6), 'm');
  assert.equal(insunitsToUnits(1), 'inch');
});

test('単位が書いていない図面は、ミリとみなす', () => {
  // 日本の建築・設備の図面はミリで描くのがふつう。実物の図面も4（ミリ）だった
  assert.equal(insunitsToUnits(0), 'mm');
  assert.equal(insunitsToUnits(undefined), 'mm');
  assert.equal(insunitsToUnits(999), 'mm');
});

test('読み込んだ図面に、単位が入っている', () => {
  const d = parseDxf(fixture('point.dxf'));
  assert.ok(['mm', 'cm', 'm', 'inch', 'feet'].includes(d.units), `単位が変（${d.units}）`);
});

// ============================================================
// つなぎ方
// ============================================================

test('吸い付く範囲は、指で押せる大きさ', () => {
  // 手袋をした指でも狙えるように（開発ルール11章）
  assert.ok(SNAP_RADIUS_PX >= 24, `吸い付く範囲が ${SNAP_RADIUS_PX}px しかない`);
});

test('吸い付く範囲は、拡大率で割ってから使う', () => {
  // 画面の34ピクセルが、図面の上で何ミリになるかは拡大率で変わる。
  // ここを間違えると、拡大しても細かく狙えない（または広すぎて別の点に吸い付く）
  const app = read('src/ui/app.js');
  assert.match(app, /SNAP_RADIUS_PX \/ \(vp\.scale/, '拡大率で割っていない');
});

test('測る画面は、指を通す（図面の拡大縮小を邪魔しない）', () => {
  // 【32章・33章で作った拡大縮小を、作り直さないための決まり】
  // 板をかぶせて指を全部受け取ると、拡大縮小をもう一度作ることになる
  const css = read('src/ui/measure-ui.css');
  const i = css.indexOf('.ms-root');
  const body = css.slice(i, css.indexOf('}', i));
  assert.match(body, /pointer-events:\s*none/, '指を通していない。図面が動かせなくなる');
});

test('図面を動かしたら、測った印も置き直す', () => {
  // ここを忘れると、印だけ取り残されて別の場所を測ったように見える
  const app = read('src/ui/app.js');
  const i = app.indexOf('function redraw()');
  assert.ok(i >= 0, '描き直しが見つからない');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.match(body, /measureUi\.refresh\(\)/, '印を置き直していない');
});

test('測る画面と、範囲を囲む画面は同時に出さない', () => {
  const app = read('src/ui/app.js');
  assert.match(app, /if \(printUi\.isActive\(\)\) printUi\.stop\(\)/, '囲む画面を閉じていない');
  assert.match(app, /if \(measureUi\.isActive\(\)\) measureUi\.stop\(\)/, '測る画面を閉じていない');
});

test('どこに吸い付いたかを、画面に出す', () => {
  // 縮小したまま測ると吸い付く範囲が図面の上ではとても広くなり、
  // 狙っていない点に吸い付いても気づけない（39.4）
  const ui = read('src/ui/measure-ui.js');
  assert.match(ui, /合わせた先/, '何に合わせたかを出していない');
});

test('測った線は、紙には印刷しない', () => {
  const css = read('src/ui/measure-ui.css');
  assert.match(
    css,
    /@media\s+print\s*\{[\s\S]*?\.ms-root[\s\S]*?display\s*:\s*none/,
    '測った印が紙に印刷されてしまう'
  );
});

// ============================================================
// 寸法線に引っ張られないようにする（開発ルール41章）
//
// 【実機で言われたこと】「寸法線の方に引っ張られる場合がある」
// 寸法線は測りたい線のすぐ横に平行に引かれ、端も同じところで揃うため、
// 狙った線をタップしたつもりでも寸法線に吸い付く。
// ============================================================

/** 本物の線（y=0）と、その上を平行に走る寸法線（y=5）。実物の図面と同じ並び。 */
const 線と寸法線 = [
  { type: 'line', layer: '0', color: '#000', x1: 0, y1: 5, x2: 100, y2: 5, fromDimension: true },
  { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 100, y2: 0 },
];

test('寸法線のほうが少し近くても、本物の線が勝つ', () => {
  // (0,3) は 本物(0,0) まで3、寸法線(0,5) まで2。寸法線のほうが近い。
  // それでも本物が勝つ。ここが直したかったところ。
  const p = findSnapPoint(線と寸法線, 0, 3, 20);
  assert.deepEqual([p.x, p.y], [0, 0], '寸法線に引っ張られている');
});

test('寸法線がはっきり近ければ、寸法線が選ばれる（3倍まで我慢する）', () => {
  // 【これは正しい動き】寸法線そのものを測りたいこともある。
  // 後回しにするだけで、選べなくしてはいけない。
  // (0,4.5) は 本物まで4.5、寸法線まで0.5。9倍も近いので、さすがに寸法線が正しい。
  const p = findSnapPoint(線と寸法線, 0, 4.5, 20);
  assert.deepEqual([p.x, p.y], [0, 5], '寸法線を選べなくなっている');
});

test('近くに寸法線しか無ければ、寸法線に吸い付く', () => {
  // 【外してはいけない理由】
  // 「この寸法線の端から端まで」を測りたいことが実際にある。
  // 後回しにするだけで、無かったことにはしない。
  const 図形 = [
    { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 100, y2: 0, fromDimension: true },
  ];
  const p = findSnapPoint(図形, 2, 1, 20);
  assert.ok(p, '寸法線しか無いのに、どこにも吸い付かない');
  assert.deepEqual([p.x, p.y], [0, 0]);
});

test('寸法線に吸い付いたことが、名前で分かる', () => {
  // 縮小したまま測ると狙いを外しても気づけないので、何に合わせたかを見せる（39.4）
  const 図形 = [
    { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 100, y2: 0, fromDimension: true },
  ];
  assert.equal(findSnapPoint(図形, 0, 0, 20).kind, '寸法の端');
});

test('後回しにしても、吸い付く範囲そのものは広がらない', () => {
  // 重みを掛けるやり方だと、うっかり範囲まで広げてしまいやすい
  const 図形 = [
    { type: 'line', layer: '0', color: '#000', x1: 0, y1: 0, x2: 100, y2: 0, fromDimension: true },
  ];
  assert.equal(findSnapPoint(図形, 0, 30, 20), null, '範囲の外なのに吸い付いている');
});

test('寸法から作った線には、印が付いている', () => {
  // この印が無いと、上の後回しがまったく効かない
  const d = parseDxf(fixture('dimension.dxf'));
  const 寸法 = d.entities.filter((e) => e.fromDimension);
  assert.ok(寸法.length > 0, '寸法から作った図形に印が付いていない');
  const ふつう = d.entities.filter((e) => !e.fromDimension);
  assert.ok(ふつう.length > 0, 'ふつうの図形にまで印が付いている');
});

// ============================================================
// 「終わる」ボタン（開発ルール41章）
//
// 【実機で起きたこと】押しても反応がない。エラーも出ない。
// 原因は、ファイルの中に無い stop() を呼んでいたこと。
// ブラウザには window.stop（ページの読み込みを止めるもの）が最初からあるので、
// **エラーにならず、静かに何も起きなかった。**
// ============================================================

/**
 * ブラウザが最初から持っていて、うっかり呼んでも
 * エラーにならずに「何も起きない」ように見える名前たち。
 * 自前の関数のつもりで呼ぶと、事故がまったく表に出ない。
 */
const 名前がぶつかるもの = [
  'stop', 'close', 'open', 'print', 'focus', 'blur', 'find', 'scroll', 'alert',
];

test('画面の部品が、ブラウザの同名の機能をうっかり呼んでいない', () => {
  const 調べるファイル = [
    'src/ui/measure-ui.js',
    'src/ui/print-ui.js',
    'src/ui/print-preview.js',
    'src/ui/drawing-list.js',
  ];

  for (const 相対 of 調べるファイル) {
    const src = read(相対);
    for (const 名前 of 名前がぶつかるもの) {
      // 「.名前(」ではない、裸の「名前(」を呼んでいるか
      const 呼んでいる = new RegExp(String.raw`(^|[^.\w$])` + 名前 + String.raw`\s*\(`, 'm').test(src);
      if (!呼んでいる) continue;

      // 呼んでいるなら、そのファイルの中で定義されているはず
      const 定義されている = new RegExp(
        String.raw`function\s+` + 名前 + String.raw`\s*\(` +
          String.raw`|(?:const|let|var)\s+` + 名前 + String.raw`\s*=`
      ).test(src);
      assert.ok(
        定義されている,
        `${相対} が ${名前}() を呼んでいるのに、このファイルの中で定義していません。\n` +
          `ブラウザの window.${名前} が呼ばれ、**エラーも出ずに何も起きません。**\n` +
          '（実機で「終わるボタンが効かない」となった原因そのものです）'
      );
    }
  }
});

test('「終わる」ボタンは、測っている途中でも画面にある', () => {
  // 【以前どうだったか】2点そろうまで結果の箱ごと隠していた。
  // そのため測りかけのときは、抜けるボタンが画面のどこにも無かった。
  const ui = read('src/ui/measure-ui.js');
  const 作る場所 = ui.slice(ui.indexOf('root.innerHTML'), ui.indexOf('document.body.appendChild'));
  assert.match(作る場所, /ms-close/, '「終わる」ボタンが無い');
  assert.doesNotMatch(
    作る場所,
    /<div class="ms-result" hidden>/,
    '結果の箱を最初から隠している。測っている途中に抜けられなくなる'
  );
});

test('1点だけやり直せる道がある', () => {
  // 実機で「修正ができないので何回もやり直しになる」と言われた
  // 【ゆるく見てはいけない】「ms-undo」という字を探すだけだと、
  // ボタンを消しても querySelector('.ms-undo') の行が残っていて通ってしまう。
  // 実際のボタンの書き方そのものを見る。
  const ui = read('src/ui/measure-ui.js');
  assert.match(ui, /<button[^>]*class="ms-btn ms-undo"[^>]*>/, '「1つ前にもどる」ボタンが無い');
  assert.match(ui, /points\.pop\(\)/, '1点だけ戻す処理が無い');
});
