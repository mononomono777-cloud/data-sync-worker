# SF6 Buckler Scraper

Street Fighter 6 の [Buckler](https://www.streetfighter.com/6/buckler/) から、プレイヤーの LP/MR データを自動取得するスクレイピングツール。

## 技術スタック

- **Playwright** (Chromium) — ブラウザ自動化
- **GitHub Actions** — 定期実行 (毎日 JST 0:00)

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
npx playwright install chromium
```

### 2. 環境変数の設定

```bash
# Windows (PowerShell)
$env:CAPCOM_ID = "your_capcom_id"
$env:CAPCOM_PASSWORD = "your_password"

# Linux/Mac
export CAPCOM_ID="your_capcom_id"
export CAPCOM_PASSWORD="your_password"
```

### 3. ローカル実行

```bash
node fetch_stats.js
```

結果は `data/<short_id>.json` に保存されます。

## GitHub Actions での運用

### 必要な Secrets

| Secret 名 | 説明 |
|-----------|------|
| `CAPCOM_ID` | CAPCOM ID (メールアドレス) |
| `CAPCOM_PASSWORD` | CAPCOM ID のパスワード |
| `STORAGE_STATE_BASE64` | (任意) セッション情報の Base64 エンコード |

### セッション永続化

初回ログイン後に生成される `storageState.json` を Base64 エンコードして Secrets に保存すると、以降のログイン処理をスキップできます。

```bash
# storageState.json を Base64 化
base64 -w 0 storageState.json
# 出力結果を GitHub Secrets の STORAGE_STATE_BASE64 に設定
```

## 出力フォーマット

```json
{
  "shortId": "2310599217",
  "fetchedAt": "2026-02-12T12:00:00.000Z",
  "fighterName": "PlayerName",
  "favoriteCharacterName": "Ryu",
  "currentAct": [
    { "characterName": "Ryu", "lp": 25000, "mr": 1800 }
  ],
  "pastActs": {
    "0": [...],
    "1": [...]
  }
}
```
