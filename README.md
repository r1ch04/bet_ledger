# 📊 BetLedger（預測帳本）

通用投注與預測帳本 — 雲端同步、分析圖表、PWA 支援

> 重構計畫與資料庫 Schema 見 [`docs/refactor-plan.md`](docs/refactor-plan.md)。

## 部署方式

### 前端：GitHub Pages（GitHub Actions 自動建置）

1. push 到 `main` 後，`.github/workflows/deploy.yml` 會自動 `npm ci && npm run build` 並發佈 `dist/`
2. 首次需在 repo **Settings → Pages → Source** 選擇 **GitHub Actions**
3. `config.js` 中的 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY` 需已設定正確

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

## 本機預覽

開發伺服器（Vite）；`npm run build` 輸出至 `dist/`，`npm run preview` 預覽建置結果：

```bash
npm run dev        # http://localhost:5500
```

## 前端架構

- 純 HTML + CSS + Vanilla JS，以原生 ES modules 拆分（Vite 建置）
- 模組：`config.js`（設定集中）/ `state.js` / `utils.js` / `calc.js`（統計）/ `charts.js`（圖表）/ `itemFormat.js`（項目字串解析組合）/ `app.js`（入口、DOM、Supabase）
- Chart.js + Font Awesome（CDN）
- Supabase JS SDK v2（client-side，直接操作資料庫）
- PWA（`public/manifest.webmanifest` + `public/sw.js`）

## 使用技巧

- **新增**：右上「新增紀錄」、紀錄頁「新增」或手機右下角「＋」，都會從右側滑出表單抽屜
- **編輯**：點整列或用列尾「⋯」→ 完整編輯；**雙擊欄位** → 就地快速修改
- 抽屜內 `Ctrl/Cmd + Enter` 儲存、`Esc` 關閉；`N` 新增、`/` 聚焦搜尋
- **快速建立項目**：表單分為「聯賽／對戰／選項」三格，會依歷史紀錄自動完成（datalist），再自動組成
  `聯賽【對戰：選項】@賠率` 格式；「新增一腿」可做串關，快捷標籤（波膽、BTTS YES、大小…）一鍵帶入。
- 表單的「賠率」為選填輔助：填了會自動換算支付額
- **排序**：點任一欄位標題切換升／降冪（日期、文字預設升冪，金額類預設降冪），排序會被記住
- **賠率欄**：自動解析項目字串結尾的 `@賠率`；雙擊可直接修改（會寫回項目）
- **欄位顯示**：工具列「欄位」可勾選要顯示的欄位，設定會被記住
- 平台會記住上次輸入；篩選條件會自動保留（工具列「篩選」可收合）
- 匯入支援 CSV / JSON（含舊版 `{ records: [...] }` 格式），採**合併去重**；登入時會自動上傳雲端
- 操作結果以 toast 提示，新增/編輯的列會短暫高亮
- 刪除、清除、遷移等破壞性操作使用自製確認視窗（非瀏覽器原生彈窗）
- 動效：KPI 數字滾動、資料列進場、建立器腿進出、主題切換過場（皆尊重系統「減少動態」設定）


## 資料庫

在 Supabase SQL Editor 執行 `docs/refactor-plan.md` 中的 Schema 建立 `bets` 與 `shares` 資料表。
