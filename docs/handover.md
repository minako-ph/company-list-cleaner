# 柱3 Claude Code引継書 v1.0 — company-list-cleaner 実装ハンドオーバー

作成日: 2026-07-07 ／ 対文書: **柱3_要件定義書v1.0（要件の正）**、柱3_マーケティング戦略書v1.0（掲載文言の正）
本書の目的: 戦略検討・国税庁申請・調査で確定した方針と事実を欠落なく引き継ぎ、実装者（Claude Code）が文脈の再質問なしに公開まで到達できるようにする。

---

## 0. 読み方

§1〜2が「なぜこの形か」、§3〜10が「どう作るか」、§11〜12が「どの順で・何をもって完了か」。**§13のDo/Don'tは絶対規則で、特にCR系（国税庁承認条件）は法的リスクに直結する**。未定義事項は最小実装＋TODOで前進し、`docs/decisions.md`に1行残す。要件書と本書が矛盾したら要件書。

## 1. プロジェクト文脈

- 事業主はソロ開発者（TypeScript×GASが本職の得意領域）。制約: 初期5万円以内／保守は月2h以内目標／能動マーケなし／受託なし。ポートフォリオの**本命**が本プロダクト（12ヶ月で単体月10万到達確率15〜25%と見積もった柱）。
- 柱1（入札Actor）出荷が常に最優先、柱2（Actorファミリー）と本柱3はデータ取得コアを共有する。**柱2リポジトリ（jp-opendata-actors）の`gov-clients/houjin`・`gov-clients/gbizinfo`を本リポジトリが再利用**する（§7.4）。**インボイスAPIクライアントは本リポジトリにのみ置く**（柱2側には置かない——Actor形態では承認条件を満たせないため）。
- 選定理由の再確認: ①インボイス登録確認は制度由来の恒常ペイン ②データ源すべて無料公式API ③restrictedスコープ不要でCASA監査（年$500〜4,500）を構造的に回避 ④Marketplace需給が良い（公開アプリ約5,000本 vs Sheets月間9億ユーザー。実名アンカー: Sync2Sheets 転換1%で$9k MRR、BudgetSheet 転換4%・100% Apps Script製）。

## 2. 国税庁申請の経緯と絶対制約（最重要）

2026-07-07に「適格請求書発行事業者公表システムWeb-API機能アプリケーションID発行申請書」＋プログラム概要PDFを提出済み（承認まで1〜1.5ヶ月）。**申請書に記載した以下の内容が、そのまま実装の法的制約になる**（要件書§5 CR-1〜7の根拠）:

1. 照会は「登録番号を指定して情報を取得する機能」のみ。登録番号＝法人はT＋13桁法人番号を機械生成。
2. 登録番号以外（氏名・名称・所在地）から公表情報を検索する機能は実装しない。承認却下事由に明記されている条件のため、**コード上も「インボイスAPIクライアントの公開関数は`lookupByRegistrationNumbers(numbers: string[])`のみ」という型で物理的に縛る**。
3. 取得した公表情報は申請者側サーバ・DBに保存しない（都度取得・都度破棄）。書き込み先は利用者本人のシートのみ。
4. 全件ダウンロードファイルは利用しない。
5. アクセスログは「利用者ID・取得日時・照会した登録番号」の3点のみ（社名・照会結果を含めない）。
6. 利用者の把握方法として「Googleアカウント認証＋ライセンスキー＋アクセスログ解析」を届出済み→この構成自体が変更不可の前提。
7. 申請書4.1で「法人番号のみの利用希望＝はい」→**インボイス承認が遅延・却下でも法人番号Web-APIは使える**（縮退公開の根拠）。

検証環境: 国税庁は架空法人データの検証環境を提供→ID到着前でも仕様書ベースでクライアント＋fixtureを先行実装できる。

## 3. 確定アーキテクチャ

