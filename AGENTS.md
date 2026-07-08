# company-list-cleaner

作業前に必ず docs/handover.md を全文読むこと。§13 Do/Don't と CR-1〜7（国税庁承認条件）は絶対規則。
読み順: docs/handover.md → docs/requirements.md → docs/marketing.md（矛盾時は requirements.md が正）
OAuthスコープは3点固定（handover §5）。増やすPRは作らない。
未定義事項は最小実装＋TODOで前進し、docs/decisions.md に1行残す。
検証: pnpm typecheck && pnpm test（P0でスクリプト整備後、着手前に緑を確認）
柱1（jp-tender-intel）・柱2（jp-opendata-actors）Phase1の作業と競合したら常にそちらを優先する。
docs/addendum-v1.1.md は既存3文書の該当節を上書きする正誤表。作業前に必ず読むこと。
packages/{jp-corp-core,schema-buffer,normalize-jp,testing} は柱2からのsubtree取込み（改変禁止・柱2に還元してから再取込み。記録はpackages/jp-corp-core/SYNC.md）。F3-1の参照禁止柵は2026-07-08の再取込み（F-1修正含む）で解除済み。
