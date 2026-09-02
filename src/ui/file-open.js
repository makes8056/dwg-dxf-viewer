// file-open.js — 図面ファイルを選んで読み込む係（開発ルール2.2）
//
// iPadのファイルアプリ／iCloudから .dxf .dwg を選んでもらい、
//   .dxf → decodeDxfBuffer() で文字コードを直す → parseDxf() で図形データにする
//   .dwg → まだ対応していない（案内メッセージを出す）
// までをこのファイルの中で行う。
//
// src/dxf-parse.js は他の人が今つくっている最中で、まだ無いかもしれない。
// そのため import はここでは書かず、実際に使うタイミングで dynamic import(動的読み込み)し、
// 失敗しても画面が壊れないようにしている。

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
  // .dwg も選べるようにしておく（選ばれたら「まだ対応していません」と案内するため）
  input.accept = '.dxf,.dwg';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.setAttribute('aria-hidden', 'true');
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

  if (ext === '.dwg') {
    handlers.onLoadError && handlers.onLoadError(
      'DWGは次の段階で対応します。今はCADで「DXF形式」で保存し直したものをお使いください。'
    );
    return;
  }

  if (ext !== '.dxf') {
    handlers.onLoadError && handlers.onLoadError(
      `「${name}」はDXFファイルではないようです。拡張子が .dxf のファイルを選んでください。`
    );
    return;
  }

  handlers.onLoadStart && handlers.onLoadStart();

  let dxfModule;
  try {
    // ../dxf-parse.js は他の人が今つくっている最中のファイル。
    // まだ用意できていない間は import が失敗するので、ここで受け止める。
    dxfModule = await import('../dxf-parse.js');
  } catch (err) {
    handlers.onLoadError && handlers.onLoadError(
      '図面を読み込む部品がまだ準備できていません。しばらくしてからもう一度お試しください。'
    );
    return;
  }

  const { decodeDxfBuffer, parseDxf } = dxfModule || {};
  if (typeof decodeDxfBuffer !== 'function' || typeof parseDxf !== 'function') {
    handlers.onLoadError && handlers.onLoadError(
      '図面を読み込む部品がまだ準備の途中です。しばらくしてからもう一度お試しください。'
    );
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
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
