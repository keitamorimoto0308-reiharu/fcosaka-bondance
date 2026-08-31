# FC OSAKA×UPDATER サステナ盆踊り 出店応募・出展者管理システム

2026年10月24日（土）東大阪市花園ラグビー場 場外エリアで開催する「サステナ盆踊り」の
出店応募フォーム・出展者管理ページ・配布キットを提供する。

- 公開URL: https://bondance.kreha-c.com/
- 主催: サステナ盆踊り実行委員会（FC大阪／UPDATER）
- 問い合わせ: fcosaka_bondance@kreha-c.com

## 構成

| ディレクトリ | 内容 |
|---|---|
| `src/` | 項目定義スキーマとビルドスクリプト（フォームHTMLとGAS側検証をここから生成） |
| `gas/` | Google Apps Script のソース（clasp管理） |
| `assets/` | ロゴ・画像。差し替え可能 |
| `test/` | Playwright による受け入れテスト |
| `docs/` | 運用手順書 |

## 運用ドキュメント

README の運用手順は Phase 2 完了時に整備する。

---
制作: LONG ONE Produce
