# decisions.md — 実装中の判断ログ（1行/件、新しいものを上に）

- 2026-07-08 [G2完了] 柱2からjp-corp-core（gov-clients: houjin/gbizinfo/F-1含むHEAD `bf435ed`）を再取込みし、schema-buffer・normalize-jp・**testing**を個別subtree取込みして4ディレクトリをpnpm workspaceへ登録（レビューG2は3ディレクトリ指定だが、gov-clientsのdevDependency `@jp-opendata/testing` がworkspace:*のためinstall解決に必須→testingを追加。記録はpackages/jp-corp-core/SYNC.md）。typecheckはルートtsconfig.packages.json（柱2 tsconfig.base.json同一設定）、テストはルートvitest.config.tsで実行（56件緑）。F3-1の参照禁止柵は解除。G1（柱2main bf435ed にhoujin/gbizinfo＋F-1）・G2ともに充足→P1着手可。

- 2026-07-08 [F3-3・実装要件] `/license`検証はStripeの`cancel_at_period_end`を尊重し、**解約済みでも当該課金期間の満了まではvalidと判定する**（特商法表記「解約後も当該課金期間の満了までPro機能を利用できます」との一致が必須。review-2026-07-08 §2。P1 Step5で実装）。

- 2026-07-08 [追補v1.1] R3-1により安定ユーザーキーを**UserProperties UUID単独方式**に確定し、Step5のem:/up:/tmp: 3段フォールバック実装を撤去（下記2026-07-08 [§12-5]エントリは無効・履歴として残置）。プロパティ消去による無料枠リセットは許容（対策コードなし）。§12-5の実機検証は`debugUserKeyProbe()`によるUserProperties動作確認に読み替え（TODO継続）。あわせてR3-6（standalone＋版指定デプロイ→clasp.md修正）・R3-3（P1着手時に柱2側実装→再取込み→SYNC.md修正）・R3-7（特商法の提供時期文言を画面表示ベースに）を反映。R3-2のthanksページ/`/license/claim`/再表示フォームとR3-5のCloud Run構成値はbackend実装時（P1）に対応。

- 2026-07-08 [§12-6] 柱2 `packages/gov-clients` をgit subtreeで `packages/jp-corp-core/` に初回取込み（取込元HEAD 7210ce0・split 7adc09f、記録はpackages/jp-corp-core/SYNC.md）。ただし**houjin/gbizinfoクライアントは柱2側Phase2/3で未実装**のため現内容はhttp.ts＋edinet＋houjin fixturesのみ。柱2のworkspace依存が解決不能なためpnpm workspaceには未組込み（backend利用開始時に依存subtree追加かnpm公開待ちかを決定）。

- 2026-07-08 [§12-5] 安定ユーザーキー方式を暫定確定: ①`getActiveUser().getEmail()`非空→`em:`+SHA-256(小文字化email+Script Properties`USER_KEY_SALT`) ②空→UserPropertiesに初回生成UUID（`up:`） ③例外時のみ`tmp:`+`getTemporaryActiveUserKey()`（約30日ローテの劣化モード・最悪でも無料枠の早期回復に留まる）。openid/`getIdentityToken()`はCR-7スコープ3点固定のため不使用。実機検証はclasp疎通後に`debugUserKeyProbe()`で実施しここに結果を追記（TODO）。

- 2026-07-07 [§12-3] 独自ドメインは購入操作が必要なため未取得（TODO: docs/setup/domain-pages.mdの手順で取得→web/CNAME追加→Search Console確認）。LP/PP/ToS/特商法の骨格はweb/に作成しGitHub Pagesワークフローで公開可能な状態。運営者名・問い合わせ先等はTODOプレースホルダ。→ 人間タスク（Notion『人間のやる事リスト』へ移管済み。リポジトリ側のTODO巡回対象外）

- 2026-07-07 [§12-2] gcloud未導入・GCPコンソール操作は自動化不可→手順をdocs/setup/gcp-oauth.mdにチェックリスト化（スコープ3点をCR-7として明記）。プロジェクト作成〜テストモード設定は手動実施（TODO）。→ 人間タスク（Notion『人間のやる事リスト』へ移管済み。リポジトリ側のTODO巡回対象外）

- 2026-07-07 [§12-1] 検証環境: 令和3年10月より提供・アプリIDは本番/検証共用（利用手続書§7）。検証環境の接続先URLは公開仕様書に非掲載→ID発行時の案内メールで確認しdecisions.mdに追記（TODO）。`INVOICE_API_BASE`は環境変数で切替。
- 2026-07-07 [§12-1] 公表データ更新は1日1回（翌開庁日 午前6時目安・休日除く）→日次より高頻度の再照会に価値なし（ただしCR-3によりキャッシュは不可、都度照会は維持）。
- 2026-07-07 [§12-1] レート: 数値上限の明記なし。利用規約第9条「短時間における大量アクセス等の禁止」・第8条3項「集中時は利用制限あり」のみ→既定`RATE_RPS=1`（直列キュー）を維持。
- 2026-07-07 [§12-1] 提供時間帯: 固定の提供時間なし＝停止時以外は常時利用可（利用規約第8条）。メンテ・障害時は停止あり（事前告知は公表サイト掲載、緊急時は無告知）→N-4監視＋N-7縮退で対応。
- 2026-07-07 [§12-1] インボイスWeb-API: 1リクエスト最大10件（カンマ区切り、超過はエラー400-0002）→50行バッチは10件×5リクエストに分割。エンドポイント`GET https://web-api.invoice-kohyo.nta.go.jp/1/num?id=<appId>&number=<T+13桁,...>&type=21&history=0`（type: 01=CSV/11=XML/21=JSON）。出典: 「リクエストの設定方法及び提供データの内容について（Ver.1.0）」令和6年5月改訂・リソース定義書1.4版（詳細: docs/research/invoice-webapi-v1.md）。

