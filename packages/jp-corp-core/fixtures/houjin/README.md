# 法人番号Web-API Ver.4 fixtures

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
- 検証環境の利用は本番と同一のアプリケーションIDが必須（仮IDなし）。ID到着後に
  問合せフォームから検証環境利用を申請する（docs/research/houjin-webapi-v4.md）。
