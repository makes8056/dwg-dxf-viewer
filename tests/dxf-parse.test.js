// tests/dxf-parse.test.js — DXF読み込み（src/dxf-parse.js）のテスト
//
// 動かし方：  node --test
// 見本のDXFは tests/fixtures/ にあります。手で書いた小さな図面です。
//
// ここで確かめている値は、司令塔が1つずつ手で検算したものです。
// 「今そう出るから」ではなく「そうでなければ図面が間違って表示される」値を書いています。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDxf, decodeDxfBuffer } from '../src/dxf-parse.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name) => parseDxf(readFileSync(join(FIXTURES, name), 'utf8'));

/** 図形の中から、指定した種類のものだけ取り出す。 */
const only = (drawing, type) => drawing.entities.filter((e) => e.type === type);

/** 小数の誤差を許して比べる。 */
const near = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}（実際は ${actual}、正しくは ${expected}）`);
};

// ============================================================
// 直線（いちばん基本）
// ============================================================

test('直線だけの図面：本数と座標が合っている', () => {
  const d = load('simple-lines.dxf');
  assert.equal(d.entities.length, 3, '直線が3本のはず');
  assert.equal(d.source, 'dxf');
  assert.deepEqual(d.bounds, { minX: 0, minY: 0, maxX: 100, maxY: 50 });

  const [a, b, c] = d.entities;
  assert.deepEqual([a.x1, a.y1, a.x2, a.y2], [0, 0, 100, 0]);
  assert.deepEqual([b.x1, b.y1, b.x2, b.y2], [100, 0, 100, 50]);
  assert.deepEqual([c.x1, c.y1, c.x2, c.y2], [100, 50, 0, 0]);
});

test('色番号7（CADの白）の線は、白背景で見えるよう黒になる', () => {
  const d = load('simple-lines.dxf');
  assert.equal(d.entities[0].color, '#000000');
  assert.equal(d.entities[2].color, '#ff0000', '色番号1は赤のまま');
});

// ============================================================
// いろいろな図形
// ============================================================

test('円・円弧・文字がそれぞれ正しく読める', () => {
  const d = load('shapes.dxf');

  const circle = only(d, 'circle')[0];
  assert.deepEqual([circle.cx, circle.cy, circle.r], [50, 50, 20]);

  const text = only(d, 'text')[0];
  assert.equal(text.text, 'テスト文字', '日本語の文字が読めていない');
  assert.deepEqual([text.x, text.y, text.height, text.rotation], [200, 200, 5, 30]);
});

test('ふくらみ（bulge）付きの折れ線は、直線ではなく円弧になる', () => {
  // ここを直線で結んでしまうと、配管の曲がりが直角に見えてしまい図面が変わる。
  // 見本では (0,100)→(50,100) が直線、(50,100)→(100,100) が ふくらみ1.0（半円）。
  const d = load('shapes.dxf');
  const arcs = only(d, 'arc');

  // ARC図形が1つと、ふくらみから作られた円弧が1つで、合わせて2つになるはず
  assert.equal(arcs.length, 2, 'ふくらみが円弧になっていない');

  const fromBulge = arcs.find((a) => a.cx === 75);
  assert.ok(fromBulge, 'ふくらみから作られた円弧が見つからない');
  near(fromBulge.cy, 100, '円弧の中心のY');
  near(fromBulge.r, 25, 'ふくらみ1.0は半円なので半径は弦の半分');
});

test('ARC図形の角度がそのまま読める（度・反時計回り）', () => {
  const d = load('shapes.dxf');
  const arc = only(d, 'arc').find((a) => a.cx === 0 && a.cy === 0);
  assert.ok(arc, '原点の円弧が見つからない');
  assert.equal(arc.r, 10);
  assert.equal(arc.startAngle, 0);
  assert.equal(arc.endAngle, 90);
});

// ============================================================
// ブロックの展開（開発ルール10.4）
// ============================================================

test('ブロックは展開され、入れ子のまま残らない', () => {
  const d = load('with-block.dxf');
  // 直線4本のブロックを3回差し込んでいるので 12本
  assert.equal(d.entities.length, 12, 'ブロックが展開されていない');
  assert.ok(d.entities.every((e) => e.type === 'line'), '直線以外が混ざっている');
});

test('ブロックの差し込み位置が反映される', () => {
  const d = load('with-block.dxf');
  // 1つ目は (100,0) に置いた 10x10 の四角
  const box = d.entities.slice(0, 4);
  const xs = box.flatMap((e) => [e.x1, e.x2]);
  const ys = box.flatMap((e) => [e.y1, e.y2]);
  assert.equal(Math.min(...xs), 100);
  assert.equal(Math.max(...xs), 110);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 10);
});

test('ブロックの拡大率が反映される', () => {
  const d = load('with-block.dxf');
  // 2つ目は 原点に2倍で置いた 10x10 → 20x20 になるはず
  const box = d.entities.slice(4, 8);
  const xs = box.flatMap((e) => [e.x1, e.x2]);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...xs), 20, '拡大率が効いていない');
});

test('ブロックの回転が反映される', () => {
  const d = load('with-block.dxf');
  // 3つ目は (0,100) に90度回して置いた 10x10。
  // 90度回すと右へ伸びていた辺が上へ、上へ伸びていた辺が左へ向く。
  const box = d.entities.slice(8, 12);
  const xs = box.flatMap((e) => [e.x1, e.x2]);
  const ys = box.flatMap((e) => [e.y1, e.y2]);
  near(Math.min(...xs), -10, '回転後の左端');
  near(Math.max(...xs), 0, '回転後の右端');
  near(Math.min(...ys), 100, '回転後の下端');
  near(Math.max(...ys), 110, '回転後の上端');
});

// ============================================================
// レイヤーと色
// ============================================================

test('レイヤーの一覧と色が読める', () => {
  const d = load('layers-colors.dxf');
  const byName = Object.fromEntries(d.layers.map((l) => [l.name, l.color]));
  assert.equal(byName['赤レイヤー'], '#ff0000');
  assert.equal(byName['青レイヤー'], '#0000ff');
});

test('レイヤーに従う色（BYLAYER）が、そのレイヤーの色になる', () => {
  // ここを間違えると、図面全体が真っ黒か真っ赤になって見分けがつかなくなる
  const d = load('layers-colors.dxf');
  assert.equal(d.entities[0].color, '#ff0000', '赤レイヤーのBYLAYERが赤になっていない');
  assert.equal(d.entities[1].color, '#0000ff', '青レイヤーのBYLAYERが青になっていない');
});

test('図形に直接指定された色は、レイヤーの色より優先される', () => {
  const d = load('layers-colors.dxf');
  assert.equal(d.entities[2].color, '#0000ff', '赤レイヤーだが図形は青指定なので青');
});

test('24ビットの色指定（true color）も読める', () => {
  const d = load('layers-colors.dxf');
  assert.equal(d.entities[3].color, '#ff0000');
});

// ============================================================
// 対応していない図形（開発ルール10.5：黙って捨てない）
// ============================================================

test('対応していない図形は、捨てずに種類ごとに数える', () => {
  // 黙って消すと、現場で図面が欠けていることに気づけない。これがいちばん危ない。
  const d = load('unsupported.dxf');
  assert.equal(d.entities.length, 1, '対応している直線1本だけが残るはず');
  assert.equal(d.unsupported.count, 4);
  assert.equal(d.unsupported.kinds.SPLINE, 2);
  assert.equal(d.unsupported.kinds.HATCH, 1);
  assert.equal(d.unsupported.kinds.ELLIPSE, 1);
});

// ============================================================
// 押し出し方向（左右反転）
// ============================================================

test('押し出し方向のZが -1 の図形は左右が反転する', () => {
  // 見落とすと図面が鏡写しになり、現場で寸法を読み違える。
  const d = load('extrusion-flip.dxf');
  const [normal, flipped] = d.entities;
  assert.deepEqual([normal.x1, normal.x2], [10, 20], 'Zが1の線は反転しない');
  assert.deepEqual([flipped.x1, flipped.x2], [-10, -20], 'Zが-1の線が反転していない');
});

// ============================================================
// 文字コード（日本の図面はShift-JISが多い）
// ============================================================

test('Shift-JISで書かれたDXFから、日本語の文字が読める', () => {
  // 日本の現場のDXFはShift-JISが多い。UTF-8だと決めつけると文字化けする。
  const head = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$DWGCODEPAGE', '3', 'ANSI_932',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'TEXT', '8', '0', '62', '7',
    '10', '0.0', '20', '0.0', '40', '5.0', '1', '',
  ].join('\r\n');
  const tail = ['', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n');

  // 「配管」のShift-JISのバイト列
  const kanji = [0x94, 0x7a, 0x8a, 0xc7];
  const bytes = [
    ...Array.from(head, (c) => c.charCodeAt(0)),
    ...kanji,
    ...Array.from(tail, (c) => c.charCodeAt(0)),
  ];
  const buffer = new Uint8Array(bytes).buffer;

  const text = decodeDxfBuffer(buffer);
  const d = parseDxf(text);
  const t = d.entities.find((e) => e.type === 'text');
  assert.ok(t, '文字が読めていない');
  assert.equal(t.text, '配管', 'Shift-JISの日本語が文字化けしている');
});

test('UTF-8で書かれたDXFも、そのまま読める', () => {
  const bytes = new TextEncoder().encode(readFileSync(join(FIXTURES, 'shapes.dxf'), 'utf8'));
  const d = parseDxf(decodeDxfBuffer(bytes.buffer));
  const t = d.entities.find((e) => e.type === 'text');
  assert.equal(t.text, 'テスト文字');
});

// ============================================================
// 壊れたファイル・特殊なファイル（現場で図面が開けないのがいちばん困る）
// ============================================================

test('バイナリ形式のDXFは、日本語で分かるエラーになる', () => {
  assert.throws(
    () => parseDxf('AutoCAD Binary DXF\r\n '),
    (e) => {
      assert.match(e.message, /バイナリ/, 'エラーの説明が日本語になっていない');
      assert.match(e.message, /DXF/);
      return true;
    }
  );
});

test('途中で切れたDXFでも落ちず、読めたところまで返す', () => {
  const full = readFileSync(join(FIXTURES, 'simple-lines.dxf'), 'utf8');
  const cut = full.slice(0, Math.floor(full.length * 0.6));
  const d = parseDxf(cut); // 例外を投げないこと自体がテスト
  assert.ok(Array.isArray(d.entities), '図形の入れ物が返ってこない');
});

test('中身が空でも落ちない', () => {
  const d = parseDxf('');
  assert.equal(d.entities.length, 0);
  assert.equal(d.bounds, null);
});

test('改行が CRLF でも LF でも同じ結果になる', () => {
  // Windowsで作った図面とMacで作った図面で結果が変わってはいけない
  const lf = readFileSync(join(FIXTURES, 'simple-lines.dxf'), 'utf8').replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.deepEqual(parseDxf(lf).entities, parseDxf(crlf).entities);
});
