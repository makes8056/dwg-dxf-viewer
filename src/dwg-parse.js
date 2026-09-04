// dwg-parse.js — DWGファイルを読む係（開発ルール35章）
//
// 【この係の役目】
//   DWGを自分で読み解くのではなく、
//   **DWGをDXFに変換してから、いつものDXFの係（dxf-parse.js）に渡す。**
//
//     DWGファイル → [LibreDWG] → DXFの文字 → dxf-parse.js → 図形データ
//
//   なぜそうするか：
//   dxf-parse.js には、実物の図面で見つけた直しがたくさん入っている
//   （文字コードの見分け・ブロックの中の色・寸法の文字の向き・見えない図形…）。
//   DWG用にもう1つ「読み解く係」を作ると、**同じ直しを2か所でやることになり、
//   必ずどちらかが古くなって食い違う。** 変換して1本の道に合流させれば、直しは1か所で済む。
//
//   実際に同じ図面（参考図）で比べたところ、
//   AutoCADが書き出したDXFと、このやり方でDWGから読んだものは
//   **図形602個・種類・色・範囲まで、すべて一致した。**
//
// 【GPLの部品に触れるのは、このファイルだけ】
//   変換には LibreDWG（GPL-3.0）をWebAssemblyにしたものを同梱して使う
//   （vendor/libredwg/）。この決まりのおかげで、
//   DWG対応をやめたくなったら **このファイルと vendor/libredwg を消すだけ**で済む。
//   （そのときはLICENSEも見直すこと）
//
// 【大きさの注意】
//   変換の部品はぜんぶで約10MBある。**アプリ本体といっしょには読み込まない。**
//   DWGを開こうとした、そのときだけ読み込む。
//   一度読み込めば service-worker.js が別枠でしまっておくので、
//   2回目からは電波が無くても使える（開発ルール35.3）。

import { decodeDxfBuffer, parseDxf } from './dxf-parse.js';

// 同梱した部品の置き場所。
// import.meta.url を基準にするので、GitHub Pages のようにアプリが
// サイトの下の階層に置かれていても、正しい場所を指す。
const 部品のURL = new URL('../vendor/libredwg/dist/libredwg-web.js', import.meta.url).href;
// WebAssembly本体（.wasm）の置き場。末尾に / を付けないこと
// （部品の中で `${この文字列}/libredwg-web.wasm` という形で使われる）。
const WASMの置き場 = new URL('../vendor/libredwg/wasm', import.meta.url).href;

/** 用意した変換の部品。一度用意したら使い回す（10MBを何度も読み込まない）。 */
let 用意した部品 = null;
/** 用意している最中の約束。同時に2回呼ばれても、読み込みは1回で済ませる。 */
let 用意中 = null;

const 用意できない =
  'DWGを読む部品を用意できませんでした。\n' +
  '電波の届くところで、もう一度お試しください。\n' +
  '（一度読み込めば、次からは電波が無くても開けます）';

/**
 * DWGを読む部品（LibreDWG）を用意する。
 * 初回だけ約10MBの読み込みが起きる。2回目からはすぐ返る。
 *
 * @param {(message:string)=>void} [onProgress] 進み具合を伝える先（日本語）
 * @returns {Promise<object>} LibreDwg のインスタンス
 */
export async function prepareDwgEngine(onProgress) {
  if (用意した部品) return 用意した部品;

  if (!用意中) {
    用意中 = (async () => {
      onProgress && onProgress('DWGを読む部品を用意しています（初回のみ・約10MB）…');
      const mod = await import(/* @vite-ignore */ 部品のURL);
      if (!mod || !mod.LibreDwg || typeof mod.LibreDwg.create !== 'function') {
        throw new Error('部品の形が想定と違う');
      }
      const lib = await mod.LibreDwg.create(WASMの置き場);
      if (!lib || typeof lib.dwg_write_dxf !== 'function') {
        throw new Error('DWGをDXFに変換する機能が入っていない');
      }
      用意した部品 = lib;
      return lib;
    })().catch((err) => {
      // 失敗したら「用意中」を空に戻す。
      // ここを戻さないと、電波が回復しても二度と試せなくなる。
      用意中 = null;
      throw err;
    });
  }

  return 用意中;
}

/** 部品が用意済みかどうか（画面の案内を変えるのに使う）。 */
export function isDwgEngineReady() {
  return 用意した部品 !== null;
}

/**
 * DWGファイルの中身を読んで、図形データにする。
 *
 * 失敗したときは、日本語の理由をつけた Error を投げる
 * （呼び出し側がそのまま画面に出せるようにする）。
 *
 * @param {ArrayBuffer|Uint8Array} buffer DWGファイルの中身
 * @param {object} [options] { onProgress }
 * @returns {Promise<object>} src/drawing.js の形の図形データ（source は 'dwg'）
 */
export async function parseDwg(buffer, options = {}) {
  const { onProgress } = options;

  let lib;
  try {
    lib = await prepareDwgEngine(onProgress);
  } catch (err) {
    throw new Error(用意できない);
  }

  onProgress && onProgress('DWGを読み込んでいます…');

  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  let dxfBytes;
  try {
    dxfBytes = lib.dwg_write_dxf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (err) {
    throw new Error(
      'このDWGを読み込めませんでした。\n' +
        'CADで「DXF形式」として保存し直したものでお試しください。'
    );
  }

  if (!dxfBytes || !dxfBytes.length) {
    throw new Error(
      'このDWGを読み込めませんでした。ファイルが壊れているか、対応していない形式かもしれません。\n' +
        'CADで「DXF形式」として保存し直したものでお試しください。'
    );
  }

  // ここから先は、DXFのときとまったく同じ道を通る（35.1）
  const text = decodeDxfBuffer(dxfBytes);
  const drawing = parseDxf(text);

  if (!drawing || !Array.isArray(drawing.entities)) {
    throw new Error('このDWGを読み込みましたが、中身が図面のデータになっていませんでした。');
  }

  // 元がDWGだったことだけ記録しておく（画面表示と不具合調査用。drawing.js の決まり）
  drawing.source = 'dwg';
  return drawing;
}
