// file-open.js — 図面ファイルを選んで読み込む係（開発ルール2.2）
//
// iPadのファイルアプリ／iCloudから .dxf .dwg を選んでもらい、
//   .dxf → decodeDxfBuffer() で文字コードを直す → parseDxf() で図形データにする
//   .dwg → まだ対応していない（案内メッセージを出す）
// までをこのファイルの中で行う。
//
// src/dxf-parse.js は、実際にファイルが選ばれたときに読み込む（動的読み込み）。
// アプリを開いた直後に読まないので、起動が軽くなる。
// 万一読み込めなくても、画面が真っ白にならず日本語の案内が出るようにしてある。

/**
 * 「図面を開く」の仕組みを用意する。
 * @param {object} handlers
 *   onLoadStart()                … 読み込みを始めた（「読み込み中…」を出す）
 *   onLoadSuccess(drawing, name) … 読み込みに成功した（drawing は src/drawing.js の形）
 *   onLoadError(message)         … 失敗した。message は日本語の理由
 * @returns {{ open: () => void }} open() を呼ぶと、ファイルを選ぶ画面が開く
 */
export function setupFileOpen(handlers = {}) {
  const input = document.createElement('input');
  input.type = 'file';

  // 【iPadで起きた不具合。絶対に accept を付け直さないこと】
  //
  // ここに accept = '.dxf,.dwg' と書いてありました。
  // すると **iPadのファイルアプリで、DXFファイルが灰色になって選べなくなります。**
  //
  // 理由：iPadは accept に書いた拡張子を「iPadが知っているファイルの種類」に
  // 読み替えてから絞り込みます。ところが .dxf と .dwg は iPad が知らない種類なので
  // 読み替えに失敗し、結果として**すべてのファイルが選べなくなります。**
  //
  // そのため、ここでは種類を絞りません。どのファイルでも選べる状態にしておき、
  // 選ばれたあとに handleFile() が中身と拡張子を見て判断します。
  // （絞り込みを付け直すと、現場で図面が開けなくなります）
  // 見えないようにするが、画面の外へ飛ばしたり display:none にはしない。
  // iPadでは、完全に消した入力欄を押してもファイル選択の画面が開かないことがある。
  // 透明にして1ピクセルだけ置いておくのが、いちばん確実な置き方。
  input.style.position = 'fixed';
  input.style.top = '0';
  input.style.left = '0';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  input.setAttribute('aria-hidden', 'true');
  input.setAttribute('tabindex', '-1');
  document.body.appendChild(input);

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    // 同じファイルをもう一度選んでも change が起きるように、毎回空にしておく
    input.value = '';
    if (!file) return;
    handleFile(file, handlers);
  });

  return {
    open() {
      input.click();
    },
  };
}

/**
 * 選ばれたファイル1つを読み込む。
 * @param {File} file
 * @param {object} handlers setupFileOpen() に渡したものと同じ
 */
async function handleFile(file, handlers) {
  const name = file.name || 'ファイル';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';

  handlers.onLoadStart && handlers.onLoadStart();

  // 中身の先頭を見て、本当は何のファイルなのかを確かめる。
  // 拡張子だけで決めると、名前が違うだけで開けない図面が出てしまう。
  let head;
  let buffer;
  try {
    buffer = await file.arrayBuffer();
    head = new TextDecoder('utf-8').decode(new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength)));
  } catch (err) {
    handlers.onLoadError && handlers.onLoadError(
      `「${name}」を読み込めませんでした。もう一度お試しください。`
    );
    return;
  }

  // DWGは先頭に「AC1015」のような目印が入っている
  const looksLikeDwg = /^AC10\d\d/.test(head);
  if (ext === '.dwg' || looksLikeDwg) {
    handlers.onLoadError && handlers.onLoadError(
      'DWGは次の段階で対応します。今はCADで「DXF形式」で保存し直したものをお使いください。'
    );
    return;
  }

  // DXFは文字で書かれていて、必ず SECTION という言葉が先頭のほうに出てくる
  const looksLikeDxf = head.includes('SECTION') || head.includes('$ACADVER') || head.includes('AutoCAD Binary DXF');
  if (ext !== '.dxf' && !looksLikeDxf) {
    handlers.onLoadError && handlers.onLoadError(
      `「${name}」は図面ファイル（DXF）ではないようです。\n` +
        'CADで「DXF形式」として保存したファイルを選んでください。'
    );
    return;
  }

  let dxfModule;
  try {
    // 通信が切れているなど、読み込めない場合に備えて受け止める。
    dxfModule = await import('../dxf-parse.js');
  } catch (err) {
    handlers.onLoadError && handlers.onLoadError(
      '図面を読み込む部品を用意できませんでした。通信が切れている可能性があります。\n' +
        '一度ページを開き直してから、もう一度お試しください。'
    );
    return;
  }

  const { decodeDxfBuffer, parseDxf } = dxfModule || {};
  if (typeof decodeDxfBuffer !== 'function' || typeof parseDxf !== 'function') {
    handlers.onLoadError && handlers.onLoadError(
      '図面を読み込む部品が正しく読み込めませんでした。\n' +
        '一度ページを開き直してから、もう一度お試しください。'
    );
    return;
  }

  try {
    // buffer は上の「中身の確認」ですでに読んである。大きな図面を2回読まないよう使い回す。
    const text = decodeDxfBuffer(buffer);
    const drawing = parseDxf(text);

    if (!drawing || !Array.isArray(drawing.entities)) {
      handlers.onLoadError && handlers.onLoadError(
        `「${name}」を読み込みましたが、中身が図面のデータになっていませんでした。ファイルが壊れている可能性があります。`
      );
      return;
    }

    if (drawing.entities.length === 0 && (!drawing.unsupported || drawing.unsupported.count === 0)) {
      handlers.onLoadError && handlers.onLoadError(
        `「${name}」の中に、表示できる図形が見つかりませんでした。空の図面か、対応していない形式の可能性があります。`
      );
      return;
    }

    handlers.onLoadSuccess && handlers.onLoadSuccess(drawing, name);
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    handlers.onLoadError && handlers.onLoadError(
      `「${name}」を読み込めませんでした。ファイルが壊れているか、対応していない内容が含まれている可能性があります。\n詳細：${detail}`
    );
  }
}
