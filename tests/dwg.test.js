// tests/dwg.test.js — DWGを開けるようにした部分のテスト（開発ルール34章・35章）
//
// DWG本体（WebAssembly）はnodeでは動かせないので、ここでは
//   - DWGから変換したDXFで起きる「全部のレイヤーが消えている」問題（34章）
//   - つなぎ方が決めたとおりになっているか（35章）
// を確かめる。実際にDWGが開けることは、ブラウザで実物のDWGを開いて確かめる。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDxf } from '../src/dxf-parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = (name) => read(path.join('tests', 'fixtures', name));

// ============================================================
// 34章：全部のレイヤーが「消してある」ことになっている図面
// ============================================================

test('全部のレイヤーが消してある図面は、消えていない扱いにする', () => {
  // 【実物で起きたこと】
  // DXFでは、レイヤーの色番号（62）がマイナスなら「そのレイヤーは非表示」。
  // ところがDWGから変換したDXFは、**全部のレイヤーの色がマイナス**で出てくる。
  // 同じ図面で比べた実測：
  //   AutoCADのDXF … 0番=7  DIM=3  PIPE=1
  //   DWGから変換  … 0番=-7 DIM=-3 PIPE=-1（色の値は同じ。符号だけ違う）
  // そのまま信じると**図面が1つも表示されない**（実際にそうなった）。
  const d = parseDxf(fixture('layers-all-off.dxf'));
  assert.equal(d.entities.length, 3, '図形が消えている。DWGの図面が真っ白になる');
  assert.equal(d.layers.filter((l) => l.visible).length, 3, '見えるレイヤーが足りない');
});

test('一部のレイヤーだけ消してある図面は、その指定をちゃんと守る', () => {
  // こちらは本当に「CADで消してある」ので、消したままにしなければいけない。
  // 34章の直しが効きすぎて、消したはずのものまで出てしまってはいけない。
  const d = parseDxf(fixture('layers-some-off.dxf'));
  assert.equal(d.entities.length, 2, '消してあるレイヤーの図形まで出ている');
  assert.deepEqual(d.entities.map((e) => e.layer).sort(), ['0', 'DIM']);
  const 消えている = d.layers.filter((l) => !l.visible).map((l) => l.name);
  assert.deepEqual(消えている, ['PIPE'], '消えているレイヤーが違う');
});

test('レイヤーの色は、符号を無視しても正しい色になる', () => {
  // 符号は当てにならないが、色の数字そのものは正しい
  const 全部消し = parseDxf(fixture('layers-all-off.dxf'));
  const 一部消し = parseDxf(fixture('layers-some-off.dxf'));
  const 色 = (d, 名) => d.layers.find((l) => l.name === 名).color;
  assert.equal(色(全部消し, 'PIPE'), 色(一部消し, 'PIPE'), 'PIPEレイヤーの色が食い違う');
  assert.equal(色(全部消し, 'DIM'), 色(一部消し, 'DIM'), 'DIMレイヤーの色が食い違う');
});

test('凍結（FROZEN）は、符号の話とは別に必ず守る', () => {
  // 色の符号は当てにならないが、凍結はれっきとした別の情報。
  // 34章の直しで、凍結まで無視してしまってはいけない。
  const src = read('src/dxf-parse.js');
  const i = src.indexOf('function fixAllLayersOff');
  assert.ok(i >= 0, '直す処理が見つからない');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /layer\.visible = !layer\.frozen/, '凍結を無視してしまっている');
});

test('図形を組み立てる前に直している', () => {
  // あとから直しても、いちど消された図形は戻らない
  const src = read('src/dxf-parse.js');
  const 直す = src.indexOf('fixAllLayersOff(layers);');
  const 組み立て = src.indexOf('expandRecords(topEntityRecords');
  assert.ok(直す >= 0, '直す処理を呼んでいない');
  assert.ok(組み立て >= 0, '図形の組み立てが見つからない');
  assert.ok(直す < 組み立て, '図形を組み立てたあとに直している。消えた図形は戻らない');
});

// ============================================================
// 35章：DWGのつなぎ方
// ============================================================

