# 法人番号Web-API Ver.4 fixtures

## 実応答（本番API・2026-07-10採取）

redact済みhttp層（GovHttpClient）経由で採取。応答ボディにアプリケーションIDは含まれない（採取スクリプトで非含有を検査済み）。

| ファイル | 内容 |
|---|---|
| `num.7010001008844.2026-07-10.xml` | 番号指定・株式会社日立製作所（XML, type=12, history=0）。#4のgBizINFO未収載フォールバック回帰に使用 |

## 公開サンプル

出典: 国税庁 法人番号公表サイトの**公開サンプルデータ**（架空法人データ・実応答ファイル）
`https://www.houjin-bangou.nta.go.jp/pc/download/images/k-sample-dl-r0404.zip`（令和4年4月版、2026-07-07採取）

| ファイル | 内容 |
|---|---|
| `num_0_ver4_c2.csv` | 番号指定・履歴なし（CSV/Shift_JIS, type=01） |
| `num_0_ver4_c4.csv` | 番号指定・履歴なし（CSV/Unicode, type=02） |
| `num_0_ver4_x4.xml` | 番号指定・履歴なし（XML, type=12） |
| `num_1_ver4_x4.xml` | 番号指定・履歴あり（XML, history=1） |
| `diff_20190404_ver4_c2.csv` / `..._x4.xml` | 期間指定（diff） |
| `name_ver4_c4.csv` / `name_ver4_x4.xml` | 名称指定（name） |

注意:
- `*_c2.csv` はShift_JISのまま保存している（iconv-liteのデコードテスト用）。
- 検証環境の利用は本番と同一のアプリケーションIDが必須（仮IDなし）。2026-07-10にID到着、
  本番APIで直接検証済みのため検証環境の申請は不要になった（docs/research/houjin-name-search.md）。
