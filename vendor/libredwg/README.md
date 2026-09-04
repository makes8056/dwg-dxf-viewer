# vendor/libredwg — DWGを読むための同梱部品

このフォルダーのファイルは、**このアプリが書いたものではありません。**
外部の部品をそのまま入れてあります（開発ルール35.5）。

## 何の部品か

| 項目 | 内容 |
| --- | --- |
| 名前 | `@mlightcad/libredwg-web` |
| 版 | **0.7.10** |
| 出どころ | https://www.npmjs.com/package/@mlightcad/libredwg-web |
| 元になっているもの | GNU LibreDWG（DWG/DXFを扱う定番の部品） |
| 使用許諾 | **GPL-3.0** |
| 取り込んだ日 | 2026-09-04 |

## 入っているファイル

| ファイル | 大きさ | 役目 |
| --- | --- | --- |
| `dist/libredwg-web.js` | 約263KB | 使いやすくした入口。`LibreDwg.create()` などがある |
| `wasm/libredwg-web.js` | 約108KB | WebAssemblyを動かすためのつなぎ |
| `wasm/libredwg-web.wasm` | **約9.7MB** | 本体（LibreDWGをWebAssemblyにしたもの） |

`dist/libredwg-web.js` は中で `../wasm/libredwg-web.js` を読み込みます。
**この2つのフォルダーの関係を崩さないこと。** 場所を変えると動かなくなります。

## 使用許諾（ライセンス）について

LibreDWG は **GPL-3.0** です。これを同梱して配るため、
**このアプリ全体も GPL-3.0 で公開しています**（リポジトリ直下の `LICENSE`）。

DWG対応をやめる場合は、次の2つを消せば GPL の制約から外れます。

- `src/dwg-parse.js`
- `vendor/libredwg/`（このフォルダー）

そのときは `LICENSE` と `README.md` も見直してください。

## 新しくするとき

1. 上の「出どころ」から新しい版のファイルを取り、**同じ場所・同じ名前**で置き換える
2. このREADMEの「版」と「取り込んだ日」を直す
3. `service-worker.js` の `DWG_ENGINE_VERSION` を新しい版に直す
   （直さないと、古い部品がしまわれたまま使われ続けます）
4. 実物のDWGを開いて、図面が出ることを目で確かめる

## 注意

- `.wasm` は**1バイトでも変わると動きません。**
  `.gitattributes` に `*.wasm binary` を入れて、改行コードの変換を止めてあります。
- この部品は約10MBあるので、**アプリ本体といっしょには読み込みません。**
  DWGを開こうとしたときだけ読み込み、別枠でしまいます（開発ルール35.3）。
