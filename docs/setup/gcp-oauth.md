# GCPプロジェクト・OAuth同意画面 セットアップ手順（§12-2）

引継書§5の審査実務に対応する手動チェックリスト。**スコープはCR-7の3点固定**。作業完了ごとにチェックを入れ、確定値（プロジェクトID等）を本ファイル末尾の「確定値」に記録すること。

## 前提

- Googleアカウント: 公開に使うアカウント（chanmina143@gmail.com もしくは事業用アカウント）で実施。
- 独自ドメイン・LP/PP/ToSの公開（§12-3、docs/setup/domain-pages.md）が**ブランド確認の前提**。ドメイン確定前でもプロジェクト作成〜テストモードまでは進められる。

## 1. GCPプロジェクト作成

- [ ] https://console.cloud.google.com/projectcreate で新規プロジェクト作成
  - プロジェクト名: `company-list-cleaner`（プロジェクトIDは自動採番でよい。確定値に記録）
  - 組織なし（個人）で可。課金アカウントの紐付けはCloud Run利用時（P1）でよい
- [ ] （任意・CLI派の場合）`brew install google-cloud-sdk` → `gcloud auth login` → `gcloud projects create <PROJECT_ID> --name=company-list-cleaner`

## 2. OAuth同意画面（外部・テストモード）

- [ ] コンソール → 「APIとサービス」→「OAuth同意画面」
- [ ] User Type: **外部（External）** を選択
- [ ] アプリ情報:
  - アプリ名: `会社リストクリーナー`（Marketplace掲載名と整合。英語併記名は掲載時に設定）
  - ユーザーサポートメール: 運用アカウントのメール
  - デベロッパー連絡先: 同上
- [ ] アプリドメイン（ドメイン取得後に追記可）:
  - ホームページ: `https://<独自ドメイン>/`
  - プライバシーポリシー: `https://<独自ドメイン>/privacy.html`
  - 利用規約: `https://<独自ドメイン>/terms.html`
- [ ] 承認済みドメインに独自ドメインを追加（**Search Consoleでの所有権確認が先に必要**→ domain-pages.md）
- [ ] 公開ステータス: **テスト中（Testing）** のまま。テストユーザーに自分のアカウントを追加

## 3. スコープ宣言（CR-7: この3点以外を絶対に追加しない）

- [ ] 「スコープを追加または削除」で以下の3点**のみ**を宣言:
  - `https://www.googleapis.com/auth/spreadsheets.currentonly`
  - `https://www.googleapis.com/auth/script.external_request`
  - `https://www.googleapis.com/auth/script.container.ui`
- [ ] sensitive審査（1〜3週）はP2で提出（スコープ利用理由書＋デモ動画が必要。restrictedスコープが無いためCASAは発生しない）

## 4. Apps Scriptプロジェクトとの紐付け（Step4のclasp疎通後）

- [ ] Apps Scriptエディタ → プロジェクトの設定 → 「Google Cloud Platform（GCP）プロジェクト」→ 上記プロジェクト番号を設定（デフォルトプロジェクトから標準プロジェクトへ切替。Marketplace公開の必須条件）
- [ ] コンソール側で「Apps Script API」を有効化

## 5. 後続（P2で実施。ここではやらない）

- ブランド確認（2〜3営業日）: ホームページ・PP URL・Search Console所有権確認が揃ってから申請
- sensitive審査 → Marketplace SDK設定 → 掲載審査

## 確定値（決まり次第記入し、decisions.mdに1行残す）

| 項目 | 値 |
|---|---|
| GCPプロジェクトID | TODO |
| GCPプロジェクト番号 | TODO |
| OAuth同意画面ステータス | TODO（未着手／テスト中／審査中） |
