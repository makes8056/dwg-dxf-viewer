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
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '62', '7', '10', '0.0', '20', '0.0', '11', '10.0', '21', '0.0',
    // まだ対応していない種類（45章の時点では 3DFACE と MLINE が残っている）
    '0', '3DFACE', '8', '0', '62', '7',
    '10', '0.0', '20', '0.0', '11', '10.0', '21', '0.0', '12', '10.0', '22', '10.0',
    '0', 'MLINE', '8', '0', '62', '7', '10', '0.0', '20', '0.0',
    '0', 'MLINE', '8', '0', '62', '7', '10', '5.0', '20', '5.0',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(d.entities.length, 1, '対応している図形（直線）が残っていない');
  assert.equal(d.unsupported.count, 3);
  assert.equal(d.unsupported.kinds['3DFACE'], 1);
  assert.equal(d.unsupported.kinds.MLINE, 2);
});

test('もう対応した図形は、「表示できませんでした」に数えない（18.4）', () => {
  // 対応済みなのに数え続けると、案内がうそになる。
  // このファイルには 直線1・自由曲線2・囲いの無いハッチング1・楕円1 が入っている。
  const d = load('unsupported.dxf');
  assert.equal(d.unsupported.count, 0, `まだ数えている: ${JSON.stringify(d.unsupported.kinds)}`);
  assert.equal(d.unsupported.kinds.SPLINE, undefined, '自由曲線はもう対応している（45章）');
  assert.equal(d.unsupported.kinds.ELLIPSE, undefined, '楕円はもう対応しているので数えない');
  assert.equal(d.unsupported.kinds.HATCH, undefined, 'ハッチングはもう対応している（38章）');
  // 直線1 ＋ 自由曲線2（折れ線になる） ＋ 楕円1
  assert.equal(only(d, 'polyline').length, 2, '自由曲線が折れ線として出ていない');
  assert.equal(only(d, 'line').length, 1);
  assert.equal(only(d, 'ellipse').length, 1);
});

// ============================================================
// ハッチング（38章）
// ============================================================

test('斜線のハッチングが、囲いの中だけに線として出る', () => {
  // 100×100の四角を、45度・間隔10の斜線で埋めた見本
  const d = load('hatch-pattern.dxf');
  const 線 = d.entities.filter((e) => e.type === 'line');
  assert.ok(線.length >= 10, `斜線が ${線.length} 本しかない。ハッチングが出ていない`);
  assert.equal(d.unsupported.count, 0, 'ハッチングが「表示できませんでした」に数えられている');

  for (const e of 線) {
    // 囲いの外へはみ出していないこと
    for (const [x, y] of [[e.x1, e.y1], [e.x2, e.y2]]) {
      assert.ok(
        x >= -0.001 && x <= 100.001 && y >= -0.001 && y <= 100.001,
        `斜線が四角からはみ出している（${x}, ${y}）`
      );
    }
    // 指定した45度になっていること
    const 角度 = (((Math.atan2(e.y2 - e.y1, e.x2 - e.x1) * 180) / Math.PI % 180) + 180) % 180;
    assert.ok(Math.abs(角度 - 45) < 0.01, `斜線の角度が45度でない（${角度.toFixed(2)}度）`);
  }
});

test('斜線の間隔が、指定したとおりになる', () => {
  // 間隔がずれると、CADで見たハッチングと濃さが変わってしまう
  const d = load('hatch-pattern.dxf');
  const 線 = d.entities.filter((e) => e.type === 'line');
  // 線と直角の向きへ投影して、となりとの差を見る
  const 角 = (Math.PI * 3) / 4;
  const 距離 = 線.map((e) => e.x1 * Math.cos(角) + e.y1 * Math.sin(角)).sort((a, b) => a - b);
  for (let i = 1; i < 距離.length; i++) {
    assert.ok(
      Math.abs(距離[i] - 距離[i - 1] - 10) < 0.001,
      `線と線の間隔が10になっていない（${(距離[i] - 距離[i - 1]).toFixed(3)}）`
    );
  }
});

test('べた塗りのハッチングは、囲いの形だけ描く', () => {
  // 塗りつぶす仕組みが無いので、SOLIDと同じ扱いにしている（38.3）。
  // 何も出さないと、そこに何かある**ことすら**分からなくなる
  const d = load('hatch-solid.dxf');
  const 囲い = d.entities.filter((e) => e.type === 'polyline');
  assert.equal(囲い.length, 1, 'べた塗りの囲いが出ていない');
  assert.equal(囲い[0].closed, true, '囲いが閉じていない');
  assert.equal(囲い[0].points.length, 4, '四角の頂点が4つでない');
  assert.equal(d.unsupported.count, 0);
});

test('囲いの無いハッチングは、何も出さないし数えもしない', () => {
  // ほかの図形にぶら下がっているだけのハッチングがある（実物の図面にあった）。
  // 描くものが無いので、「表示できませんでした」と言うと**無用な心配をかける**（23章）
  const d = load('unsupported.dxf');
  assert.equal(d.unsupported.kinds.HATCH, undefined);
});

// ============================================================
// 点（POINT）
// ============================================================

