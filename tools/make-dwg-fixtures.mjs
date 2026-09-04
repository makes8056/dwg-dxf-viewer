// tools/make-dwg-fixtures.mjs — DWG対応で使う見本DXFを作る（開発ルール34章）
//
// 手で書くと行のずれ（コードと値は必ず2行1組）を起こしやすいので、
// 組み立てて書き出す。npmは使わない決まりなので、Nodeの標準機能だけで作る。
//
//   node tools/make-dwg-fixtures.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 出力先 = path.join(ROOT, 'tests', 'fixtures');

/** コードと値の組を、DXFの文字にする（必ず2行1組にする）。 */
function dxf(組) {
  return 組.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

/**
 * レイヤー3つ・線3本の、ごく小さな図面を作る。
 * @param {number[]} 色たち レイヤーの色番号（マイナスなら「消してある」の合図）
 * @param {string} 説明
 */
function 作る(色たち, 説明) {
  const レイヤー名 = ['0', 'PIPE', 'DIM'];
  const 組 = [
    [999, 説明],
    [0, 'SECTION'], [2, 'HEADER'],
    [9, '$ACADVER'], [1, 'AC1015'],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'],
    [0, 'TABLE'], [2, 'LAYER'], [70, 色たち.length],
  ];
  色たち.forEach((色, i) => {
    組.push([0, 'LAYER'], [2, レイヤー名[i]], [70, 0], [62, 色]);
  });
  組.push([0, 'ENDTAB'], [0, 'ENDSEC']);

  組.push([0, 'SECTION'], [2, 'ENTITIES']);
  レイヤー名.forEach((名, i) => {
    組.push(
      [0, 'LINE'], [8, 名], [62, 256],
      [10, 0], [20, i * 10], [11, 100], [21, i * 10]
    );
  });
  組.push([0, 'ENDSEC'], [0, 'EOF']);
  return dxf(組);
}

const ファイル = [
  [
    'layers-all-off.dxf',
    作る(
      [-7, -1, -3],
      'DWGから変換したDXFの見本：全部のレイヤーの色がマイナス（消してある扱い）になっている'
    ),
  ],
  [
    'layers-some-off.dxf',
    作る([7, -1, 3], '一部のレイヤーだけ消してある見本：PIPEレイヤーだけがマイナス'),
  ],
];

for (const [名前, 中身] of ファイル) {
  const 先 = path.join(出力先, 名前);
  fs.writeFileSync(先, 中身, 'utf8');
  console.log('作りました:', 先, 中身.length + '文字');
}
