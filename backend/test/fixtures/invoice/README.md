# インボイスWeb-API fixtures（spec-based）

## 出所と性質

これらの JSON は **国税庁「適格請求書発行事業者公表システムWeb-API機能のリクエストの設定方法及び提供データの内容について（Ver.1.0）令和6年5月改訂」＋リソース定義書 1.4版** の仕様（`type=21`=JSON応答）に基づいて**手で組み立てた spec-based fixture** である。国税庁アプリケーションID未発行のため**実応答（検証環境・本番）のサンプルは未取得**。

`docs/research/invoice-webapi-v1.md` / `docs/decisions.md`（2026-07-07 §12-1）が上位の根拠。

## 構造（`/1/num` の JSON 応答）

- トップレベル: `count`（件数）と `announcement`（配列）。
- `announcement[]` の主なフィールド（本プロダクトが解釈するもの）:
  - `registratedNumber`: 登録番号 `T＋13桁`（**API仕様上のスペル。`registrated` は原文ママ**）。
  - `registrationDate`: 登録年月日（空＝未登録扱い）。
  - `disposalDate`: 取消年月日（非空＝取消済み）。
  - `expireDate`: 失効年月日（非空＝失効済み）。
  - その他（`sequenceNumber` `process` `kind` `country` `latest` `updateDate` `correct` 等）は
    応答に含まれるが本プロダクトでは解釈しない（CR-3: 保存もしない）。

## fixture 一覧

- `active.json`: 現在有効な登録 1 件（`T1111111111111`）。
- `mixed.json`: 有効（`T1111111111111`）／取消済み（`T2222222222222`・`disposalDate`）／
  失効済み（`T3333333333333`・`expireDate`）の 3 件。未登録番号は `announcement` に**現れない**ケースを
  表す（クライアントは一致レコード無し→ `found=false` と解釈する）。

## 実応答での差し替え手順

1. アプリケーションID発行後、検証環境（架空データ）で `type=21` の実応答を取得する。
2. 応答本文から**公表情報（社名・所在地等）を含む生データを保存しない**（CR-3）。fixture には
   本プロダクトが解釈するフィールド構造のみを残し、値はサンプル用に置換する。
3. 実応答と本 spec-based fixture の**キー名・階層に差異があれば** `src/clients/invoice.ts` の
   パース（`indexByRegistrationNumber` / `buildStatus`・特に `registratedNumber` のスペル）を
   実応答へ合わせて修正し、本 README の「構造」節を更新する。
4. golden 運用に準拠（自動上書き禁止・人間が diff レビュー。引継書 §10）。