```
[利用者のGoogle Sheet]
   ↕ (currentonlyスコープ)
[GASアドオン: サイドバーUI + シート読み書きのみ]
   ↓ HTTPS (script.external_request)
[オペレーターバックエンド: Cloud Run (Node/TS, Hono)]
   ├─ /resolve   社名→法人番号（法人番号API名称検索）
   ├─ /enrich    基本情報・補助金/調達（法人番号API＋gBizINFO v2）
   ├─ /invoice   登録番号→インボイス登録状況（INVOICE_ENABLEDフラグ）
   ├─ /license   キー検証（JWT署名＋Stripe購読状態）
   ├─ /usage     無料枠カウント（Firestore）
   └─ /stripe/webhook  決済イベント→キー発行メール
   ↓ 直列キュー・1req/秒
[国税庁 法人番号API / インボイスAPI]  [gBizINFO v2]
```

**バックエンドが必須である理由**（GAS単体にしない）: ①アプリケーションID・トークンの秘匿と集中管理 ②申請書に「申請者管理サーバから直列送信・アクセスログ」と届出済み ③Stripe webhook受信とライセンス検証に元々サーバが要る ④柱2のTypeScriptクライアント資産をそのまま動かせる ⑤全ユーザー横断のレート制御（N-1）はサーバでしか成立しない。
コスト: Cloud Run（min-instances 0）＋Firestore＋Cloud Loggingは想定負荷で無料枠圏内。

## 4. リポジトリ構成（新規: `company-list-cleaner`）

```
company-list-cleaner/
├── apps-script/          # claspプロジェクト（TypeScript→esbuildでbundle→push）
│   ├── src/{sidebar/, server/}   # sidebar=HTML/クライアントJS, server=GAS関数
│   └── appsscript.json   # マニフェスト（§5のスコープ3点のみ）
├── backend/              # Cloud Run (Hono + TS)
│   ├── src/{routes/, clients/invoice.ts, services/, log/}
│   └── Dockerfile
├── packages/jp-corp-core/  # 柱2から取込む houjin/gbizinfo クライアント（§7.4）
├── web/                  # LP・プライバシーポリシー・利用規約（静的、GitHub Pages）
├── docs/{requirements.md, handover.md, marketing.md, decisions.md}
└── .github/workflows/ci.yml   # typecheck / lint / vitest（backend中心）
```

## 5. OAuthスコープとマニフェスト（CR-7の実装）

