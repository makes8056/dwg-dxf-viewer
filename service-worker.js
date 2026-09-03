// service-worker.js — PWAのオフラインキャッシュ（開発ルール5章・21章）
//
// 04寸法取りアプリの service-worker.js を土台にしている（司令塔の指示）。
// 方針：
//   - アプリシェル（HTML/JS/CSS/JSON/アイコン）をinstall時に事前キャッシュし、オフラインで完全に動くようにする
//   - GitHub Pages は Cache-Control: max-age=600 を返し、しかもファイルごとに別々にキャッシュされる
//     （開発ルール21章）。「app.js は新しいのに render.js は古い」という混ざった状態を防ぐため、
//     Service Worker で「アプリ本体をまとめて1組」として扱う。
//   - 新しいバージョンを検出しても自動では有効化しない（self.skipWaiting()を呼ばない）。
//     ページ側（src/update-check.js）が「新しい版があります／更新」を表示し、
//     ユーザーが押したときだけ SKIP_WAITING メッセージを受けて有効化する
//     （黙って更新して作業中のデータを飛ばさないため。開発ルール5.2）
//   - キャッシュ名にバージョンを持たせ、activate時に古いバージョンのキャッシュだけ削除する
//   - IndexedDB（開いた図面の実データ。開発ルール20章）にはこのファイルは一切触れない。
//     Cache Storage（このファイルが操作する範囲）とIndexedDBは完全に別のストレージなので、
//     ここでの処理がIndexedDBのデータを消すことは構造的にありえない（開発ルール5.4）

// 【重要】新しい版を配布するときは、このCACHE_VERSIONを必ず変更すること。
// 変更しないと、ファイルの中身を更新してもservice-worker.js自体のバイト列が変わらない場合
// ブラウザが「更新なし」と判断し、新しい内容がキャッシュされないことがある。
const CACHE_VERSION = 'v0.1.7'; // 配布のたびに更新。src/version.jsのAPP_VERSIONと手動で合わせる運用
// （このファイルはクラシックスクリプトとして登録しているためimportできず、自動連動はできない）
const CACHE_NAME = `dxf-viewer-shell-${CACHE_VERSION}`;

// アプリシェル一覧。新しいsrc配下のファイルを追加したら、ここにも必ず追加すること。
// vendor/ と tests/ はまだ使っていない／アプリ本体ではないので入れない（司令塔の指示）。
const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/version.js',
  './src/drawing.js',
  './src/dxf-parse.js',
  './src/viewport.js',
  './src/render.js',
  './src/storage.js',
  './src/update-check.js',
  './src/ui/app.js',
  './src/ui/file-open.js',
  './src/ui/gestures.js',
  './src/ui/toolbar.js',
  './src/ui/ui.css',
];

// ------------------------------------------------------------
// 【本番事故対策】リダイレクト由来のレスポンスをキャッシュに入れない／返さない（開発ルール5.3）
//
// GitHub Pages も `/index.html` を `/` へリダイレクトすることがある。そのため addAll 方式で
// './index.html' を取ると、リダイレクトを追った結果（response.redirected === true）が保存される。
// これをナビゲーション要求に対して返すと、WebKit（iPad Safari）は仕様どおりこれを拒否し、
//   「ページを開けません。発生したエラー: Response served by service worker has redirections」
// になる。manifest.json の start_url が './' なので通常は踏まないが、
// 04では './index.html' にしていたために本番で実際に起きた事故であり、
// 対策そのもの（保存側・返す側の両方でリダイレクトを除く）は形式によらず必ず残す。
//
// body と headers から Response を作り直すと redirected は false になる。これが唯一の直し方で、
// 「リダイレクトを追わない（redirect:'manual'）」にすると中身が取れないので使えない。
async function toNonRedirectedResponse(res) {
  if (!res || !res.redirected) return res;
  return new Response(await res.blob(), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

// 事前キャッシュ用の取得。CacheStorage の addAll は内部で取得と保存を一度に行うため、
// 途中でリダイレクトを取り除けない。そのため自前で fetch → 作り直し → put する。
async function precacheInto(cache, path) {
  const res = await fetch(path, { cache: 'reload' });
  if (!res.ok) throw new Error(`事前キャッシュに失敗しました: ${path} -> ${res.status}`);
  await cache.put(path, await toNonRedirectedResponse(res));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 1つでも404等で失敗すると全体を失敗させる。オフライン動作の前提が崩れるファイルなので、
      // ここでは意図的に「1つでも欠けたら気づけるように」失敗させたままにする（黙って一部だけキャッシュしない。開発ルール21.3）。
      try {
        await Promise.all(APP_SHELL_FILES.map((path) => precacheInto(cache, path)));
      } catch (e) {
        // 【本番事故の再発防止】installが失敗しても、既存の（今動いている）古いキャッシュには
        // この時点で一切触っていないので、古い版のオフライン動作はそのまま維持される。
        // ここでは今回作りかけた中途半端な新キャッシュ（一部だけ入った状態）だけを片付け、
        // 次回アクセス時にもう一度installをやり直せる状態に戻す（ゴミを残さない＝混ざった状態を作らない）。
        await caches.delete(CACHE_NAME);
        throw e; // installを失敗のままにする（新しい版への切り替えをここで止める）
      }
    })()
  );
  // ここで self.skipWaiting() は呼ばない（開発ルール5.2：黙って更新しない）。
  // ユーザーが更新通知の「更新」を押すまで、新しいSWは待機状態のままにする。
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('dxf-viewer-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// ページ側から「更新してよい」と明示的に指示されたときだけ有効化する
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 書き込み系はそのまま素通し（このアプリはIndexedDBのみ使うため通常発生しない）

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他オリジンへのリクエストは扱わない

  event.respondWith(
    (async () => {
      // キャッシュ優先：オフラインでの確実な起動を最優先する（開発ルール5.1）
      const cached = await caches.match(req, { ignoreSearch: true });
      // 返す側でもリダイレクトを取り除く。install側の対策だけだと、
      // **すでに壊れたキャッシュが入っている端末が自力で復帰できない**ため両方で防ぐ（開発ルール5.3）。
      if (cached) return await toNonRedirectedResponse(cached);

      try {
        return await fetch(req);
      } catch (e) {
        // オフラインでキャッシュにも無い場合、ページ遷移は
        // アプリシェル(index.html)を返して起動だけは維持する
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return await toNonRedirectedResponse(shell);
        }
        throw e;
      }
    })()
  );
});
