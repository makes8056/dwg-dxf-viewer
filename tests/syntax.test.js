// tests/syntax.test.js — src の全ファイルが、ブラウザで読める形かを確かめる（開発ルール56章）
//
// 【なぜ要るのか（2026-09-24 に実際に起きた）】
// src/ui/app.js の文字列の中に、**本当の改行**が入ってしまった。
//   'ファイルを保存できませんでした。
//   ' + …
// これはJavaScriptとして壊れているので、**ブラウザではアプリが丸ごと動かない。**
//
// ところが、それまでのテストは1件も気づかなかった：
//   - テストは app.js を**文字として読む**だけで、動かしていない
//     （画面の部品が要るので、テストの中では動かせない）
//   - `node --check app.js` も通ってしまった（.js は別の読み方で見られるため）
//
// そこで **拡張子を .mjs にした写しを作って構文を見る。**
// これならブラウザと同じ読み方になり、壊れていれば必ず失敗する。
// 中身は動かさないので、画面の部品が無くても確かめられる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** src の下にある .js を全部集める（下の階層も）。 */
function jsファイルを集める(dir, 集めた = []) {
  for (const 名前 of readdirSync(dir, { withFileTypes: true })) {
    const 場所 = join(dir, 名前.name);
    if (名前.isDirectory()) jsファイルを集める(場所, 集めた);
    else if (名前.name.endsWith('.js')) 集めた.push(場所);
  }
  return 集めた;
}

test('src の全ファイルが、ブラウザと同じ読み方で構文どおりになっている', () => {
  const ファイルたち = jsファイルを集める(join(ROOT, 'src'));
  assert.ok(ファイルたち.length >= 20, `src のファイルを数え損ねている（${ファイルたち.length}個）`);

  const 作業場 = mkdtempSync(join(tmpdir(), 'dxf-syntax-'));
  const 壊れている = [];
  try {
    for (const 場所 of ファイルたち) {
      // 拡張子を .mjs にした写しを作る。これでブラウザと同じ読み方になる
      const 写し = join(作業場, 'a.mjs');
      writeFileSync(写し, readFileSync(場所));
      try {
        execFileSync(process.execPath, ['--check', 写し], { stdio: 'pipe' });
      } catch (err) {
        const 理由 = String((err && err.stderr) || err).split('\n').slice(0, 4).join(' / ');
        壊れている.push(`${relative(ROOT, 場所)} … ${理由}`);
      }
    }
  } finally {
    rmSync(作業場, { recursive: true, force: true });
  }

  assert.deepEqual(壊れている, [], `構文が壊れているファイルがある：\n${壊れている.join('\n')}`);
});
