# 法令API v2 fixtures

実応答スナップショット（2026-07-10採取・認証不要のためシークレットなし）。仕様の正: `docs/research/laws-api-v2.md`。

| ファイル | 内容 |
|---|---|
| `laws.kojin-joho.2026-07-10.json` | 【実応答・トリミング】`GET /api/2/laws?law_title=個人情報の保護&response_format=json`。実応答18件のうち**先頭3件のみ保持**（値の改変なし。total_count=18は原文のまま） |
| `law_data.415AC0000000057.trimmed.2026-07-10.json` | 【実応答・トリミング】`GET /api/2/law_data/415AC0000000057?response_format=json`（個人情報保護法・現行版）。law_full_textの本則を**最初の5条のみ**に、附則（SupplProvision）と目次以外の付随情報を削除して保持（値の改変なし・約546KB→約113KB） |

注意:

- law_full_textは法令標準XMLの直訳ツリー `{tag, attr, children}`。クライアントはopaqueとして受け、条抽出はActor側パーサが行う。
- 0件・不存在は404＋`{"code","message"}`（fixtureにせずテスト内リテラルで扱う）。
