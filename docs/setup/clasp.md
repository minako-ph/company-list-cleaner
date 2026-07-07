# clasp 疎通セットアップ手順（§12-4）

引継書§12-4「claspセットアップ→esbuildパイプライン→テストシートでサイドバー疎通」の**手動チェックリスト**。
コード側の準備（workspace・esbuildビルド・CI・スコープチェック）は実装済み。ここは認証が必要なため手動で行う。

前提: node 22.17.0（`.node-version`）、pnpm 11.10.0。OAuthスコープは CR-7 の3点固定（`apps-script/appsscript.json`）。

## チェックリスト

- [ ] 依存インストール: リポジトリルートで `pnpm install`
- [ ] clasp ログイン: `pnpm --filter apps-script exec clasp login`
      （ブラウザが開き Google 認証。公開に使うアカウントで実施）
- [ ] テスト用スプレッドシートを作成（Google ドライブで新規シート。任意の名前でよい）
- [ ] コンテナバインドスクリプトを用意する（どちらか）:
  - 新規作成する場合:
    `pnpm --filter apps-script exec clasp create --type sheets --title "会社リストクリーナー(dev)" --rootDir dist`
    → 生成された `.clasp.json`（gitignore 済み）の `rootDir` が `dist` になっていることを確認
  - 既存シートのスクリプトを使う場合:
    シートの「拡張機能 → Apps Script」でスクリプトIDを控え、
    `apps-script/.clasp.json.example` をコピーして `apps-script/.clasp.json` を作成し
    `scriptId` を実値に、`rootDir` は `dist` のままにする
- [ ] ビルド＆push: `pnpm --filter apps-script push`
      （内部で `pnpm build`＝esbuild バンドル → `dist/` に Code.js / appsscript.json / sidebar.html を生成 → `clasp push`）
- [ ] 対象スプレッドシートを再読み込み
- [ ] メニュー「会社リストクリーナー」→「サイドバーを開く」でサイドバーが開くことを確認
- [ ] サイドバーの「Hello」ボタンを押し、`sayHello()` の結果（シート名を含む挨拶）が表示されることを確認
      → これで GAS ⇄ サイドバー（`google.script.run`）の疎通が確認できる（P0 DoD の "Hello" 動作）
- [ ] §12-5検証: GAS エディタで `debugUserKeyProbe` を実行し、出力 JSON を docs/decisions.md に反映
      （`activeUserEmail` 有無で方式①（em:）／②（up:）のどちらが主経路になるか確認。
       事前に Script Properties へ `USER_KEY_SALT` を設定しておくと em: 経路のハッシュ生成まで確認できる）

## 注意

- `.clasp.json` は認証・スクリプトID を含むため gitignore 済み。コミットしない（雛形は `.clasp.json.example`）。
- スコープを3点から増やさない（CR-7）。`push` 後も `node scripts/check-oauth-scopes.mjs` で `dist/appsscript.json` を検証できる。
- Marketplace 公開にはデフォルトプロジェクトから**GCP標準プロジェクトへの紐付け**が必要。手順は `docs/setup/gcp-oauth.md §4`（Apps Script エディタ → プロジェクト設定 → GCP プロジェクト番号を設定）を参照。
