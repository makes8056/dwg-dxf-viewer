// save-file.js — 作ったファイル（PDF・絵）を保存する（開発ルール56章）
//
// 【なぜこの係を分けたのか】
// 2026-09-24 ユーザーの指示：
//   「PDFで保存するときに保存先を指定できるようにしてください。
//     どこに保存されたかわからなくなる時があります」
//
// それまでは、見えないリンクを押させて保存していた（`<a download>`）。
// この方法は**置き場所を選べない。** ブラウザが決めた場所へ黙って入る。
// iPadでは「ファイル」アプリのダウンロードだが、設定で変えられるので、
// どこに入ったかは本人にも分からなくなる。
//
// 【このファイルは、どの道で保存するかを決めるだけ】
// 実際に共有メニューを開いたり、リンクを押したりするのは、呼び出す側（src/ui/app.js）が渡す。
// そうしておくと、iPadやパソコンが無くても**動かして確かめられる**（1ファイル1役割。開発ルール2.2）。
//
// 【待ち時間を作らないこと（開発ルール28.3）】
// 共有メニューは「指で押した流れ」の中で開かないと、iPadが開かせてくれない。
// そのため、この中では共有を呼ぶ前に await を1つも入れない。

/** 保存の道。どれを使ったかを、呼び出す側へ知らせるのに使う。 */
export const 共有メニュー = '共有メニュー';
export const 保存先を選ぶ画面 = '保存先を選ぶ画面';
export const ダウンロード = 'ダウンロード';

/**
 * ファイル名から、ファイルの種類（MIME）を決める。
 *
 * **ここを間違えると、iPadの共有メニューに「"ファイル"に保存」が出ないことがある。**
 * 印刷のときも同じ理由で種類をそろえている（開発ルール28.2）。
 */
export function fileTypeOf(name) {
  return /\.pdf$/i.test(String(name || '')) ? 'application/pdf' : 'image/png';
}

/**
 * ファイルを保存する。**置き場所を選べる道から順に試す。**
 *
 *   1. 共有メニュー（iPad）… 「"ファイル"に保存」を選ぶと、**フォルダーを選ぶ画面**が出る
 *   2. 保存先を選ぶ画面（パソコンのChrome・Edge）… ふつうの「名前を付けて保存」
 *   3. ダウンロード … 選べない。**どこに入ったかを必ず画面に出す**（それが今回の困りごとのため）
 *
 * @param {Blob|null} blob 保存する中身
 * @param {string} name ファイル名
 * @param {object} 道具 呼び出す側が渡す道具
 *   isApple             … iPad・iPhone か
 *   share(データ)        … 共有メニューを開く（Promise を返す）
 *   canShare(データ)     … その中身を共有できるか（無くてもよい）
 *   makeFile(blob,名前,種類) … 共有に渡す File を作る
 *   showSaveFilePicker(指定) … 保存先を選ぶ画面を出す（Promise を返す）
 *   download(blob,名前)  … ブラウザ任せのダウンロード（最後の道）
 * @param {object} 知らせ
 *   onSaved(方法)  … 保存できた。どの道を使ったかを渡す
 *   onCancel()     … ユーザーが自分でやめた（失敗ではない。何も出さないこと）
 *   onError(理由)  … 保存できなかった
 * @returns {string|null} 選んだ道（保存できなかったときは null）
 */
export function saveFile(blob, name, 道具 = {}, 知らせ = {}) {
  const 名前 = name || '図面.pdf';
  const 知らせる = (種類, ...引数) => {
    const f = 知らせ[種類];
    if (typeof f === 'function') f(...引数);
  };

  if (!blob) {
    知らせる('onError', new Error('保存するものがありません。もう一度範囲を囲んでください。'));
    return null;
  }

  // 最後の道。ほかの道が途中でだめになったときにも、ここへ落ちてくる。
  // **保存そのものをあきらめない。** 置き場所は選べないので、呼び出す側が場所を知らせる。
  const ダウンロードで保存 = () => {
    if (typeof 道具.download !== 'function') {
      知らせる('onError', new Error('この機械では保存できませんでした。'));
      return null;
    }
    try {
      道具.download(blob, 名前);
    } catch (err) {
      知らせる('onError', err);
      return null;
    }
    知らせる('onSaved', ダウンロード);
    return ダウンロード;
  };

  // 1. iPad：共有メニュー。「"ファイル"に保存」で置き場所を選べる。
  const file =
    typeof 道具.makeFile === 'function' ? 道具.makeFile(blob, 名前, fileTypeOf(名前)) : null;
  const 共有できる =
    道具.isApple &&
    typeof 道具.share === 'function' &&
    file &&
    (typeof 道具.canShare !== 'function' || 道具.canShare({ files: [file] }));

  if (共有できる) {
    // ここで await を入れてはいけない（28.3）。呼んだ結果をあとから受け取る。
    Promise.resolve(道具.share({ files: [file] })).then(
      () => 知らせる('onSaved', 共有メニュー),
      (err) => {
        // 自分でやめたときは、失敗ではない
        if (err && err.name === 'AbortError') {
          知らせる('onCancel');
          return;
        }
        // 共有がだめでも、保存はあきらめない
        ダウンロードで保存();
      }
    );
    return 共有メニュー;
  }

  // 2. パソコン：「名前を付けて保存」の画面（Chrome・Edge。Safariには無い）
  if (typeof 道具.showSaveFilePicker === 'function') {
    Promise.resolve(
      道具.showSaveFilePicker({
        suggestedName: 名前,
        types: [
          {
            description: /\.pdf$/i.test(名前) ? 'PDF' : '画像',
            accept: { [fileTypeOf(名前)]: [/\.pdf$/i.test(名前) ? '.pdf' : '.png'] },
          },
        ],
      })
    )
      .then(async (入れ物) => {
        const 書き込み = await 入れ物.createWritable();
        await 書き込み.write(blob);
        await 書き込み.close();
        知らせる('onSaved', 保存先を選ぶ画面);
      })
      .catch((err) => {
        if (err && err.name === 'AbortError') {
          知らせる('onCancel');
          return;
        }
        ダウンロードで保存();
      });
    return 保存先を選ぶ画面;
  }

  // 3. 選べない道。どこに入ったかは、呼び出す側が画面に出す。
  return ダウンロードで保存();
}