test('点（POINT）が図形として出る', () => {
  // CADの $PDMODE が 0 のとき、点は小さな丸で表示される（実物の図面で確認）
  const d = load('point.dxf');
  const 点 = d.entities.filter((e) => e.type === 'point');
  assert.equal(点.length, 1, '点が出ていない');
  assert.equal(点[0].x, 30);
  assert.equal(点[0].y, 40);
  assert.equal(d.unsupported.count, 0, '点が「表示できませんでした」に数えられている');
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

// ============================================================
// 実際のお客様の図面（参考図.dxf）で見つかった不具合の再発防止
//
// この2件は、手で書いた見本では見つかりませんでした。
// 実物を読ませて初めて分かったものです。
// ============================================================

test('「Shift-JISです」と書いてあってもUTF-8の図面を、正しく読む', () => {
  // 新しいAutoCAD（AC1021以降）は $DWGCODEPAGE に ANSI_932 と書いたまま、
  // 中身をUTF-8で保存する。申告を信じると、レイヤー名「図面枠」が
  // 「蝗ｳ髱｢譫」のように化ける（実際に化けた）。
  const bytes = readFileSync(join(FIXTURES, 'utf8-mislabeled.dxf'));
  const d = parseDxf(decodeDxfBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));

  const names = d.layers.map((l) => l.name);
  assert.ok(names.includes('既設PIPE'), `レイヤー名が化けている: ${JSON.stringify(names)}`);
  assert.ok(names.includes('図面枠'), `レイヤー名が化けている: ${JSON.stringify(names)}`);
});

test('度・径・±の記号が、読める記号になる', () => {
  // 図面には「45%%D」と書かれている。そのまま出すと現場で読めない。
  const d = load('utf8-mislabeled.dxf');
  const texts = only(d, 'text').map((t) => t.text);
  assert.ok(texts.includes('45°'), `度記号になっていない: ${JSON.stringify(texts)}`);
  assert.ok(
    texts.some((t) => t.includes('φ') && t.includes('±')),
    `径・±の記号になっていない: ${JSON.stringify(texts)}`
  );
  assert.ok(!texts.some((t) => t.includes('%%')), '記号の書き方がそのまま残っている');
});

test('レイヤーに従う色が、日本語のレイヤー名でも正しく引ける', () => {
  // レイヤー名が化けると、色を引く相手が見つからず図面が真っ黒になる
  const d = load('utf8-mislabeled.dxf');
  const line = only(d, 'line')[0];
  assert.equal(line.layer, '既設PIPE');
  assert.equal(line.color, '#ff0000', '日本語レイヤーの色が引けていない');
});

// ============================================================
// 寸法（DIMENSION）
//
// 管工事の図面で寸法が見えないのは致命的。
// 参考図.dxf では32個の寸法が全部消えていた（v0.1.1まで）。
// ============================================================

test('寸法が展開されて、寸法線・補助線・寸法値がすべて出る', () => {
  const d = load('dimension.dxf');

  // 図面本体の線1本 ＋ 寸法の部品の線3本 ＝ 4本
  assert.equal(only(d, 'line').length, 4, '寸法の線が出ていない');

  // 寸法値の文字が出ていること
  const texts = only(d, 'text').map((t) => t.text);
  assert.deepEqual(texts, ['250'], `寸法値が出ていない: ${JSON.stringify(texts)}`);
});

test('寸法の部品は、位置をずらさずそのままの場所に出る', () => {
  // 部品の中身は、すでに図面と同じ座標で書かれている。
  // ここで差し込み位置を足してしまうと、寸法だけ図面の外へ飛んでいく。
  const d = load('dimension.dxf');
  const text = only(d, 'text')[0];
  assert.equal(text.x, 225, '寸法値のX座標がずれている');
  assert.equal(text.y, 255, '寸法値のY座標がずれている');

  // 寸法線（100,250)-(350,250)）がそのままの座標で出ていること
  const dimLine = only(d, 'line').find((l) => l.y1 === 250 && l.y2 === 250);
  assert.ok(dimLine, '寸法線がその場所に出ていない');
  assert.deepEqual([dimLine.x1, dimLine.x2], [100, 350]);
});

test('寸法の中の目印の点は、「表示できませんでした」に数えない', () => {
  // CADでも印刷されない目印。数えると実物の図面では100個近くになり、
  // 本当に足りていない図形が埋もれてしまう。
  const d = load('dimension.dxf');
  assert.equal(d.unsupported.count, 0, `余計なものを数えている: ${JSON.stringify(d.unsupported.kinds)}`);
});

test('寸法の線の色が、レイヤーの色になる', () => {
  const d = load('dimension.dxf');
  const dimLine = only(d, 'line').find((l) => l.y1 === 250);
  assert.equal(dimLine.color, '#00ff00', '寸法線の色がレイヤーの色になっていない');
});

test('図面の範囲に、寸法も含まれる', () => {
  // 寸法を範囲に入れないと、全体表示したとき寸法が画面の外に切れる
  const d = load('dimension.dxf');
  assert.ok(d.bounds.maxY >= 260, `寸法の高さが範囲に入っていない: ${JSON.stringify(d.bounds)}`);
});

// ============================================================
// CADで消してあるものを出さない（実物の図面で判明）
//
// お客様の参考図.dxf には「見えない」指定が付いた図形が805個あった。
// AutoCADの「動的ブロック」は、ひとつの部品の中にありうる形を全部持たせておき、
// 「今回はこの形」という指定で切り替える。使わない形には「見えない」印が付く。
// これを読まずに全部描くと、切り替えたはずの形が全部重なって出てしまう。
// ============================================================

test('図形ごとの「見えない」指定（コード60）が付いたものは出さない', () => {
  const d = load('visibility.dxf');
  const ys = only(d, 'line').map((l) => l.y1);
  assert.ok(!ys.includes(30), `「見えない」指定の線が出てしまっている: ${JSON.stringify(ys)}`);
});

test('非表示（OFF）のレイヤーの図形は出さない', () => {
  // CADで消してあるレイヤーは、色番号がマイナスで書かれている
  const d = load('visibility.dxf');
  const ys = only(d, 'line').map((l) => l.y1);
  assert.ok(!ys.includes(10), `消したレイヤーの線が出てしまっている: ${JSON.stringify(ys)}`);
});

test('凍結（FROZEN）のレイヤーの図形は出さない', () => {
  const d = load('visibility.dxf');
  const ys = only(d, 'line').map((l) => l.y1);
  assert.ok(!ys.includes(20), `凍結レイヤーの線が出てしまっている: ${JSON.stringify(ys)}`);
});

test('表示されているレイヤーの図形は、ちゃんと出る', () => {
  // 消しすぎていないことの確認。ここが消えると図面が真っ白になる
  const d = load('visibility.dxf');
  const ys = only(d, 'line').map((l) => l.y1);
  assert.deepEqual(ys, [0], `出るべき線が出ていない: ${JSON.stringify(ys)}`);
});

test('消した図形の数を数えている（あとで調べられるように）', () => {
  const d = load('visibility.dxf');
  assert.equal(d.hiddenCount, 3, '見えない指定1本＋消したレイヤー1本＋凍結1本で3本');
});

test('消した図形は「表示できませんでした」には数えない', () => {
  // もともと出さないものなので、数えると本当に足りない図形が埋もれる
  const d = load('visibility.dxf');
  assert.equal(d.unsupported.count, 0, `余計なものを数えている: ${JSON.stringify(d.unsupported.kinds)}`);
});

// ============================================================
// 文字の向き（実物の図面で判明）
//
// 寸法の数字だけ、いつも水平に出ていた。
// MTEXTは「何度傾ける」ではなく「どちらを向いているか」を矢印で書くことが多い。
// ============================================================

test('MTEXTの向きが矢印（11,21）で書かれていたら、その向きに傾ける', () => {
  const d = load('visibility.dxf');
  const t = only(d, 'text').find((e) => e.text === 'たて書き');
  assert.ok(t, 'たて書きの文字が見つからない');
  assert.equal(Math.round(t.rotation), 90, `真上を向く指定が反映されていない（実際は ${t.rotation}度）`);
});

test('向きの矢印が無いMTEXTは水平のまま', () => {
  const d = load('visibility.dxf');
  const t = only(d, 'text').find((e) => e.text === 'よこ書き');
  assert.ok(t, 'よこ書きの文字が見つからない');
  assert.equal(t.rotation, 0);
});

test('寸法の数字は「中央ぞろえ」で置かれる', () => {
  // ここを左端で置くと、数字が寸法線からずれて見える
  const d = load('visibility.dxf');
  const t = only(d, 'text').find((e) => e.text === 'たて書き');
  assert.equal(t.hAlign, 'center', '中央ぞろえになっていない');
  assert.equal(t.vAlign, 'middle', '上下の中央になっていない');
});

// ============================================================
// ブロックの中身がレイヤー0のときの色（実物の図面で判明）
//
// 【AutoCADの決まり】ブロック（部品）の中身がレイヤー「0」に描かれている場合、
// その中身は **その部品を置いた側のレイヤー** に従う。
//
// 参考図.dxf のエルボがまさにこれだった：
//   置いた側 … レイヤー PIPE（赤） ／ 中身 … レイヤー 0（黒）
// この決まりを知らないと、**配管が赤いのにエルボだけ黒**になる。実際にそうなっていた。
// ============================================================

test('ブロックの中身がレイヤー0なら、置いた側のレイヤーの色になる', () => {
  const d = load('block-layer0.dxf');
  const arc = only(d, 'arc')[0];
  assert.ok(arc, 'エルボ（円弧）が見つからない');
  assert.equal(arc.layer, 'PIPE', '置いた側のレイヤーになっていない');
  assert.equal(arc.color, '#ff0000', '配管の赤になっていない（エルボだけ黒くなる不具合）');
});

test('中身に色が直接指定してあれば、その色のまま（CADと同じ）', () => {
  // 色を直接指定した線は、置いた側のレイヤーに関係なくその色。ここまで赤くしてはいけない。
  const d = load('block-layer0.dxf');
  const line = only(d, 'line').find((l) => l.y1 === 0);
  assert.ok(line, '色を直接指定した線が見つからない');
  assert.equal(line.color, '#000000', '色の直接指定を無視して赤くしている');
});

test('中身がレイヤー0以外なら、そのレイヤーのまま（置いた側に従わない）', () => {
  // ここまで置いた側に従わせると、レイヤー分けが壊れる
  const d = load('block-layer0.dxf');
  const line = only(d, 'line').find((l) => l.y1 === 20);
  assert.ok(line, 'レイヤー「枠」の線が見つからない');
  assert.equal(line.layer, '枠', 'レイヤー0以外まで置いた側に従わせている');
  assert.equal(line.color, '#0000ff', 'レイヤー「枠」の青になっていない');
});

// ============================================================
// 楕円（ELLIPSE）と、印刷レイアウトののぞき窓（VIEWPORT）
//
// 実物の参考図.dxf に楕円が2個あり、表示できていなかった。
// 配管の図面では、斜めから見た管の口などによく使われる。
// ============================================================

test('楕円が読める。長い半径・短い半径・傾きが正しい', () => {
  // 中心(100,50)、長いほうの軸の端が中心から (0,20) → 長さ20・真上を向く（90度）
  // 短い半径は 20 × 0.5 = 10
  const d = load('ellipse-viewport.dxf');
  const e = only(d, 'ellipse').find((x) => x.cx === 100);
  assert.ok(e, '楕円が読めていない');
  near(e.cy, 50, '中心のY');
  near(e.rx, 20, '長いほうの半径');
  near(e.ry, 10, '短いほうの半径');
  assert.equal(Math.round(e.rotation), 90, '傾きが90度になっていない');
});

test('楕円の「どこからどこまで」が度に直っている（DXFはラジアン）', () => {
  // 41=0, 42=π/2（ラジアン）→ 0度から90度まで
  const d = load('ellipse-viewport.dxf');
  const e = only(d, 'ellipse').find((x) => x.cx === 0);
  assert.ok(e, '4分の1の楕円が読めていない');
  assert.equal(Math.round(e.startAngle), 0);
  assert.equal(Math.round(e.endAngle), 90, 'ラジアンを度に直せていない');
  near(e.rx, 40, '長いほうの半径');
  near(e.ry, 10, '短いほうの半径（40×0.25）');
});

test('楕円が図面の範囲に入る', () => {
  // ここが入らないと、全体表示で楕円が画面の外に切れる
  const d = load('ellipse-viewport.dxf');
  assert.ok(d.bounds.maxX >= 110, `楕円の右端が範囲に入っていない: ${JSON.stringify(d.bounds)}`);
  assert.ok(d.bounds.maxY >= 70, `楕円の上端が範囲に入っていない: ${JSON.stringify(d.bounds)}`);
});

test('印刷レイアウトののぞき窓（VIEWPORT）は「表示できませんでした」に数えない', () => {
  // VIEWPORT は「紙のこの位置に図面のこの範囲を映す」という設定であって、図面の線ではない。
  // 数えると、図面が欠けていないのに欠けたように見えて無用な心配をかける。
  const d = load('ellipse-viewport.dxf');
  assert.equal(d.unsupported.count, 0, `余計なものを数えている: ${JSON.stringify(d.unsupported.kinds)}`);
});

// ============================================================
// 中身が空っぽの文字（実物の図面で判明）
//
// お客様の参考図.dxf には、書式の指定だけが入っていて肝心の文字が無いMTEXTがあった。
// CADの画面には何も出ない。ところがこのアプリは「文字がそこにある」として扱ったため、
// **図面の遠くに見えない文字があることになり、見えないものを報告していた。**
// お客様がCADで探しても見つからなくて当然だった。
// ============================================================

test('中身が空っぽの文字は、図形として作らない', () => {
  const dxf = [
    '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1032', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    // 書式の指定だけで、文字が無いMTEXT（実物にあったのと同じ形）
    '0', 'MTEXT', '8', '0', '62', '7',
    '10', '99999.0', '20', '99999.0', '40', '150.0', '71', '1', '1', '\\A1;',
    // ふつうの文字
    '0', 'TEXT', '8', '0', '62', '7',
    '10', '0.0', '20', '0.0', '40', '5.0', '1', '配管',
    // 空白だけの文字も、見えないので作らない
    '0', 'TEXT', '8', '0', '62', '7',
    '10', '50.0', '20', '0.0', '40', '5.0', '1', '   ',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  const texts = only(d, 'text');
  assert.equal(texts.length, 1, `見えない文字まで作っている: ${JSON.stringify(texts.map((t) => t.text))}`);
  assert.equal(texts[0].text, '配管');
});

test('見えない文字が、図面の範囲を広げない', () => {
  // ここが効かないと、遠くの見えない文字に引っぱられて図面が小さく表示される
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '62', '7', '10', '0.0', '20', '0.0', '11', '100.0', '21', '0.0',
    '0', 'MTEXT', '8', '0', '62', '7',
    '10', '99999.0', '20', '99999.0', '40', '150.0', '71', '1', '1', '\\A1;',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.ok(d.bounds.maxX <= 100, `見えない文字が範囲を広げている: ${JSON.stringify(d.bounds)}`);
  assert.equal(d.outliers, 0, '見えない文字をはぐれ図形として数えている');
});

test('はぐれ図形が「何か」まで分かる（CADで探せるように）', () => {
  // 「3個あります」だけだと、CADで探しても見つけられない（実際に見つけられなかった）
  const entities = [];
  for (let i = 0; i < 100; i++) {
    entities.push({ type: 'line', layer: '0', color: '#000', x1: i, y1: 0, x2: i, y2: 100 });
  }
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    ...entities.flatMap((e) => ['0', 'LINE', '8', '0', '62', '7',
      '10', String(e.x1), '20', String(e.y1), '11', String(e.x2), '21', String(e.y2)]),
    '0', 'TEXT', '8', 'メモ', '62', '7',
    '10', '500000.0', '20', '500000.0', '40', '10.0', '1', 'outlook',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(d.outliers, 1);
  assert.ok(Array.isArray(d.outlierList), 'はぐれ図形の中身が記録されていない');
  assert.equal(d.outlierList.length, 1);
  assert.equal(d.outlierList[0].type, 'text');
  assert.equal(d.outlierList[0].text, 'outlook', '文字の中身が記録されていない');
  assert.equal(d.outlierList[0].layer, 'メモ', 'レイヤー名が記録されていない');
  assert.ok(d.outlierList[0].x > 400000, '場所が記録されていない');
});

test('DXFから作る文字の縦位置に、Canvasが知らない名前を使わない', () => {
  // 'baseline' はCanvasに存在しない名前。渡すとブラウザに無視され、文字がずれる。
  const ok = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];
  for (const file of ['shapes.dxf', 'visibility.dxf', 'dimension.dxf', 'utf8-mislabeled.dxf']) {
    const d = load(file);
    for (const t of only(d, 'text')) {
      assert.ok(
        ok.includes(t.vAlign),
        `${file} の文字「${t.text}」の縦位置が「${t.vAlign}」になっている（Canvasが知らない名前）`
      );
    }
  }
});

// ============================================================
// 印刷しないレイヤーを読み取る（開発ルール41章）
//
// CADには「画面には出すが、紙には出さない」レイヤーがある。
// これを読み取っていなかったので、作図の補助線が紙に印刷されていた。
// ============================================================

test('コード290が0のレイヤーは、印刷しない扱いになる', () => {
  const d = load('noplot-layers.dxf');
  const hojo = d.layers.find((l) => l.name === 'HOJO');
  assert.ok(hojo, 'HOJOレイヤーが読めていない');
  assert.equal(hojo.noPlot, true, '290=0 を読み取れていない');
});

test('DEFPOINTS は、290が書いていなくても印刷しない', () => {
  // AutoCADが自分で作る特別なレイヤー。名前だけで印刷されない決まりになっている。
  const d = load('noplot-layers.dxf');
  const def = d.layers.find((l) => l.name === 'DEFPOINTS');
  assert.ok(def, 'DEFPOINTSレイヤーが読めていない');
  assert.equal(def.noPlot, true, 'DEFPOINTS を印刷してしまう');
});

test('ふつうのレイヤーは、印刷する扱いのまま', () => {
  // ここが崩れると、図面がまるごと白紙で出てくる
  const d = load('noplot-layers.dxf');
  const pipe = d.layers.find((l) => l.name === 'PIPE');
  assert.ok(pipe, 'PIPEレイヤーが読めていない');
  assert.ok(!pipe.noPlot, 'ふつうのレイヤーまで印刷しない扱いになっている');
});

test('印刷しないレイヤーの図形にも、印が付く', () => {
  // レイヤーに印が付いていても、図形の側から引けないと印刷で使えない
  const d = load('noplot-layers.dxf');
  const 印つき = d.entities.filter((e) => e.noPlot).map((e) => e.layer).sort();
  assert.deepEqual(印つき, ['DEFPOINTS', 'HOJO']);
});

test('印刷しないレイヤーでも、画面には出す', () => {
  // 【消してはいけない理由】CADでは見えている。消すと見た目が変わる。
  // 紙に出す道（print-area.js）だけで外す。
  const d = load('noplot-layers.dxf');
  assert.equal(d.entities.length, 3, '画面から消えてしまっている');
  const hojo = d.layers.find((l) => l.name === 'HOJO');
  assert.equal(hojo.visible, true, '画面にも出なくなっている');
});

// ============================================================
// 自由曲線（SPLINE）45章
//
// 「線が出ている」だけでは何も守れない（43.6の反省）。
// ここでは **その形でなければ図面が間違って表示される値** を数字で押さえる。
// ============================================================

test('自由曲線は、折れ線（polyline）として出る。新しい種類を増やさない', () => {
  // 種類を増やすと、画面・印刷の絵・PDFの3か所すべてに描き方を足すことになり、
  // 1つ忘れると「画面には出るのに紙に出ない」が起きる（36.2・43.1）
  const d = load('spline.dxf');
  assert.equal(d.unsupported.count, 0, `自由曲線が数えられている: ${JSON.stringify(d.unsupported.kinds)}`);
  assert.equal(d.entities.length, 3, '自由曲線3本が出ていない');
  for (const e of d.entities) {
    assert.equal(e.type, 'polyline', `折れ線以外の種類が作られている: ${e.type}`);
  }
});

test('重み付きの自由曲線が、ぴったり正しい形になる（半径で検算する）', () => {
  // 重み cos45度 の3点・次数2の曲線は、**数学的にぴったり四分円**になる。
  // だから「それらしい」ではなく、中心からの距離で1点ずつ検算できる。
  // 重み（41）を読み落とすと、ここがふくらんで別の形になる。
  const d = load('spline.dxf');
  const 曲線 = d.entities[0];

  assert.ok(曲線.points.length >= 8, `点が ${曲線.points.length} 個しかなく、曲線に見えない`);
  for (const [x, y] of 曲線.points) {
    const r = Math.hypot(x, y);
    assert.ok(Math.abs(r - 100) < 1e-6, `半径100の円の上に乗っていない（半径 ${r}）`);
  }
  // 両端は、最初と最後の制御点そのもの
  near(曲線.points[0][0], 100, '始点のX');
  near(曲線.points[0][1], 0, '始点のY');
  near(曲線.points.at(-1)[0], 0, '終点のX');
  near(曲線.points.at(-1)[1], 100, '終点のY');
  // 曲線なので、まん中は弦よりふくらむ（直線で結んでいないことの確認）
  const まん中 = 曲線.points[Math.floor(曲線.points.length / 2)];
  near(まん中[0], 100 / Math.SQRT2, 'まん中のX（45度の位置）');
  near(まん中[1], 100 / Math.SQRT2, 'まん中のY（45度の位置）');
});

test('ノットが書かれていない自由曲線も、捨てずに描く', () => {
  // ノット（目盛り）が無い・数が合わないDXFは実際にある。
  // 自分で目盛りを作れば描けるので、「表示できませんでした」にしない。
  const d = load('spline.dxf');
  const 曲線 = d.entities[1];
  assert.ok(曲線.points.length >= 8, '曲線になっていない');
  // 目盛りを自分で作ると、曲線は最初と最後の制御点をきっちり通る
  near(曲線.points[0][0], 0, '始点のX');
  near(曲線.points[0][1], 200, '始点のY');
  near(曲線.points.at(-1)[0], 100, '終点のX');
  near(曲線.points.at(-1)[1], 200, '終点のY');
  // 制御点は曲線を引っぱるだけなので、曲線は制御点の外へは出ない
  for (const [x, y] of 曲線.points) {
    assert.ok(x >= -1e-9 && x <= 100 + 1e-9, `制御点の範囲より外へ出ている（X=${x}）`);
    assert.ok(y >= 200 - 1e-9 && y <= 260 + 1e-9, `制御点の範囲より外へ出ている（Y=${y}）`);
  }
});

test('制御点が無く通過点だけの自由曲線は、通過点をつないで出す', () => {
  // なめらかさは出ないが、**何も出ないよりはるかによい**（10.5：黙って捨てない）
  const d = load('spline.dxf');
  const 曲線 = d.entities[2];
  assert.deepEqual(曲線.points, [[0, 400], [50, 450], [100, 400]]);
});

test('閉じた自由曲線（周期式）が、ちゃんと1周して閉じる', () => {
  // 制御点が1周ぶんしか書かれていない書き方。自分で1周させないと、
  // **輪の一部が欠けたまま**画面にも紙にも出る（45章の落とし穴）。
  const d = load('spline-closed.dxf');
  assert.equal(d.entities.length, 1);
  const 輪 = d.entities[0];
  assert.equal(輪.type, 'polyline');
  assert.equal(輪.closed, true, '閉じた曲線になっていない');

  // 制御点は (0,0)(100,0)(100,100)(0,100) の正方形。
  // 3次の閉じた曲線は、その正方形の内側に、上下左右つりあった形で入る。
  const xs = 輪.points.map((p) => p[0]);
  const ys = 輪.points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  assert.ok(minX > 0 && minY > 0 && maxX < 100 && maxY < 100,
    `制御点の正方形からはみ出している（${minX}, ${minY}, ${maxX}, ${maxY}）`);
  // つりあっていること（1周できていないと、ここが必ず崩れる）
  near(minX, minY, '左端と下端がつりあっていない');
  near(maxX, maxY, '右端と上端がつりあっていない');
  near(minX + maxX, 100, '左右がまん中でつりあっていない');
  near(minY + maxY, 100, '上下がまん中でつりあっていない');
});

test('自由曲線が、図面の範囲（bounds）にちゃんと入る', () => {
  // 範囲に入らないと、開いたときに図面が画面に収まらない
  const d = load('spline.dxf');
  assert.ok(d.bounds.maxY >= 449, `曲線が範囲に入っていない: ${JSON.stringify(d.bounds)}`);
  assert.ok(d.bounds.minX <= 0 && d.bounds.maxX >= 100);
});

test('自由曲線が、ブロックの中でも展開されて出る', () => {
  // 実物の図面（参考図.dxf）では、自由曲線は**ブロックの中**に入っていた。
  // ここが効かないと、部品の中の曲線だけが消える。
  const dxf = [
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '2', 'ベント', '10', '0.0', '20', '0.0',
    '0', 'SPLINE', '8', '0', '62', '7',
    '70', '8', '71', '3', '72', '8', '73', '4', '74', '0',
    '40', '0', '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1', '40', '1',
    '10', '0.0', '20', '0.0', '10', '0.0', '20', '10.0',
    '10', '10.0', '20', '10.0', '10', '10.0', '20', '0.0',
    '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    // (100,200) に置く
    '0', 'INSERT', '8', '0', '62', '7', '2', 'ベント', '10', '100.0', '20', '200.0',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(d.unsupported.count, 0, `ブロックの中の曲線が数えられている: ${JSON.stringify(d.unsupported.kinds)}`);
  const 曲線 = only(d, 'polyline');
  assert.equal(曲線.length, 1, 'ブロックの中の自由曲線が出ていない');
  // 置いた場所ぶんだけ、ちゃんとずれていること
  near(曲線[0].points[0][0], 100, '差し込み位置のXが効いていない');
  near(曲線[0].points[0][1], 200, '差し込み位置のYが効いていない');
  near(曲線[0].points.at(-1)[0], 110, '終点のX');
  near(曲線[0].points.at(-1)[1], 200, '終点のY');
});

test('「見えない」指定の自由曲線は、描かないし数えもしない', () => {
  // 動的ブロックは、使わない形の図形に「見えない」印を付けて持っている。
  // 実物の参考図.dxf の自由曲線2本のうち、1本がまさにこれだった。
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '62', '7', '10', '0.0', '20', '0.0', '11', '10.0', '21', '0.0',
    '0', 'SPLINE', '8', '0', '62', '7', '60', '1',
    '70', '8', '71', '3', '72', '0', '73', '4', '74', '0',
    '10', '0.0', '20', '0.0', '10', '0.0', '20', '10.0',
    '10', '10.0', '20', '10.0', '10', '10.0', '20', '0.0',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(only(d, 'polyline').length, 0, '見えない指定の曲線を描いている');
  assert.equal(d.unsupported.count, 0, 'もともと出ないものを「表示できませんでした」に数えている');
});

test('形にならない自由曲線は、黙って捨てずに数える', () => {
  // 制御点も通過点も無い壊れたSPLINE。描けないので、黙って消さずに報告する（10.5）
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'SPLINE', '8', '0', '62', '7', '70', '8', '71', '3', '72', '0', '73', '0', '74', '0',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(d.entities.length, 0);
  assert.equal(d.unsupported.count, 1, '描けなかった曲線を黙って捨てている');
  assert.equal(d.unsupported.kinds['SPLINE（形が読み取れない）'], 1);
});

// ============================================================
// 属性の文字（ATTDEF・ATTRIB）46章
//
// 実物の図面で ATTRIB 66個が消え、ATTDEF 66個が無用に数えられていた。
// ============================================================

/** 見本の中から、その文字を探す。 */
const 文字を探す = (d, text) => only(d, 'text').find((t) => t.text === text);

test('部品に入っている実際の文字（ATTRIB）が、図面に出る', () => {
  // ここが効かないと、機器番号や呼び径が図面からまるごと消える
  const d = load('attrib.dxf');
  const t = 文字を探す(d, 'V-1');
  assert.ok(t, '属性の文字が出ていない（機器番号が消えている）');
  near(t.x, 100, '文字のX');
  near(t.y, 205, '文字のY');
  assert.equal(t.height, 3);
  // ぞろえの指定が無い属性は、左ぞろえ・文字の下端の線が基準になる。
  // ここを押さえておかないと、「いつも中央ぞろえ」のような取り違えを見逃す
  assert.equal(t.hAlign, 'left', 'ぞろえの指定が無いのに、左ぞろえになっていない');
  assert.equal(t.vAlign, 'alphabetic', 'ぞろえの指定が無いのに、下端の線が基準になっていない');
});

test('ふつうの文字にも、位置ぞろえが効く（48章）', () => {
  // 属性の文字だけ直して、ふつうの文字を直し忘れると、
  // 同じ「中央ぞろえ」でも図面のどこに書かれたかで結果が変わってしまう。
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    // 中央ぞろえ（72=1）。置き場所は2つめの点(11,21)のほう
    '0', 'TEXT', '8', '0', '62', '7',
    '10', '0', '20', '0', '40', '10', '72', '1', '11', '50', '21', '30', '1', 'E-10',
    // ぞろえの指定が無い文字は、今までどおり1つめの点・左ぞろえ
    '0', 'TEXT', '8', '0', '62', '7',
    '10', '5', '20', '7', '40', '10', '11', '0', '21', '0', '1', 'A89-7',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  const 中央 = 文字を探す(d, 'E-10');
  assert.ok(中央, '中央ぞろえの文字が出ていない');
  near(中央.x, 50, '2つめの点が使われていない');
  near(中央.y, 30, '2つめの点が使われていない');
  assert.equal(中央.hAlign, 'center', '中央ぞろえになっていない');

  // 【落とし穴】ぞろえの指定が無いのに 11・21 が書いてある図面がある（実物がそうだった）。
  // そこを置き場所にしてしまうと、文字が原点へ飛ぶ
  const ふつう = 文字を探す(d, 'A89-7');
  near(ふつう.x, 5, 'ぞろえの指定が無いのに2つめの点を使っている');
  near(ふつう.y, 7, 'ぞろえの指定が無いのに2つめの点を使っている');
  assert.equal(ふつう.hAlign, 'left');
  assert.equal(ふつう.vAlign, 'alphabetic');
});

test('位置ぞろえのある属性は、2つめの点に置かれる', () => {
  // 【DXFの決まり】ぞろえの指定があるときは (10,20) ではなく (11,21) が置き場所。
  // 取り違えると、丸の中の番号が丸から外れて出る。
  const d = load('attrib.dxf');
  const t = 文字を探す(d, '50A');
  assert.ok(t, '中央ぞろえの属性が出ていない');
  near(t.x, 150, '2つめの点のXが使われていない');
  near(t.y, 250, '2つめの点のYが使われていない');
  assert.equal(t.hAlign, 'center', '中央ぞろえになっていない');
  assert.equal(t.vAlign, 'middle', 'タテのぞろえが読めていない');
});

test('部品の中の「型」（ATTDEF）は描かないし、数えもしない', () => {
  // 型は「ここに文字が入ります」という枠であって、図面から欠けてはいない。
  // 数えると無用な心配をかけ、本当に足りない図形が埋もれる（18.1）
  const d = load('attrib.dxf');
  assert.equal(d.unsupported.count, 0, `型を数えている: ${JSON.stringify(d.unsupported.kinds)}`);
  assert.equal(文字を探す(d, 'BANGO'), undefined, '型の名札を、そのまま図面に出している');
});

test('「一定」の型は、ATTRIBが無いので型の値をそのまま出す', () => {
  // 一定の属性にはATTRIBが作られない。型を飛ばすと、この文字だけ消える
  const d = load('attrib.dxf');
  const t = 文字を探す(d, 'VP');
  assert.ok(t, '一定の型の文字が出ていない');
  // 部品を (100,200) に置いたので、部品の中の (0,10) は (100,210) になる
  near(t.x, 100, '部品を置いた位置が効いていない');
  near(t.y, 210, '部品を置いた位置が効いていない');
});

test('図面に直接置かれた型は、CADと同じく名札を出す', () => {
  const d = load('attrib.dxf');
  const t = 文字を探す(d, 'NAFUDA');
  assert.ok(t, '直接置かれた型が消えている');
  near(t.x, 300, '名札のX');
});

test('「見えない」指定の属性と型は、出さないし数えない', () => {
  // もともとCADの画面に出ないもの。数えると無用な心配をかける（18.2）
  const d = load('attrib.dxf');
  assert.equal(文字を探す(d, 'かくれ'), undefined, '見えない属性を描いている');
  assert.equal(文字を探す(d, 'ひみつ'), undefined, '見えない型を描いている');
  assert.equal(d.unsupported.count, 0, 'もともと出ないものを数えている');
});

test('属性の文字が、図面の範囲（bounds）に入る', () => {
  const d = load('attrib.dxf');
  assert.ok(d.bounds.maxX >= 300 && d.bounds.maxY >= 300,
    `属性の文字が範囲に入っていない: ${JSON.stringify(d.bounds)}`);
});

// ============================================================
// 引出線（MULTILEADER）46章
// ============================================================

test('引出線が、折れ線と文字に直して出る。新しい種類を増やさない', () => {
  const d = load('mleader.dxf');
  assert.equal(d.unsupported.count, 0, `引出線が数えられている: ${JSON.stringify(d.unsupported.kinds)}`);
  for (const e of d.entities) {
    assert.ok(['polyline', 'line', 'text'].includes(e.type),
      `折れ線・線・文字のほかに種類が増えている: ${e.type}`);
  }
});

test('引出線の折れ線が、書かれたとおりの点を通る', () => {
  // ここがずれると、矢印が指している先が変わってしまう
  const d = load('mleader.dxf');
  const 線 = only(d, 'polyline');
  assert.equal(線.length, 1, '引出線の折れ線が出ていない');
  assert.deepEqual(線[0].points, [[0, 0], [50, 25], [90, 50]]);
  assert.equal(線[0].closed, false, '引出線を閉じてしまっている');
});

test('折れ曲がってから文字へ伸びる線（dogleg）が出る', () => {
  // これが無いと、引出線と文字が離れて、どれの注記か分からなくなる
  const d = load('mleader.dxf');
  const 線 = only(d, 'line');
  assert.equal(線.length, 1, '折れ曲がりの線が出ていない');
  // 終わりの点(90,50)から、向き(1,0)へ長さ10ぶん
  assert.deepEqual([線[0].x1, 線[0].y1, 線[0].x2, 線[0].y2], [90, 50, 100, 50]);
});

test('引出線の文字が、場所と大きさどおりに出る', () => {
  const d = load('mleader.dxf');
  const t = only(d, 'text')[0];
  assert.ok(t, '引出線の文字が出ていない');
  assert.equal(t.text, 'VP50');
  near(t.x, 100, '文字のX');
  near(t.y, 50, '文字のY');
  assert.equal(t.height, 5, '文字の高さが読めていない');
  near(t.rotation, 0, '文字の向き');
});

test('コード304の取り違えで、区切りの記号が文字として出ない', () => {
  // 【落とし穴】304は「文字の中身」と「LEADER_LINE{」の両方に使われる。
  // 番号だけで見分けると、区切りの記号が図面に文字として出てしまう。
  const d = load('mleader.dxf');
  for (const t of only(d, 'text')) {
    assert.ok(!t.text.includes('{') && !t.text.includes('}'),
      `区切りの記号が文字として出ている: ${JSON.stringify(t.text)}`);
    assert.ok(!t.text.includes('LEADER'),
      `区切りの名前が文字として出ている: ${JSON.stringify(t.text)}`);
  }
  assert.equal(only(d, 'text')[0].text, 'VP50');
});

test('閉じかっこが足りない引出線でも、読めたぶんは描く', () => {
  // 壊れたファイルで作りかけを捨てると、線が丸ごと消える
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'MULTILEADER', '8', '0', '62', '7',
    '300', 'CONTEXT_DATA{',
    '41', '4.0', '304', 'ABC', '12', '10.0', '22', '20.0',
    '302', 'LEADER{',
    '304', 'LEADER_LINE{',
    '10', '0.0', '20', '0.0', '10', '5.0', '20', '5.0',
    // ここで閉じかっこが無いまま終わる
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(d.unsupported.count, 0, '読めたのに数えている');
  assert.equal(only(d, 'polyline').length, 1, '作りかけの折れ線を捨てている');
  assert.equal(only(d, 'text')[0].text, 'ABC');
});

// ------------------------------------------------------------
// 実物のDWGで判明した書かれ方（46.7）
//
// LEADER_LINE の中に頂点が**1つしか無い**（矢印の先端だけ）。
// 線の終わりの点は、ひとつ外側の LEADER がコード10で持っている。
// つながないと点1つの線になり、線として描けずに消える。
// 折れ曲がりの短い線だけが残り、**文字の前にアンダーバーだけ**が出る。
// ------------------------------------------------------------

test('LEADER_LINEの頂点が1つでも、引出線が消えない', () => {
  // これが実物のDWGで起きていた不具合そのもの。
  // 「アンダーバーだけ出て、部材を指す線が無い」状態になっていた。
  const d = load('mleader-real.dxf');
  assert.equal(d.unsupported.count, 0, `引出線が数えられている: ${JSON.stringify(d.unsupported.kinds)}`);

  const 線 = only(d, 'polyline');
  assert.equal(線.length, 1, '引出線の本体が消えている（アンダーバーだけの状態）');
  // 矢印の先(0,0) から、LEADERが持っている終わりの点(100,50) まで
  assert.deepEqual(線[0].points, [[0, 0], [100, 50]]);
});

test('引出線に、矢印の頭が「くの字」で付く', () => {
  // 塗りつぶす仕組みが無いので黒い三角は作れないが、
  // どちらを指しているか分からないと注記として役に立たない。
  const d = load('mleader-real.dxf');
  const 線 = only(d, 'line');

  // 折れ曲がりの線1本 ＋ 矢印の2本 ＝ 3本
  assert.equal(線.length, 3, `矢印の頭が出ていない（線が ${線.length} 本）`);

  const 矢印 = 線.filter((l) => l.x1 === 0 && l.y1 === 0);
  assert.equal(矢印.length, 2, '矢印の頭が、先端から出ていない');
  for (const a of 矢印) {
    // 長さは指定された大きさ（コード140＝8）
    near(Math.hypot(a.x2 - a.x1, a.y2 - a.y1), 8, '矢印の頭の長さ');
    // 線の向き（26.565度）から左右に15度ずつ開いている
    const 角 = (Math.atan2(a.y2 - a.y1, a.x2 - a.x1) * 180) / Math.PI;
    const 開き = Math.abs(角 - 26.56505117707799);
    near(開き, 15, '矢印の開き（片側15度）', 1e-6);
  }
});

test('矢印の頭は、線と反対ではなく線に沿って開く', () => {
  // ここを逆にすると、矢印が指す先の「向こう側」へ突き出て、
  // どこを指しているのか分からなくなる。
  const d = load('mleader-real.dxf');
  const 矢印 = only(d, 'line').filter((l) => l.x1 === 0 && l.y1 === 0);
  for (const a of 矢印) {
    // 線は右上(100,50)へ伸びているので、矢印の羽も右上側に開く
    assert.ok(a.x2 > 0 && a.y2 > 0, `矢印の羽が反対を向いている（${a.x2}, ${a.y2}）`);
  }
});

test('矢印の大きさが書かれていなければ、頭を作らない', () => {
  // 大きさが分からないのに勝手な大きさで描くと、図面によって不釣り合いになる
  const d = load('mleader.dxf'); // こちらの見本には 140 が無い
  const 矢印 = only(d, 'line').filter((l) => l.x1 === 0 && l.y1 === 0);
  assert.equal(矢印.length, 0, '大きさが無いのに矢印の頭を作っている');
});

test('引出線の折れ曲がりと文字は、実物と同じ場所に出る', () => {
  const d = load('mleader-real.dxf');
  const 折れ = only(d, 'line').find((l) => l.x1 === 100 && l.y1 === 50);
  assert.ok(折れ, '折れ曲がりの線が出ていない');
  // 終わりの点(100,50)から、向き(1,0)へ長さ20ぶん
  assert.deepEqual([折れ.x2, 折れ.y2], [120, 50]);

  const t = only(d, 'text')[0];
  assert.equal(t.text, 'L-50');
  near(t.x, 130, '文字のX');
  near(t.y, 55, '文字のY');
  // 全体の拡大率(コード40＝5)を、文字の高さ(コード41＝10)に重ねて掛けない
  assert.equal(t.height, 10, '文字の高さに拡大率を重ねて掛けている');
});

test('中身の無い引出線は、黙って捨てずに数える', () => {
  // 線も文字も無ければ描くものが無い。黙って消さずに報告する（10.5）
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'MULTILEADER', '8', '0', '62', '7',
    '300', 'CONTEXT_DATA{', '301', '}',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(d.entities.length, 0);
  assert.equal(d.unsupported.count, 1, '描けなかった引出線を黙って捨てている');
  assert.equal(d.unsupported.kinds['MULTILEADER（中身が読み取れない）'], 1);
});

test('MLEADER という名前でも、同じように読める', () => {
  // 書き出すソフトによって名前が変わる
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'MLEADER', '8', '0', '62', '7',
    '300', 'CONTEXT_DATA{',
    '41', '4.0', '304', 'XYZ', '12', '10.0', '22', '20.0',
    '301', '}',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(d.unsupported.count, 0, 'MLEADER という名前を読めていない');
  assert.equal(only(d, 'text')[0].text, 'XYZ');
});

// ============================================================
// 鏡像（裏返し）で置いた部品 47章
//
// ユーザーの報告：「DWGのブロックの表示が反転しているところがちらほらある」。
// 位置は合っているのに、**円弧のふくらむ向きと文字の向きだけ**が裏返っていなかった。
//
// 見本 mirror.dxf は、同じ部品を4通りの置き方で横に並べてある。
//   ① (0,0)   ふつう
//   ② (100,0) 左右の鏡像（Xの拡大率が -1）
//   ③ (200,0) 上下の鏡像（Yの拡大率が -1）
//   ④ (300,0) 押し出しZが -1
// 部品の中身は 円弧(0→90度) ・ 上へ伸びる縦線 ・ 水平の文字。
// **裏返すと必ず形が変わるもの**だけを入れてある。
// ============================================================

/** 中心のXで、どの置き方のものかを見分ける。 */
const 円弧を探す = (d, cx) => only(d, 'arc').find((a) => Math.abs(a.cx - cx) < 1e-6);
const 線を探す = (d, x1) => only(d, 'line').find((l) => Math.abs(l.x1 - x1) < 1e-6);
const 文字を探すX = (d, x) => only(d, 'text').find((t) => Math.abs(t.x - x) < 1e-6);

test('鏡像で置いていない部品は、今までどおりそのまま出る', () => {
  const d = load('mirror.dxf');
  const a = 円弧を探す(d, 0);
  assert.ok(a, 'ふつうに置いた部品が出ていない');
  assert.equal(a.startAngle, 0);
  assert.equal(a.endAngle, 90, '裏返していないのに円弧の向きが変わっている');
  assert.deepEqual([線を探す(d, 0).x2, 線を探す(d, 0).y2], [0, 20]);
  assert.equal(文字を探すX(d, 0).rotation, 0);
});

test('左右の鏡像で、円弧のふくらむ向きが変わる', () => {
  // ここが効かないと、配管のエルボ（曲がり）が反対向きに描かれる。
  // 位置は合っているので、**形だけがおかしい**という気づきにくい壊れ方になる。
  const d = load('mirror.dxf');
  const a = 円弧を探す(d, 100);
  assert.ok(a, '左右の鏡像で置いた部品が出ていない');
  // 右上へふくらむ 0→90度 は、左右に裏返すと 90→180度（左上へふくらむ）になる
  assert.equal(a.startAngle, 90, '円弧の始まりが裏返っていない');
  assert.equal(a.endAngle, 180, '円弧の終わりが裏返っていない');
  assert.equal(a.r, 10, '半径が変わっている（マイナスの拡大率をそのまま掛けている）');
});

test('左右の鏡像で、部品の中身の位置が正しく裏返る', () => {
  const d = load('mirror.dxf');
  const l = 線を探す(d, 100);
  assert.ok(l, '左右の鏡像の線が出ていない');
  // 縦線はX軸上にあるので、左右に裏返しても上へ伸びたまま
  assert.deepEqual([l.x2, l.y2], [100, 20], '上下まで裏返してしまっている');
});

test('鏡像の中の文字は、裏返しても読める向きのまま出る', () => {
  // 線や円弧は裏返してよいが、**文字を裏返すと読めなくなる。**
  // CADも鏡像の文字を読めるまま出す決まりなので、こちらもそうする（47.5）。
  // ここが効かないと、水平の文字が上下さかさまになって現場で読めない。
  const d = load('mirror.dxf');
  assert.equal(文字を探すX(d, 100).rotation, 0, '水平の文字がさかさまになっている');
  assert.equal(文字を探すX(d, 300).rotation, 0, '水平の文字がさかさまになっている');
});

test('鏡像でない図面の文字の向きは、いっさい変えない', () => {
  // 「読める向きへ倒す」は、**鏡像の中だけ**の処置。
  // 図面がもともとさかさまに書いている文字を勝手に直すと、
  // CADで見た図面と食い違う。ここを守らないと、直したつもりが別の食い違いを生む。
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'TEXT', '8', '0', '62', '7', '10', '0', '20', '0', '40', '5', '50', '180', '1', 'さかさ',
    '0', 'TEXT', '8', '0', '62', '7', '10', '0', '20', '20', '40', '5', '50', '200', '1', 'ななめ',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(文字を探す(d, 'さかさ').rotation, 180, '書かれたとおりの向きを勝手に直している');
  assert.equal(文字を探す(d, 'ななめ').rotation, 200, '書かれたとおりの向きを勝手に直している');
});

test('傾いた文字は、鏡像でちゃんと傾きが裏返る（向きを直しても形は保つ）', () => {
  // 水平の文字だけで確かめると、**向きを直す処理が無くても同じ結果**になってしまい、
  // テストが何も守らない。45度の文字を入れて、そこを分けている。
  const 傾いた文字 = (d, x) =>
    only(d, 'text').find((t) => t.text === 'K' && Math.abs(t.x - x) < 1e-6);
  const d = load('mirror.dxf');
  assert.equal(傾いた文字(d, 0).rotation, 45, '書かれたとおりの傾きになっていない');
  // 45度を左右に裏返すと -45度（＝315度）。読める向きなので、そのまま
  assert.equal(傾いた文字(d, 100).rotation, 315, '傾きが裏返っていない');
  assert.equal(傾いた文字(d, 200).rotation, 315, '上下の鏡像で傾きが裏返っていない');
  assert.equal(傾いた文字(d, 300).rotation, 315, '押し出しZ=-1で傾きが裏返っていない');
});

test('上下の鏡像で、円弧と線が正しく裏返る', () => {
  const d = load('mirror.dxf');
  const a = 円弧を探す(d, 200);
  assert.ok(a, '上下の鏡像で置いた部品が出ていない');
  // 右上へふくらむ 0→90度 は、上下に裏返すと 270→360度（右下へふくらむ）になる
  assert.equal(a.startAngle, 270, '円弧の始まりが裏返っていない');
  assert.equal(a.endAngle, 0, '円弧の終わりが裏返っていない（0は360のこと）');
  const l = 線を探す(d, 200);
  assert.deepEqual([l.x2, l.y2], [200, -20], '線が下へ向いていない');
  // 上下に裏返しても、水平の文字は水平のまま
  assert.equal(文字を探すX(d, 200).rotation, 0, '文字の向きを余計に変えている');
});

test('押し出しZが-1の部品は、まるごと左右に裏返る', () => {
  // 【落とし穴】置く点と向きだけを直しても、**中身が裏返らない。**
  // 以前は180度回転と同じ結果になっていて、上下がひっくり返っていた。
  const d = load('mirror.dxf');
  const a = 円弧を探す(d, 300);
  assert.ok(a, '押し出しZ=-1で置いた部品が出ていない');
  assert.equal(a.startAngle, 90, '左右の鏡像と同じにならない');
  assert.equal(a.endAngle, 180, '左右の鏡像と同じにならない');
  const l = 線を探す(d, 300);
  // 180度回してしまうと、ここが (300,-20) になる
  assert.deepEqual([l.x2, l.y2], [300, 20], '裏返しではなく180度回してしまっている');
});

test('鏡像の部品が、図面の範囲に正しく収まる', () => {
  const d = load('mirror.dxf');
  assert.ok(d.bounds.maxX >= 300, `鏡像の部品が範囲に入っていない: ${JSON.stringify(d.bounds)}`);
  assert.ok(d.bounds.minY <= -20, '上下の鏡像が範囲に入っていない');
});

test('楕円も、鏡像で置くと回る向きが逆になる', () => {
  // 楕円の角度は、円弧と数え方が違う（つぶす前の円で測る）。
  // 軸の傾きだけ直して角度をそのままにすると、**弧の残っている側が入れ替わる。**
  const 楕円 = ['0', 'ELLIPSE', '8', '0', '62', '256',
    '10', '0', '20', '0', '11', '20', '21', '0', '40', '0.5',
    '41', '0', '42', String(Math.PI / 2)];
  const dxf = [
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '2', 'P', '10', '0', '20', '0', '30', '0', ...楕円, '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '8', '0', '62', '7', '2', 'P', '10', '0', '20', '0',
    '0', 'INSERT', '8', '0', '62', '7', '2', 'P', '10', '100', '20', '0', '41', '-1', '42', '1',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  const [ふつう, 鏡像] = only(d, 'ellipse');
  assert.equal(ふつう.rotation, 0);
  assert.equal(ふつう.startAngle, 0);
  assert.equal(ふつう.endAngle, 90);
  assert.equal(鏡像.rotation, 180, '楕円の軸の傾きが裏返っていない');
  assert.equal(鏡像.startAngle, 270, '楕円の始まりが裏返っていない');
  assert.equal(鏡像.endAngle, 0, '楕円の終わりが裏返っていない（0は360のこと）');
});

test('押し出しZが-1の楕円も、正しく裏返る', () => {
  // 以前は、軸の向きを2回裏返していて、打ち消し合って元に戻っていた（47.4）
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'ELLIPSE', '8', '0', '62', '7', '230', '-1',
    '10', '10', '20', '0', '11', '20', '21', '0', '40', '0.5',
    '41', '0', '42', String(Math.PI / 2),
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  const e = only(d, 'ellipse')[0];
  assert.equal(e.cx, -10, '中心が裏返っていない');
  assert.equal(e.rotation, 180, '軸の傾きが裏返っていない（2回裏返して打ち消していないか）');
  assert.equal(e.startAngle, 270, '始まりが裏返っていない');
  assert.equal(e.endAngle, 0, '終わりが裏返っていない');
});

test('鏡像を2回重ねると、元に戻る', () => {
  // 裏返しの中に裏返しがあると、打ち消し合ってふつうの向きになる。
  // 行列でまとめて持っていれば、これが自然に正しくなる。
  const dxf = [
    '0', 'SECTION', '2', 'BLOCKS',
    // 内側の部品：円弧
    '0', 'BLOCK', '2', 'IN', '10', '0', '20', '0', '30', '0',
    '0', 'ARC', '8', '0', '62', '256', '10', '0', '20', '0', '40', '10', '50', '0', '51', '90',
    '0', 'ENDBLK',
    // 外側の部品：内側を左右の鏡像で置く
    '0', 'BLOCK', '2', 'OUT', '10', '0', '20', '0', '30', '0',
    '0', 'INSERT', '8', '0', '62', '256', '2', 'IN', '10', '0', '20', '0', '41', '-1', '42', '1',
    '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    // その外側を、さらに左右の鏡像で置く
    '0', 'INSERT', '8', '0', '62', '7', '2', 'OUT', '10', '0', '20', '0', '41', '-1', '42', '1',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  const a = only(d, 'arc')[0];
  assert.ok(a, '入れ子の部品が展開されていない');
  assert.equal(a.startAngle, 0, '2回裏返したのに元に戻っていない');
  assert.equal(a.endAngle, 90, '2回裏返したのに元に戻っていない');
});

// ============================================================
// 並べ置き（同じ部品を格子状にくり返す）50章
//
// ユーザーの指示（2026-09-08）:「図面の表示通りに表示したい」
//
// CADは「ここに1個。それを横3・縦2でくり返す」という1つの指示で6個を表す
// （コード70・71・44・45）。読み飛ばすと**6個あるのに1個しか出ない。**
// しかも読み飛ばしたと気づかないので、「表示できませんでした」にも出ない。
// ============================================================

/** 折れ線の左下の角と大きさ。並べ置きの位置を確かめるのに使う。 */
const 四角 = (e) => {
  const xs = e.points.map((p) => p[0]);
  const ys = e.points.map((p) => p[1]);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  };
};

test('並べ置きは、書かれた数だけ並べて出る', () => {
  // ここが効かないと、ボルトが6本あるのに1本しか出ない。
  // 数を拾う図面では、本数が実際より少なく見えてしまう。
  const d = load('block-array.dxf');
  assert.equal(d.unsupported.count, 0, `数えられている: ${JSON.stringify(d.unsupported.kinds)}`);

  const 横3縦2 = only(d, 'polyline').map(四角).filter((r) => r.x < 100 && r.y < 100);
  assert.equal(横3縦2.length, 6, `横3個・縦2個で6個のはずが ${横3縦2.length} 個`);

  // 横は30おき、縦は20おき
  const 場所 = 横3縦2.map((r) => `${r.x},${r.y}`).sort();
  assert.deepEqual(場所, ['0,0', '0,20', '30,0', '30,20', '60,0', '60,20'].sort());
});

test('並ぶ向きは、部品の回転に従う', () => {
  // 【ここを回さないと】90度回して横に並べたはずのものが、横のまま出る。
  // 実際の図面では、斜めの配管に沿って並べた部品が明後日の方向へ散らばる。
  const d = load('block-array.dxf');
  const 回した = only(d, 'polyline').map(四角).filter((r) => r.y >= 190);
  assert.equal(回した.length, 3, '90度回した並べ置きが3個出ていない');

  // 90度回したので、横に並べたつもりでも**上へ**伸びる
  for (const r of 回した) near(r.x, -10, '回転で位置がずれている');
  assert.deepEqual(回した.map((r) => r.y).sort((a, b) => a - b), [200, 230, 260]);
});

test('並べる間隔に、拡大率を掛けない', () => {
  // 【掛けてはいけない】仕様では「並べる向きは回転に従うが、拡大率や鏡像は掛けない」。
  // 掛けると、部品だけでなく**並びの間隔まで伸び縮み**して、図面と合わなくなる。
  const d = load('block-array.dxf');
  const 拡大した = only(d, 'polyline').map(四角).filter((r) => r.x >= 250);
  assert.equal(拡大した.length, 2, '2倍で並べた部品が2個出ていない');

  const 並び = 拡大した.sort((a, b) => a.x - b.x);
  // 部品は2倍（10→20）になるが、間隔は30のまま（60にならない）
  near(並び[0].w, 20, '部品に拡大率が効いていない');
  near(並び[0].x, 300, '1個目の位置');
  near(並び[1].x, 330, '間隔に拡大率を掛けている（330のはずが360になっていないか）');
});

test('並べ置きでない部品は、今までどおり1個だけ出る', () => {
  // くり返しの指定が無い INSERT の動きを変えていないこと
  const d = load('with-block.dxf');
  assert.equal(d.entities.length, 12, 'ふつうの部品の出方が変わっている');
});

test('くり返しの数が0でも、1個は出す', () => {
  // 壊れた図面で 70=0 と書かれていることがある。0個にすると部品が消える
  const dxf = [
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '2', 'P', '10', '0', '20', '0', '30', '0',
    '0', 'LINE', '8', '0', '62', '256', '10', '0', '20', '0', '11', '10', '21', '0',
    '0', 'ENDBLK', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '8', '0', '62', '7', '2', 'P', '10', '0', '20', '0',
    '70', '0', '71', '0', '44', '10', '45', '10',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  assert.equal(only(d, 'line').length, 1, 'くり返し0で部品が消えている');
});

test('並べ置きが多すぎるときは打ち切り、打ち切ったぶんを数える', () => {
  // 壊れた図面に「横1000個・縦1000個」と書かれていると、そのまま並べると固まる。
  // 打ち切るのはよいが、**黙って捨てない**（10.5）。
  const dxf = [
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '2', 'P', '10', '0', '20', '0', '30', '0',
    '0', 'LINE', '8', '0', '62', '256', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDBLK', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '8', '0', '62', '7', '2', 'P', '10', '0', '20', '0',
    '70', '100', '71', '100', '44', '5', '45', '5',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n');

  const d = parseDxf(dxf);
  const 出た = only(d, 'line').length;
  assert.ok(出た > 0, '1個も出ていない');
  assert.ok(出た < 10000, `上限が効いていない（${出た} 個も並べた）`);
  assert.equal(
    d.unsupported.count, 10000 - 出た,
    '打ち切ったぶんを数えていない（黙って捨てている）'
  );
  assert.ok(
    d.unsupported.kinds['INSERT（並べ置きが多すぎるため打ち切り）'] > 0,
    '打ち切ったことが種類として出ていない'
  );
});
