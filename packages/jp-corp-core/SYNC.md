# SYNC.md — 柱2からの取込み記録（引継書§7.4・review-2026-07-08 §4 G2）

柱2 jp-opendata-actors から git subtree で取込んでいるディレクトリは以下の4つ（いずれも柱2が正典）:

| 柱3ディレクトリ | 柱2の取込元prefix | 用途 |
|---|---|---|
| `packages/jp-corp-core` | `packages/gov-clients` | houjin・gbizinfo・edinetクライアント＋http層 |
| `packages/schema-buffer` | `packages/schema-buffer` | zodスキーマ＋drift検知（gov-clientsの依存） |
| `packages/normalize-jp` | `packages/normalize-jp` | 日本語正規化（gov-clientsの依存） |
| `packages/testing` | `packages/testing` | fixtureローダ（gov-clientsテストのdevDependency） |

本ファイル（SYNC.md）だけが柱3ローカルの追加ファイルで、それ以外の**本リポジトリ側での改変は原則禁止**——変更が必要なら柱2側に還元してから再取込みする。4ディレクトリは本リポジトリの pnpm workspace に登録済みで、`workspace:*` 依存はリポジトリ内で解決される（G2）。

## 取込み履歴（新しいものを上に）

| 日付 | 対象 | 取込元コミット（jp-opendata-actors HEAD） | split コミット | 備考 |
|---|---|---|---|---|
| 2026-07-10 | jp-corp-core | `ad46f5a31301344fdff18ca4935432c7cc948a22` | `bf464ed12adc0b0ff77e8afe453d5809fecc6747` | 再取込み（柱2 Step A追従）。**英数字13桁アプリID対応・/4/name実挙動対応（法人格除去クエリ・全角化）・resolveCompanyName更新＋実応答fixture** |
| 2026-07-10 | testing | `8127e71558c31505f088e1e51098d5b387bd8c13` | `30c86f37134153bd936b636344c8b5d89e4a40fd` | 再取込み（変更なし・split同一） |
| 2026-07-10 | normalize-jp | `8127e71558c31505f088e1e51098d5b387bd8c13` | `67e864fde8b5651376bc22b79fcc29d16baa851d` | 再取込み |
| 2026-07-10 | schema-buffer | `8127e71558c31505f088e1e51098d5b387bd8c13` | `c32a2665be3cbbb63f7e7e1d72234bdaaa6ef223` | 再取込み（変更なし・split同一） |
| 2026-07-10 | jp-corp-core | `8127e71558c31505f088e1e51098d5b387bd8c13` | `c95f0a2f49911a2225aeef229732e1bdb35162ad` | 再取込み。**gbizinfo `amount` の実データ修正（文字列で返る→z.union両受け）**・実応答fixture（2026-07-10採取）・laws/reinfolibクライアント追加を含む |
| 2026-07-08 | testing | `bf435ed0f30bd25a896a4e881f1e15a426c8954b` | `30c86f37134153bd936b636344c8b5d89e4a40fd` | 初回取込み（G2。gov-clientsのdevDep解決のためレビュー記載の3ディレクトリに追加） |
| 2026-07-08 | normalize-jp | `bf435ed0f30bd25a896a4e881f1e15a426c8954b` | `8d7ac0bdc955720d8abdf242adffab6afbab6034` | 初回取込み（G2） |
| 2026-07-08 | schema-buffer | `bf435ed0f30bd25a896a4e881f1e15a426c8954b` | `c32a2665be3cbbb63f7e7e1d72234bdaaa6ef223` | 初回取込み（G2） |
| 2026-07-08 | jp-corp-core | `bf435ed0f30bd25a896a4e881f1e15a426c8954b` | `f3ce0c9eceaf7538ce68dc680f82fd4e79868231` | 再取込み。**houjin(/4/num・/4/name)・gbizinfo(v2 基本/補助金/調達)クライアント＋F-1修正（redactUrlForError）を含む**（G1充足） |
| 2026-07-08 | jp-corp-core | `7210ce0719de1d5ebf9467366f962f142edab385` | `7adc09f4b614d8c8d1a1cbdca5494ac5201bc6b8` | 初回取込み。内容は http.ts＋edinetクライアント＋houjin fixtures |

## 現状の注意（2026-07-08 G2完了時点）

- **F3-1の誤配線防止柵は解除済み**: 2026-07-08の再取込みで柱2のF-1修正（`redactUrlForError`）を含むHEAD（`bf435ed`）が反映されたため、backendから本ディレクトリを参照してよい。
- typecheck は柱3ルートの `tsconfig.packages.json`（柱2 `tsconfig.base.json` と同一の compilerOptions を維持すること）、テストは柱3ルートの `vitest.config.ts`（`packages/*/test/**/*.test.ts`）で実行される。

## 再取込み（更新）手順

```sh
# 1. 柱2側で対象パッケージの split ブランチを作る（読み取りのみ・作業ツリーに影響なし）
cd /Users/minako-yamamoto/s/jp-opendata-actors
git subtree split --prefix=packages/<柱2prefix> -b split-<柱2prefix>-for-pillar3

# 2. 柱3側で subtree pull（初回のみ subtree add）
cd /Users/minako-yamamoto/s/company-list-cleaner
git subtree pull --prefix=packages/<柱3ディレクトリ> \
  /Users/minako-yamamoto/s/jp-opendata-actors split-<柱2prefix>-for-pillar3

# 3. 後片付けと記録
cd /Users/minako-yamamoto/s/jp-opendata-actors && git branch -D split-<柱2prefix>-for-pillar3
# → 本ファイルの取込み履歴に1行追記（対象・取込元HEADとsplitコミットのハッシュ）
# → pnpm install && pnpm typecheck && pnpm test で緑を確認
```

柱2側で npm 公開（scoped public）が済んだら subtree をやめて依存を npm に切替してよい（将来の任意最適化。切替時に decisions.md へ記録）。
