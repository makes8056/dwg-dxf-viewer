// tests/offline.test.js — オフライン対応（service-worker.js）が壊れていないかを見張る
//
// ここで守っているのは、**人が手で合わせる決まり** です。
// 手で合わせるものは、いつか必ず合わせ忘れます。だから機械に見張らせます。
//
// 動かし方：  node --test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ============================================================
// 1. 版番号の合わせ忘れ（開発ルール3.2・3.3）
// ============================================================

test('service-worker.js の CACHE_VERSION が、src/version.js の APP_VERSION と同じ', () => {
  // 【04で実際に起きた事故】
  // ここがずれていると、中身を直してもブラウザが「更新なし」と判断し、
  // **古いままの画面がユーザーに出続けます。**
  // 2か所を手で合わせる運用なので、必ず合わせ忘れます。だから機械が見張ります。
  const appVersion = read('src/version.js').match(/APP_VERSION\s*=\s*'([^']+)'/);
  const cacheVersion = read('service-worker.js').match(/CACHE_VERSION\s*=\s*'([^']+)'/);

  assert.ok(appVersion, 'src/version.js から APP_VERSION を読み取れない');
  assert.ok(cacheVersion, 'service-worker.js から CACHE_VERSION を読み取れない');
  assert.equal(
    cacheVersion[1],
    appVersion[1],
    `版番号がずれています。src/version.js は ${appVersion[1]}、` +
      `service-worker.js は ${cacheVersion[1]}。` +
      'ずれたままだと、直しても古い画面がユーザーに出続けます（開発ルール3.3）'
  );
});

// ============================================================
// 2. 事前に読み込むファイルの数え漏れ
// ============================================================

/** アプリ本体として、オフラインでも必要なファイルを実際に数える。 */
function actualAppFiles() {
  const files = ['index.html', 'manifest.json'];

  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) {
        walk(rel);
      } else if (/\.(js|css)$/.test(name)) {
        files.push(rel);
      }
    }
  };
  walk('src');

  for (const name of readdirSync(join(ROOT, 'icons'))) {
    if (/\.png$/i.test(name)) files.push(`icons/${name}`);
  }
  return files.sort();
}