`appsscript.json`の`oauthScopes`は以下の**3点固定**。追加のPRはCIで拒否する（スコープ差分チェックをciに入れる）:
- `https://www.googleapis.com/auth/spreadsheets.currentonly`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.container.ui`

審査の実務: GCPプロジェクト→OAuth同意画面（外部）→**ブランド確認2〜3営業日**（要: 独自ドメインのホームページ・プライバシーポリシーURL・Search Console所有権確認）→**sensitive審査1〜3週**（スコープ利用理由とデモ動画の提出）→Marketplace SDK設定→掲載審査。restrictedが無いためCASAは発生しない。`urlFetchWhitelist`にバックエンドのドメインを設定し送信先を固定する。

## 6. GAS実装の要点

- clasp＋TypeScript。GASのモジュール制約はesbuildバンドルで解消（`apps-script/src`→単一`Code.js`）。事業主の本職領域のため凝ったフレームワークは不要、素のHTMLService＋`google.script.run`で組む。
- **6分制限（N-2）**: 実行主体をサイドバー側JSにする。サイドバーが行を50行単位に分割し`google.script.run.processBatch(rows, options)`を逐次呼ぶ→各呼び出しは数十秒で返る→進捗バー更新。中断・再開はステータス列（FR-7）を真実源に。
- シートから読むのはユーザーが指定した列の値のみ（N-3）。書き込みは新規列追記・`setValues`一括。
- バックエンドURL・公開鍵はScript Propertiesに保持（ユーザー不可視）。ユーザー識別は`Session.getTemporaryActiveUserKey()`ではなく**エフェメラルでないID**が必要→OpenID相当は取らない方針のため、ライセンス紐付けは「キー入力＋バックエンド側でキー⇄subscriptionの対応」を真実源にし、無料枠カウントは`getActiveUser().getEmail()`が空になるケースを考慮して**ハッシュ化した安定ユーザーキー（ScriptApp.getIdentityToken不使用の範囲で設計、詳細はdecisions.mdに記録）**で行う。ここは実装初日に検証（§12-5）。

## 7. バックエンド実装の要点

### 7.1 直列キューとログ
公的API呼び出しは**プロセス内直列キュー（1req/秒、環境変数化）**を通す。Cloud Runは`max-instances=1`で開始（全ユーザー横断の直列性を単純に担保。詰まりだしたらキュー永続化を検討、それまでやらない）。アクセスログは構造化JSONで`{user_key, timestamp, registration_number}`の**3フィールドのみ**（CR-5）をCloud Loggingへ。**レスポンスボディをログ・DB・キャッシュに書かない**（CR-3。HTTPレスポンスとしてGASへ返すのみ）。

### 7.2 インボイスクライアント（本リポジトリ専用）
`backend/src/clients/invoice.ts`の公開APIは`lookupByRegistrationNumbers(numbers: string[]): Promise<InvoiceStatus[]>`**のみ**（§2-2の物理的縛り）。名称系の引数・関数を追加しない。ID到着まで検証環境エンドポイントに向ける（環境変数`INVOICE_API_BASE`）。仕様書で1リクエスト最大指定件数・提供時間帯を確認して分割数を確定（要件書§12-1）。

### 7.3 ライセンス（FR-10）
Stripe Checkout（Payment Link可）→webhook `checkout.session.completed`→**署名付きライセンスキー（JWT: sub=stripe customer, exp長め）を生成しメール送付**→GASから`/license`で検証（署名＋Stripe購読状態の照合、結果を短TTLでメモリキャッシュ）。Firestoreには`key_id⇄customer_id`と無料枠カウンタ（`{user_key, month, rows_used}`）のみ保存——**公表情報は保存しない**のでCR-3と両立。

### 7.4 jp-corp-coreの取込み方式
柱2の`gov-clients/houjin`（XML/CSV・Shift_JIS対応: fast-xml-parser＋iconv-lite）と`gov-clients/gbizinfo`（v2）を利用する。**初期はgit subtreeで`packages/jp-corp-core/`に取込み、`SYNC.md`に取込元コミットを記録**。柱2側でnpm公開（scoped public）が済んだら依存を切替（decisions.mdに記録）。本リポジトリ側での改変は原則禁止——必要なら柱2側に還元してから再取込。

## 8. 出典文言（verbatim定数。サイドバーヘルプ・LP・リスティングに使用）

- インボイス:「このサービスは、国税庁適格請求書発行事業者公表システムのWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない」
- 法人番号:「このサービスは、国税庁法人番号システムのWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない」
- gBizINFO:「出典：経済産業省 Gビズインフォ」

## 9. シークレット・環境変数

GAS Script Properties: `BACKEND_URL`, `LICENSE_PUBKEY`。
Backend（Cloud Run env/Secret Manager）: `HOUJIN_APP_ID`（=インボイスと共通の国税庁ID）, `INVOICE_API_BASE`, `INVOICE_ENABLED`, `GBIZINFO_API_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LICENSE_SIGNING_KEY`, `RATE_RPS`(既定1), `FREE_ROWS_PER_MONTH`(50), `PRO_ROWS_PER_MONTH`(10000)。
**コード・リポジトリ・ログにキーを含めない。**

## 10. テスト・監視

- テストの重心はbackend（vitest）: クライアントは検証環境/実応答のサニタイズ済みfixtureでgolden（柱2と同じ運用: 自動上書き禁止・人間がdiffレビュー）。CRの検証をテスト化: 「invoiceクライアントに名称系引数が存在しない」「レスポンス保存経路が存在しない（ログスキーマのスナップショット）」。
- GAS側は薄く（純関数の正規化ロジックはbackend/共有パッケージに寄せてテスト）。
- 監視（N-4）: Cloud Runのエラー率アラート＋公的API連続失敗の検知→Webhook通知。サイドバーは障害時に「現在○○APIが応答していません」を表示（無言で失敗しない）。

## 11. フェーズ計画とDefinition of Done

| Phase | 内容 | DoD |
|---|---|---|
| P0 | リポジトリ雛形・CI・GCP/OAuth同意画面下準備・**独自ドメイン取得＋LP/PP/ToS公開**・clasp疎通 | サイドバー"Hello"がテストシートで動く。LPが独自ドメインで表示 |
| P1 | FR-1〜4,6〜9（法人番号・gBizINFO系フル）＋課金（FR-10）＋バックエンド一式 | E2E: 正規化→番号解決→付与→無料枠減算→Checkout→解錠が通し。golden green |
| P2 | FR-5（インボイス、検証環境接続）＋CRテスト＋審査提出物（デモ動画・スコープ理由書） | 検証環境で照合一致。OAuth審査投入 |
| P3 | 審査対応→**公開**（ID未着なら縮退公開: `INVOICE_ENABLED=false`＋リスティングに「準備中」正直表記） | Marketplace掲載。受入基準（要件書§8）全達成 |

タイムライン目標: P0-P1=M2、P2=M3、P3=M3〜4。**柱1・柱2 Phase1の作業と競合したらそちら優先**。

## 12. 実装初日のタスク

1. インボイスWeb-API公開仕様書を取得し、1リクエスト最大件数・提供時間・レートを`docs/decisions.md`に記録（要件書§12-1）。
2. GCPプロジェクト作成→OAuth同意画面（外部・テストモード）→スコープ3点を宣言。
3. **独自ドメイン取得（年1,500円程度・初期予算内）**→GitHub PagesでLP/PP/ToSの骨格公開→Search Console所有権確認（ブランド審査の前提）。
4. claspセットアップ→esbuildパイプライン→テストシートでサイドバー疎通。
5. §6のユーザー安定キー方式を検証・確定（`getActiveUser()`の挙動確認）→decisions.mdに記録。
6. 柱2から`houjin`/`gbizinfo`をgit subtree取込み→SYNC.md作成。

## 13. Do / Don't（絶対規則）

**Do**: CR-1〜7を実装とテストの両方で担保／照会は常に「社名→法人番号（法人番号API）→T番号→インボイスAPI」の適法チェーン／部分失敗は行単位で継続／出典文言の常設／障害の可視化。
**Don't**:
- **インボイスAPIに登録番号以外で照会する経路を作らない**（関数・引数レベルで存在させない）。
- **公表情報のレスポンスを保存・キャッシュ・ログしない**。アクセスログは3点のみ。
- 全件ダウンロードファイルを取得しない。
- **スコープを3点から増やさない**（Gmail/Drive等の機能要望が来ても断る。CASA回避の生命線）。
- v1でLLMを使わない（正規化はルールベース。AI Import等の拡張はテレメトリ確認まで凍結）。
- 税理士向けの文言・機能を出さない（申請書の利用者区分と不整合になるため。解禁は変更手続後）。
- ライセンスキー・APIキーをGASコードやリポジトリに埋めない。
- 「無料で全部使える」型の無料枠にしない（月50行厳守）。

## 14. 要件↔実装対応の要点

FR-1/7/8/9→apps-script(sidebar＋server)／FR-2→jp-corp-core(normalize)／FR-3/4/6→backend routes＋jp-corp-core／FR-5→backend/clients/invoice.ts（フラグ）／FR-10→backend(license/stripe)＋Firestore／CR-5→backend/log／CR-7→appsscript.json＋CIスコープチェック／N-2→sidebar駆動バッチ／N-4→Cloud Run監視。

---
*本書はv1.0。更新トリガー: 国税庁承認結果の確定／未決事項の解消／decisions.mdの昇格。*
