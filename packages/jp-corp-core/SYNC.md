# SYNC.md — 柱2からの取込み記録（引継書§7.4）

このディレクトリは **jp-opendata-actors（柱2）の `packages/gov-clients` を git subtree で取込んだもの**。
本ファイル（SYNC.md）だけが柱3ローカルの追加ファイルで、それ以外の**本リポジトリ側での改変は原則禁止**——変更が必要なら柱2側に還元してから再取込みする。

## 取込み履歴（新しいものを上に）

| 日付 | 取込元コミット（jp-opendata-actors HEAD） | split コミット | 備考 |
|---|---|---|---|
| 2026-07-08 | `7210ce0719de1d5ebf9467366f962f142edab385` | `7adc09f4b614d8c8d1a1cbdca5494ac5201bc6b8` | 初回取込み。内容は http.ts＋edinetクライアント＋houjin fixtures |

## 現状の注意（2026-07-08時点）

- **houjin / gbizinfo クライアントは柱2側で未実装**（柱2 Phase 2/3 のTODO）。柱3が必要とする本体はまだ含まれていない。柱2側で実装され次第、下記手順で再取込みする。
- `package.json` が柱2の workspace パッケージ（`@jp-opendata/normalize-jp` 等）に `workspace:*` で依存しているため、**本リポジトリの pnpm-workspace には組み込んでいない**（組み込むと `pnpm install` が解決不能で失敗する）。backend から利用を開始する際に、①依存パッケージも subtree 取込みする か ②柱2の npm 公開（scoped public）を待って依存切替する かを決め、decisions.md に記録する。

## 再取込み（更新）手順

```sh
# 1. 柱2側で split ブランチを作る（読み取りのみ・作業ツリーに影響なし）
cd /Users/minako-yamamoto/s/jp-opendata-actors
git subtree split --prefix=packages/gov-clients -b split-gov-clients-for-pillar3

# 2. 柱3側で subtree pull
cd /Users/minako-yamamoto/s/company-list-cleaner
git subtree pull --prefix=packages/jp-corp-core \
  /Users/minako-yamamoto/s/jp-opendata-actors split-gov-clients-for-pillar3

# 3. 後片付けと記録
cd /Users/minako-yamamoto/s/jp-opendata-actors && git branch -D split-gov-clients-for-pillar3
# → 本ファイルの取込み履歴に1行追記（取込元HEADとsplitコミットのハッシュ）
```

柱2側で npm 公開（scoped public）が済んだら subtree をやめて依存を npm に切替する（引継書§7.4。切替時に decisions.md へ記録）。