/** service-worker.js に並べてある一覧を読む。 */
function listedAppFiles() {
  const block = read('service-worker.js').match(/APP_SHELL_FILES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, 'service-worker.js から APP_SHELL_FILES を読み取れない');
  return block[1]
    .split('\n')
    .map((line) => line.match(/'([^']+)'/))
    .filter(Boolean)
    .map((m) => m[1].replace(/^\.\//, ''))
    .filter((p) => p !== '') // './'（入口そのもの）は別扱い
    .sort();
}

test('オフライン用に読み込むファイルの一覧に、数え漏れが無い', () => {
  // 【数え漏れると何が起きるか】
  // そのファイルだけオフラインで読めず、**電波の無い現場でアプリが動かなくなります。**
  // 新しいファイルを足したときに、この一覧へ追加し忘れるのがいちばんありがちです。
  const missing = actualAppFiles().filter((f) => !listedAppFiles().includes(f));
  assert.deepEqual(
    missing,
    [],
    `オフライン用の一覧に入っていないファイルがあります：${missing.join('、')}\n` +
      'service-worker.js の APP_SHELL_FILES に追加してください。' +
      'このままだと電波の無い現場でアプリが動きません。'
  );
});

test('一覧に、実在しないファイルが入っていない', () => {
  // 【実在しないと何が起きるか】
  // 1つでも取得に失敗すると、その更新まるごとが取り消されます（開発ルール21.3）。
  // つまり**新しい版が永遠に届かなくなります。**
  const actual = actualAppFiles();
  const ghosts = listedAppFiles().filter((f) => !actual.includes(f));
  assert.deepEqual(
    ghosts,
    [],
    `一覧にあるのに実在しないファイルがあります：${ghosts.join('、')}\n` +
      'このままだと、新しい版が永遠に届かなくなります。'
  );
});

test('入口（./）が一覧に入っている', () => {
  // ホーム画面から起動したときに最初に読まれる場所。ここが無いとアプリが開かない。
  const raw = read('service-worker.js');
  assert.match(raw, /'\.\/'/, "APP_SHELL_FILES に './'（入口）が入っていない");
});

test('図面ファイルやテストは、オフライン用の一覧に入れない', () => {
  // 図面はお客様のもので、アプリ本体ではない。キャッシュに入れる対象ではない（開発ルール20.3）。
  const listed = listedAppFiles();
  const bad = listed.filter((f) => /\.(dxf|dwg)$/i.test(f) || f.startsWith('tests/') || f.startsWith('vendor/'));
  assert.deepEqual(bad, [], `一覧に入れてはいけないものが入っています：${bad.join('、')}`);
});

// ============================================================
// 3. 04で起きた本番事故の対策が消えていないか（開発ルール5.3）
// ============================================================

test('リダイレクト対策が、保存する側と返す側の両方に残っている', () => {
  // 【04で起きた本番事故】
  // リダイレクトされたレスポンスをキャッシュすると、
  // iPadのホーム画面から起動したときだけ**アプリが一切開かなくなります。**
  // 保存する側だけ直しても、**すでに壊れた端末が自力で直りません。**
  // だから両方に要ります。
  const sw = read('service-worker.js');
  assert.match(sw, /function toNonRedirectedResponse/, 'リダイレクト対策の関数が無い');

  const uses = (sw.match(/toNonRedirectedResponse\(/g) || []).length;
  assert.ok(
    uses >= 3,
    `リダイレクト対策の使用箇所が少なすぎます（${uses}か所）。` +
      '関数の定義1つに加えて、保存する側と返す側の両方で使う必要があります（開発ルール5.3）'
  );
});

test('install の中で skipWaiting を呼んでいない（黙って更新しない）', () => {
  // 黙って切り替えると、現場で図面を見ている最中に画面が変わってしまう（開発ルール5.2）。
  const sw = read('service-worker.js');
  const installBlock = sw.match(/addEventListener\('install'[\s\S]*?addEventListener\('activate'/);
  assert.ok(installBlock, 'install の処理が見つからない');

  // コメント行を除いて、実際に呼んでいる行があるかを見る
  const calls = installBlock[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .filter((line) => /self\.skipWaiting\s*\(/.test(line));
  assert.deepEqual(
    calls,
    [],
    'install の中で skipWaiting を呼んでいます。' +
      '黙って更新すると、現場で図面を見ている最中に画面が変わってしまいます（開発ルール5.2）'
  );
});

// ============================================================
// 4. ホーム画面に追加するための設定（開発ルール5.3）
// ============================================================

test('manifest.json の start_url が "./" になっている', () => {
  // 【04で起きた本番事故】
  // ここを "./index.html" にすると、iPadのホーム画面から起動したときだけ
  // 「Response served by service worker has redirections」というエラーで
  // **アプリが一切開かなくなります。**
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(
    manifest.start_url,
    './',
    'start_url は "./" でなければなりません。' +
      '"./index.html" にすると、iPadのホーム画面から起動したときアプリが開かなくなります（開発ルール5.3）'
  );
  assert.equal(manifest.scope, './');
});

test('manifest.json に日本語の名前とアイコンがある', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.name && manifest.short_name, '名前が無い');
  assert.equal(manifest.lang, 'ja');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'アイコンが足りない');
  for (const icon of manifest.icons) {
    const path = icon.src.replace(/^\.\//, '');
    assert.doesNotThrow(
      () => statSync(join(ROOT, path)),
      `manifest.json が指しているアイコンが実在しません：${icon.src}`
    );
  }
});

test('index.html が manifest.json を読み込んでいる', () => {
  // 読み込んでいないと、ホーム画面に追加してもアプリとして起動しない
  const html = read('index.html');
  assert.match(html, /rel="manifest"/, 'index.html が manifest.json を読み込んでいない');
});