test('DWGは、DXFに変換してから同じ道を通す（読み解く係を2つ作らない）', () => {
  // 【いちばん大事な決まり】
  // dxf-parse.js には実物の図面で見つけた直しがたくさん入っている。
  // DWG用にもう1つ読み解く係を作ると、同じ直しを2か所でやることになり、必ず食い違う。
  const src = read('src/dwg-parse.js');
  assert.match(src, /dwg_write_dxf/, 'DXFへの変換を使っていない');
  assert.match(src, /from '\.\/dxf-parse\.js'/, 'DXFの係に渡していない');
  assert.match(src, /parseDxf\(/, 'DXFの係を呼んでいない');
  // 図形を自分で組み立てていないこと（＝読み解く係を作っていないこと）
  assert.ok(
    !/createDrawing|addEntity|finishDrawing/.test(src),
    'dwg-parse.js が自分で図形を組み立てている。直しが2か所に分かれる'
  );
});

test('元がDWGだったことを記録している', () => {
  const src = read('src/dwg-parse.js');
  assert.match(src, /drawing\.source = 'dwg'/, 'どちらから読んだか分からなくなる');
});

test('DWGの部品は、アプリ本体といっしょに読み込まない（約10MBあるため）', () => {
  // いっしょに読み込むと、DXFしか使わない人にも毎回10MBを背負わせることになる
  const fileOpen = read('src/ui/file-open.js');
  assert.match(fileOpen, /await import\('\.\.\/dwg-parse\.js'\)/, '必要なときだけ読み込む形になっていない');
  const app = read('src/ui/app.js');
  assert.ok(!/dwg-parse/.test(app), 'app.js が最初からDWGの部品を読み込んでいる');
});

test('DWGファイルを、ちゃんとDWGとして扱っている', () => {
  const src = read('src/ui/file-open.js');
  assert.match(src, /openDwgBuffer\(name, buffer, handlers\)/, 'DWGをDWGの係に渡していない');
  assert.ok(
    !/DWGは次の段階で対応します/.test(src),
    '「まだ対応していない」という古い案内が残っている'
  );
});

test('同梱した部品の置き場所を、import.meta.url から決めている', () => {
  // GitHub Pages ではアプリがサイトの下の階層に置かれる。
  // 場所を決め打ちにすると、本番だけ部品が見つからなくなる。
  const src = read('src/dwg-parse.js');
  assert.match(src, /new URL\([^)]*import\.meta\.url\)/, '置き場所を決め打ちにしている');
});

// ============================================================
// 35.3：10MBの部品を、どこにしまうか
// ============================================================

test('DWGの部品は、アプリ本体の事前読み込みに入れない', () => {
  // 事前読み込みは「1つでも失敗したら全部やり直し」。
  // 10MBを入れると、読み込みが1回途切れただけでアプリの更新が止まる。
  const sw = read('service-worker.js');
  const i = sw.indexOf('const APP_SHELL_FILES');
  const 一覧 = sw.slice(i, sw.indexOf('];', i));
  assert.ok(!/vendor/.test(一覧), 'DWGの部品が事前読み込みに入っている');
  assert.match(一覧, /'\.\/src\/dwg-parse\.js'/, 'dwg-parse.js が事前読み込みに入っていない');
});

test('DWGの部品は、アプリを更新しても消さない', () => {
  // 消すと、更新のたびに10MBを読み直すことになる
  const sw = read('service-worker.js');
  assert.match(sw, /DWG_ENGINE_CACHE/, '別枠のしまい場所が無い');
  const i = sw.indexOf("addEventListener('activate'");
  const body = sw.slice(i, sw.indexOf('});', i));
  assert.match(
    body,
    /key !== DWG_ENGINE_CACHE/,
    '今使っている部品の枠まで消している。更新のたびに10MB読み直しになる'
  );
});

test('DWGの部品は、しまい損ねても表示は続ける', () => {
  // 容量がいっぱいでしまえなかっただけで、今回の表示まで巻き添えにしない
  const sw = read('service-worker.js');
  const i = sw.indexOf('async function handleDwgEngineRequest');
  assert.ok(i >= 0, '部品用の処理が無い');
  const body = sw.slice(i, sw.indexOf('\n}\n', i));
  assert.match(body, /try\s*\{[\s\S]*cache\.put[\s\S]*catch/, 'しまうのに失敗すると表示まで失敗する');
  assert.match(body, /return res/, '取ってきたものを返していない');
});

// ============================================================
// 同梱した部品そのもの
// ============================================================

test('同梱した部品のファイルが、そろっている', () => {
  for (const rel of [
    'vendor/libredwg/dist/libredwg-web.js',
    'vendor/libredwg/wasm/libredwg-web.js',
    'vendor/libredwg/wasm/libredwg-web.wasm',
  ]) {
    const 先 = path.join(ROOT, rel);
    assert.ok(fs.existsSync(先), `${rel} が無い。DWGが開けなくなる`);
    assert.ok(fs.statSync(先).size > 1000, `${rel} が小さすぎる。取り込みに失敗している`);
  }
});

test('WebAssemblyが、改行コードの変換で壊されないようにしてある', () => {
  // 1バイトでも変わると動かなくなる
  const attrs = read('.gitattributes');
  assert.match(attrs, /\*\.wasm\s+binary/, '.gitattributes に *.wasm binary が無い');
});

test('同梱した部品の出どころと使用許諾を書き残している', () => {
  // GPLの部品を同梱している。どこから持ってきた何なのかを残す（開発ルール35.5）
  const readme = read('vendor/libredwg/README.md');
  assert.match(readme, /LibreDWG/, '何の部品か書いていない');
  assert.match(readme, /GPL/, '使用許諾を書いていない');
  assert.match(readme, /0\.7\.10/, '版を書いていない');
});
