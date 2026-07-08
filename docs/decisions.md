# decisions.md — 実装中の判断ログ（1行/件、新しいものを上に）

- 2026-07-08 [P1 Step4] FR-9無料枠カウントを実装（`backend/src/services/quota.ts`・`routes/usage.ts`・`services/firestore.ts`）。**保存はrows_usedのみ**（`usage_counters`コレクション・公表情報/社名は保存経路を作らない＝CR-3・cr-compliance走査で固定）。月次リセットはドキュメントキー`{user_key}:{YYYY-MM}`のJST分離で実現（リセットバッチ不要）。**JST算出**は`monthKeyJst`で`+9h`後にUTC部品を読む固定オフセット（日本は夏時間なし。UTC 6/30T15:00Z=JST 7/1で新月＝テスト固定）。**ストア抽象**`QuotaStore`はDI可能、`increment`は限度チェックと融合し`consume`（Firestoreは`runTransaction`で読み書き原子化＝並行consumeの超過防止）に一本化、判定は純関数`decideConsume`（上限ちょうど許可・超過は据え置き）で共有。実装はFirestoreQuotaStore（本番）とInMemoryQuotaStore（ローカル/テスト・エミュレータ不要）。**Firestore起動判定**: `FIRESTORE_PROJECT_ID`（無ければ`GOOGLE_CLOUD_PROJECT`）が空ならInMemoryにフォールバック、非空ならADCでFirestore接続（Cloud Run本番）。SDK値importは`services/firestore.ts`に隔離しquota.tsは型のみimport。planは'free'固定（Pro判定・PRO_ROWS上限切替はP1 Step5でTODO）。consume rowsは1〜50整数バリデーション。依存`@google-cloud/firestore`追加に伴い推移依存protobufjsのpostinstallをpnpm-workspace.yaml allowBuildsで許可。

- 2026-07-08 [P1 Step3] `/resolve`（FR-2/3）・`/enrich`（FR-4/6）を実装（`backend/src/routes/resolve.ts`・`enrich.ts`＋`services/resolve.ts`・`enrich.ts`・`apiError.ts`）。**アクセスログの設計判断（CR-5）**: CR-5の3点アクセスログ（`logAccess`）は**インボイス照会専用**（申請書2.6.2の文脈は公表システム）。法人番号API・gBizINFOの呼び出しは3点ログの対象外であり`logAccess`を呼ばない（型も`registrationNumber`しか受け付けず流用不可）。resolve/enrichは社名・法人番号・応答内容を保存・キャッシュ・ログしない（CR-3の精神を維持。運用ログはHTTPステータス・件数等のメタのみ）。**レート制御の一元化（N-1）**: invoice/houjin/gbizinfoを**単一の直列キュー**（`createSerialQueue(RATE_RPS)`）で共有し全ユーザー・全API横断で1req/秒を担保。houjinクライアント内部の`GovHttpClient`は`intervalMs=0`で注入し二重待機を回避（gBizINFOはtokenをヘッダ送出する都合でhttp未注入＝既定500ms間隔のまま上位キューが1req/秒を支配。保守的で問題なし）。confidenceはAPI側でexact/ambiguous/not_foundの3値のみ（'selected'はユーザー選択後にGAS側で付与）。名称検索は完全一致（target=2）・XML（type=12）。HOUJIN_APP_ID未設定時は/resolveは503明示応答、/enrichはN-7縮退（basicをスキップしnotice）。同一法人番号の重複レコードは候補で1件に畳み込み（誤ambiguous防止）。

- 2026-07-08 [P1 Step2] `backend/src/clients/invoice.ts`（本リポジトリ専用・CR-1/2の型縛り）を実装。公開値exportは`createInvoiceClient`のみ・照会手段は`lookupByRegistrationNumbers(numbers, {userKey})`だけ（名称系の引数・関数・クエリ文字列を存在させない）。応答パースは**実応答未取得のためspec-based**: `announcement[].registratedNumber`（APIスペル原文ママ）で突合し、`registrationDate`非空を`found`、`disposalDate`/`expireDate`非空で`registered=false`（取消/失効）と判定。未登録番号は`announcement`に現れない前提（一致なし→found=false）。実応答到着時は`backend/test/fixtures/invoice/README.md`の差し替え手順でキー名を検証・修正する。エラーメッセージはredactUrlでクエリ（id・番号）除去（CR: アプリID非漏洩）。`/invoice`は`INVOICE_ENABLED=false`で503`{error:'invoice_disabled'}`（縮退公開）。CRテストは`backend/test/cr-compliance.test.ts`（CR-1/2ソース走査・CR-4 /diff//point/download不在・CR-3永続化/logAccess引数走査＝accessLogスナップショットとの二重防御）。

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

