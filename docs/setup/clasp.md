# clasp 疎通セットアップ手順（§12-4）

引継書§12-4「claspセットアップ→esbuildパイプライン→テストシートでサイドバー疎通」の**手動チェックリスト**。
コード側の準備（workspace・esbuildビルド・CI・スコープチェック）は実装済み。ここは認証が必要なため手動で行う。

前提: node 22.17.0（`.node-version`）、pnpm 11.10.0。OAuthスコープは CR-7 の3点固定（`apps-script/appsscript.json`）。

## チェックリスト

- [ ] 依存インストール: リポジトリルートで `pnpm install`
- [ ] clasp ログイン: `pnpm --filter apps-script exec clasp login`
      （ブラウザが開き Google 認証。公開に使うアカウントで実施）
- [ ] テスト用スプレッドシートを作成（Google ドライブで新規シート。任意の名前でよい）
- [ ] standalone スクリプトを用意する（どちらか）:
  - 新規作成する場合:
    `pnpm --filter apps-script exec clasp create --type standalone --title "会社リストクリーナー(dev)" --rootDir dist`
    → 生成された `.clasp.json`（gitignore 済み）の `rootDir` が `dist` になっていることを確認
    （R3-6: アドオンは standalone スクリプトとして作成する。コンテナバインドにはしない）
  - 既存の standalone スクリプトを使う場合:
    Apps Script のプロジェクト設定でスクリプトIDを控え、
    `apps-script/.clasp.json.example` をコピーして `apps-script/.clasp.json` を作成し
    `scriptId` を実値に、`rootDir` は `dist` のままにする
- [ ] ビルド＆push: `pnpm --filter apps-script push`
      （内部で `pnpm build`＝esbuild バンドル → `dist/` に Code.js / appsscript.json / sidebar.html を生成 → `clasp push`）
- [ ] サイドバー疎通を確認する（R3-6: エディタアドオンとしてテスト）:
      GAS エディタ →「デプロイ」→「デプロイをテスト」→ エディタアドオンとして
      テスト用スプレッドシートにインストールする
- [ ] インストールしたテスト用スプレッドシートで、メニュー「会社リストクリーナー」→
      「サイドバーを開く」でサイドバーが開くことを確認
- [ ] サイドバーの「Hello」ボタンを押し、`sayHello()` の結果（シート名を含む挨拶）が表示されることを確認
      → これで GAS ⇄ サイドバー（`google.script.run`）の疎通が確認できる（P0 DoD の "Hello" 動作）
- [ ] §12-5検証（追補v1.1 R3-1で「UserProperties方式の動作確認」に読み替え）:
      GAS エディタで `debugUserKeyProbe` を実行し、UUID が生成・保存され再実行で同一キーが
      返ることを確認、結果を docs/decisions.md に反映

## 注意

- `.clasp.json` は認証・スクリプトID を含むため gitignore 済み。コミットしない（雛形は `.clasp.json.example`）。
- スコープを3点から増やさない（CR-7）。`push` 後も `node scripts/check-oauth-scopes.mjs` で `dist/appsscript.json` を検証できる。
- Marketplace 公開にはデフォルトプロジェクトから**GCP標準プロジェクトへの紐付け**が必要。手順は `docs/setup/gcp-oauth.md §4`（Apps Script エディタ → プロジェクト設定 → GCP プロジェクト番号を設定）を参照。
- Marketplace SDK には**版指定デプロイ（HEADではない）**を紐付ける（R3-6）。審査後の更新は新しい版のデプロイ→SDK側の版切替で行う。
