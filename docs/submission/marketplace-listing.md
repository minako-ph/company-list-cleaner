# Marketplaceリスティング完成稿（日英）— marketing.md §5 準拠

掲載文言の正は docs/marketing.md（§4/§5）。本稿はそのまま貼れる完成形。**税理士向け文言・誇大表現（全企業対応/完全自動/AI搭載）・競合名指しは使用禁止**（marketing §1/§4/§13）。
サポート窓口・各URLの `TODO` は人間タスク確定後に差し替える。末尾に**縮退公開（`INVOICE_ENABLED=false`）版の差分**（R3-4）。

---

## 名前

- 日: `会社リストクリーナー — インボイス登録確認・法人番号付与 for Google Sheets`
- 英: `Company List Cleaner — Invoice Registry Check & Corporate Number for Sheets`

## 短い説明（120〜160字）

- 日: `取引先リストの社名を正規化し、法人番号・住所・業種・補助金実績を自動付与。適格請求書（インボイス）発行事業者の登録状況も登録番号で一括確認。国税庁・gBizINFOの公式データのみ使用、結果はあなたのシートにだけ追記され、既存のセルは上書きしません。`（125字）
  ※ marketing.md §5の原文は107字で同節の120〜160字要件を満たさないため、事実に基づく最小追記（補助金実績・新規列追記）で調整。原文の主旨・トーンは不変。
- 英: `Clean company names in your vendor list, auto-fill corporate numbers, addresses and industry data, and bulk-check qualified invoice issuer registration by registration number. Official Japanese government data only — results are saved solely to your sheet.`

## 詳細説明（日本語）

取引先リストの整備を、スプレッドシートから出ずに。社名の表記ゆれ統一・法人番号の自動付与・インボイス登録の一括確認を、公式データだけで。

**できること**

- 整えます — 社名の表記ゆれ（（株）⇄株式会社・全角半角・前株/後株）をルールベースで統一
- 付与します — 社名から法人番号を解決し、住所・法人種別を追加（国税庁 法人番号システムWeb-API）
- 追加します — 業種・設立・従業員数などの企業情報と補助金・調達実績の有無（経済産業省 gBizINFO）
- 確認します — 適格請求書（インボイス）発行事業者の登録状況を、登録番号（T＋13桁。社名から自動付与した法人番号をもとに機械生成）で一括照会
- 続けられます — 行単位の部分失敗で全体を止めず、未処理・エラー行のみ再実行。結果は新規列に追記し既存セルを上書きしません

**できないこと（正直にお伝えします）**

1. 個人事業主の取引先は、登録番号（T番号）が既にリストにある場合のみ照会できます（法人番号から導出できないため）
2. 企業情報の付与範囲は gBizINFO 収録分（約400万法人）で、すべての法人を網羅するものではありません
3. 本サービスは国税庁・経済産業省の保証を受けたものではありません（下記の出典をご確認ください）

**使い方（3ステップ）**

1. サイドバーを開き、社名列（あれば法人番号・登録番号列）を選ぶ
2. 付与したい情報にチェックを入れて実行（50行ずつ自動処理・進捗表示）
3. 新しい列に結果とステータスが書き込まれます。複数候補の行は候補から選んで確定

**料金**

- Free: ¥0 — 月50行まで。全機能を利用できます（量の制限のみ）
- Pro: ¥1,480/月（税込） — 月10,000行までのフェアユース上限。解約はStripeカスタマーポータルからいつでも可能で、解約後も当該課金期間の満了までご利用いただけます

**出典**

- このサービスは、国税庁適格請求書発行事業者公表システムのWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない
- このサービスは、国税庁法人番号システムのWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない
- 出典：経済産業省 Gビズインフォ

**サポート**

- ヘルプ・FAQ: `TODO（LPのURL）` ／ お問い合わせ: `TODO（メールまたはフォームURL）`（一次返信48時間以内）
- プライバシーポリシー: `TODO（/privacy.html）` ／ 利用規約: `TODO（/terms.html）` ／ 特定商取引法に基づく表記: `TODO（/tokushoho.html）`

## Detailed description (English)

Tidy your vendor list without leaving Google Sheets: normalize company-name variants, auto-fill corporate numbers, and bulk-check qualified invoice issuer registration — using official Japanese government data only.

**What it does**

- Normalizes Japanese company-name variants (株式会社/（株）, full/half-width) with deterministic rules
- Resolves corporate numbers from company names and appends address and entity type (NTA Corporate Number Web-API)
- Adds industry, founding year, employee counts, and subsidy/procurement flags (METI gBizINFO)
- Bulk-checks qualified invoice issuer registration by registration number (T + 13 digits, machine-generated from the resolved corporate number)
- Writes results as new columns with a per-row status — existing cells are never overwritten; retry only failed rows

**What it does not do (honest limits)**

1. Sole proprietors can be checked only when a T-number is already in your list (it cannot be derived from a corporate number)
2. Company enrichment covers entities listed in gBizINFO (~4 million) — not every company in Japan
3. This service is not endorsed or guaranteed by the NTA or METI (see attributions)

**How to use**: open the sidebar and pick your columns → choose the data to append and run (processed 50 rows at a time with progress) → results and status are written to new columns; pick from candidates when multiple matches are found.

**Pricing**: Free — up to 50 rows/month, all features. Pro — ¥1,480/month (tax incl.), fair-use cap of 10,000 rows/month. Cancel anytime via the Stripe customer portal; Pro remains active until the end of the paid period.

**Attributions**: This service uses information obtained via the Web-API of the NTA Qualified Invoice Issuer Publication System and the NTA Corporate Number System; its content is not guaranteed by the NTA. Source: METI gBizINFO.

**Support**: Help/FAQ `TODO` / Contact `TODO` (first reply within 48 hours) / Privacy `TODO` / Terms `TODO`.

## カテゴリ・キーワード（設定欄用）

- カテゴリ: Productivity系＋Finance系（提出時の現行カテゴリから最近接を選択＝要件書§12-3の確認と同時に確定）
- 検索キーワード（説明文に自然散布済み）: インボイス 登録番号 確認 一括／適格請求書 発行事業者 チェック／法人番号 検索 スプレッドシート／会社名 名寄せ 表記ゆれ／取引先マスタ 整備／gBizINFO スプレッドシート

## スクリーンショット5枚（審査要件・撮影指示）

1. Before/After（汚いリスト→整ったリスト）
2. サイドバーの列マッピング
3. 実行中の進捗
4. インボイス確認結果の列 ※縮退時は下記差分参照
5. 料金と無料枠表示

---

## 縮退公開版の差分（`INVOICE_ENABLED=false`・R3-4／marketing §11-4）

フル版との差分**のみ**記載。共通部分は上記のまま。

- **短い説明（末尾に追記）**: 日「※インボイス登録確認は承認手続中のため準備中です（法人番号・企業情報付与はご利用いただけます）。」／英 "Note: invoice registry check is in preparation pending NTA approval (corporate number & enrichment are available)."
- **詳細説明「できること」**: 「確認します — …一括照会」の行末に **「（承認手続中のため準備中。承認後に自動で有効になります）」** を付す。英語版も同様に "(in preparation pending NTA approval; enabled automatically upon approval)"
- **スクリーンショット④**: **掲載しない**、または「承認手続中・準備中」の帯を重ねた版に差し替える（準備中機能を「動作中」に見せない——審査・信頼の両方を毀損するため）
- その他（料金・出典・正直明記3点・使い方）は変更なし。承認後は本差分を外してフル版に戻し、既存ユーザーへアプリ内通知（marketing §11-4「良いニュースを2回出せる」）
