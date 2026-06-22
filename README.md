# ⚽ 投注追蹤 (Worldcup Calc)

世界盃投注追蹤計算機 — 雲端同步、分析圖表、PWA 支援

## 部署方式

### 前端：GitHub Pages（靜態網站）

1. 將此 repo push 到 GitHub
2. 在 repo 設定中啟用 GitHub Pages（Source: Deploy from branch, branch: main, folder: /）
3. 確保 `app.js` 中的 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY` 已設定正確

### 後端 API（選用）：Supabase Edge Functions

需安裝 Supabase CLI：
```bash
npm install -g supabase
supabase login
supabase link --project-ref 你的專案參考編號
```

部署函數：
```bash
supabase functions deploy bets
supabase functions deploy share
```

本機開發：
```bash
supabase functions serve --env-file .env
```

## 環境變數

Edge Functions 需要的環境變數（部署時由 Supabase 自動注入，本機開發需複製 `.env.example` 為 `.env`）：

| 變數 | 說明 |
|------|------|
| `SUPABASE_URL` | Supabase 專案 URL |
| `SUPABASE_PUBLISHABLE_KEY` | 公開金鑰（用於 publishable auth mode） |
| `SUPABASE_SECRET_KEY` | 服務角色金鑰（用於 admin client 繞過 RLS） |
| `SUPABASE_JWKS_URL` | JWT 驗證端點（`${SUPABASE_URL}/.well-known/jwks.json`） |

## Edge Functions API

### `GET /api/bets` — 列出注單（需 JWT 驗證）
### `POST /api/bets` — 新增注單
### `PUT /api/bets` — 更新注單
### `DELETE /api/bets?id=xxx` — 刪除注單
### `GET /api/share?token=xxx` — 驗證分享連結並回傳注單
### `POST /api/share` — 建立分享連結

## 前端架構

- 純 HTML + CSS + Vanilla JS（單一 `index.html`）
- Chart.js + Font Awesome（CDN）
- Supabase JS SDK v2（client-side，直接操作資料庫）
- PWA（manifest + Service Worker 動態註冊）
- 無 build step、無 bundler、無 framework

## 資料庫

在 Supabase SQL Editor 執行 `PRD_worldcup_calc.md` 中的 Schema 建立 `bets` 與 `shares` 資料表。
