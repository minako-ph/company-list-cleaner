# 独自ドメイン・GitHub Pages 公開 セットアップ手順（§12-3）

引継書 P0「独自ドメイン取得＋LP/PP/ToS 公開」およびマーケティング戦略書 §6 に対応する**手動チェックリスト**。
LP・プライバシーポリシー・利用規約の公開は、Google OAuth ブランド確認（引継書 §5）の前提条件。
作業完了ごとにチェックを入れ、確定値は末尾の「確定値」に記録し、`docs/decisions.md` に1行残すこと。

## 前提

- 公開する静的ファイルは `web/` 配下（`index.html` / `privacy.html` / `terms.html` / `tokushoho.html` / `assets/style.css`）。
- デプロイは `.github/workflows/pages.yml`（`web/**` の push または手動実行でトリガー）。
- 初期予算内（ドメイン年1,500円程度）。

## 1. ドメイン取得

- [ ] ドメイン候補を決定する（**TODO: ドメイン名未確定**）
  - 候補の考え方: 短く・日本語検索で覚えやすく・サービス内容と整合。`.com` / `.jp` / `.app` 等。
- [ ] レジストラで取得（例: お名前.com、Google Domains 後継の Squarespace Domains、Cloudflare Registrar、Xserver ドメイン 等）
  - Cloudflare Registrar は原価に近く更新も安価。DNS 管理も同社で完結できる。

## 2. GitHub Pages を有効化

- [ ] GitHub リポジトリ → Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定
- [ ] `master` ブランチへ `web/**` を push すると `pages.yml` が走り、`web/` がそのまま公開される
- [ ] まずは `https://<user>.github.io/<repo>/` で表示確認（独自ドメイン設定前）

## 3. カスタムドメインと CNAME / DNS 設定

- [ ] GitHub リポジトリ → Settings → Pages → Custom domain に取得したドメインを入力して保存
  - これにより GitHub 側に CNAME 情報が登録される。
- [ ] **`web/CNAME` ファイルを追加する**（ドメイン確定後）:
  - 内容はドメイン名1行のみ（例: `example.com`）。`web/` 配下に置くことで artifact に含まれ、デプロイ時に反映される。
  - **本タスク時点ではドメイン未確定のため未作成**。ドメイン確定後にこのファイルを作成すること。
- [ ] DNS レコードを設定（レジストラ／DNS プロバイダ側）:
  - Apex ドメイン（`example.com`）の場合: A レコードを GitHub Pages の IP 4件（`185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153`）に向ける。または ALIAS/ANAME で `<user>.github.io` を指す。
  - サブドメイン（`www.example.com` 等）の場合: CNAME レコードを `<user>.github.io` に向ける。
  - ※ 最新の GitHub Pages 推奨 IP は公式ドキュメントで確認する。

## 4. HTTPS 有効化

- [ ] DNS 伝播後、GitHub リポジトリ → Settings → Pages → **Enforce HTTPS** にチェック
  - 証明書の自動発行に数分〜24時間かかる場合がある。チェックできない場合は伝播待ち。

## 5. Search Console 所有権確認（DNS TXT）

- [ ] https://search.google.com/search-console でプロパティ追加 → **ドメイン**プロパティを選択
- [ ] 指示された **TXT レコード**を DNS に追加して所有権を確認
  - これが Google OAuth の承認済みドメイン登録・ブランド確認の前提（`docs/setup/gcp-oauth.md` §2）。

## 6. 公開後の確認

- [ ] `https://<独自ドメイン>/` で LP 表示
- [ ] `/privacy.html` `/terms.html` `/tokushoho.html` が表示される
- [ ] `docs/setup/gcp-oauth.md` の OAuth 同意画面に各 URL を記入

## 確定値（決まり次第記入し、decisions.md に1行残す）

| 項目 | 値 |
|---|---|
| 独自ドメイン | TODO |
| レジストラ | TODO |
| DNS プロバイダ | TODO |
| `web/CNAME` 追加済みか | TODO（未・ドメイン確定後に追加） |
| HTTPS 有効化 | TODO |
| Search Console 所有権確認 | TODO |
