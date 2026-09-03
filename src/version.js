// version.js — アプリの版番号（開発ルール3章）
//
// 版番号はこの1か所だけで管理する（他のファイルに直接書かない）。
// 画面右上に出す。src/ui/app.js が起動時にここから読む。
//
// 【重要】アプリ本体を変えたら、必ずこの APP_VERSION を1つ上げる。
// そのとき service-worker.js の CACHE_VERSION も同じ値に手で合わせること。
// 合わせ忘れると、中身を直してもブラウザが「更新なし」と判断し、
// 古い画面がユーザーに出続ける（04で実際に起きた事故）。
// service-worker.js は import ができない形で登録するため、自動連動はできない。

export const APP_VERSION = 'v0.2.3';
export const BUILD_DATE = '2026-09-04';
