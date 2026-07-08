# E2E受入テスト手順書（要件書§8-4・§8-5／review-2026-07-08 §5-8）

**実施は人間タスク**（Notion『人間のやる事リスト』へ追加を依頼）。実施日・結果は本ファイル末尾の記録欄と docs/decisions.md に残すこと。

## 前提セットアップ（初回のみ）

- [ ] backend を Cloud Run にデプロイ（backend/README.md。region=asia-northeast1・max-instances=1・min-instances=0）。env/Secret Manager に backend/.env.example の各値を設定
- [ ] GAS: docs/setup/clasp.md の手順で standalone スクリプトへ push、Script Properties に `BACKEND_URL`（Cloud Run URL）と `LICENSE_PUBKEY`（backend/README.md の openssl 手順で導出）を設定
- [ ] appsscript.json に `urlFetchWhitelist`（Cloud RunのURL）を追加してビルド・再push（**P1のTODO**: バックエンドURL確定後に追加＝handover§5。スコープ3点は不変）
- [ ] Stripe（テストモード）: 商品「Pro ¥1,480/月・税込」（R3-7）、Payment Link または Checkout の成功URLを `https://<ドメイン>/thanks.html?session_id={CHECKOUT_SESSION_ID}` に設定、webhook（`checkout.session.completed`→`<BACKEND_URL>/stripe/webhook`）を登録し `STRIPE_WEBHOOK_SECRET` を設定
- [ ] web/thanks.html・web/license-recover.html の `BACKEND_URL` プレースホルダを実URLへ差し替え、sidebar.html のアップグレード/解約/再表示リンクの `#TODO` を実URLへ差し替え
- [ ] テスト用スプレッドシートにサンプル10行（実在企業の社名。表記ゆれ・（株）略記を混ぜる）

## E2E-1: 受入基準§8-4「新規ユーザーが3分以内に正規化＋法人番号付与」

ストップウォッチで計測開始（アドオンインストール直後の状態から）:

1. [ ] シートを開く→メニュー「会社リストクリーナー」→「サイドバーを開く」
2. [ ] 使用量バーに「今月 0/50行」が表示される（FR-9）
3. [ ] 列マッピングに社名列が自動推定で入っている（FR-1。誤りなら手動修正）
4. [ ] オプション「表記正規化」「法人番号解決」をON→実行
5. [ ] 進捗バーが動き、完了後に**新規列**「正規化社名」「法人番号(結果)」「ステータス」が追記される（FR-7。既存セルが上書きされていないこと）
6. [ ] ステータス列: 一意解決行=成功、複数候補行=候補選択待ち→候補選択UIで名称・所在地を見て選択→適用で確定（FR-3・confidence=selected）
7. [ ] 計測終了。**3分以内**なら合格
8. [ ] 使用量バーが処理行数分減っている

## E2E-2: 受入基準§8-5「Checkout→キー表示→解錠→再表示→解約」（R3-2フロー）

1. [ ] サイドバー「Proにアップグレード」→ Stripe Checkout（テストカード 4242…）で決済
2. [ ] 成功後 thanks.html にリダイレクト→**ライセンスキーが画面表示**され、コピーボタンが動く（メール不要＝R3-2）
3. [ ] サイドバーのキー入力欄に貼り付け→保存→「Pro有効（期限表示）」になり、上限が10,000行表示になる（FR-10）
4. [ ] license-recover.html でメールアドレス入力→**同じ購読のキーが再表示**される（R3-2-3）
5. [ ] Stripeカスタマーポータルで解約→**当該期間の満了まで** /license/verify がvalid（F3-3。特商法表記と一致）→期間経過後（またはStripeのテストクロックで）invalidとなりFreeへ戻る
6. [ ] webhook配信ログにエラーがないこと

## E2E-3: 縮退・障害系（N-4/N-7・任意）

- [ ] `INVOICE_ENABLED=false` でインボイスのチェックボックスが「準備中」disabledになる
- [ ] `GBIZINFO_API_TOKEN` を一時的に空にする→gBizINFO列がスキップされnoticeが出る（他機能は動作継続＝N-7）
- [ ] backend停止状態でサイドバーを開く→赤帯でエラー表示（無言で失敗しない）

## 実施記録

| 日付 | 実施者 | E2E-1（時間・合否） | E2E-2 | E2E-3 | メモ |
|---|---|---|---|---|---|
| | | | | | |
