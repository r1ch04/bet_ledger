# BetLedger 重構計畫

把現有「世界盃投注追蹤」升級為**通用投注／預測帳本**：任何「押注或預測事件 → 結算盈虧」都適用，運動只是其中一種分類。

> 本文件為計畫。實作依下方 Phase 順序進行。
> 進度：Phase 2 部分完成 — 已抽出 `config.js` 並模組化（`state` / `utils` / `calc` / `charts` / `app`），並加入操作便利功能；**動態表單與分組維度參數化待 Phase 1 schema 後進行**。Phase 1／3／4 待進行。

---

## 0. 目標與原則

- **通用化**：資料模型不得假設「運動賽事」。分類、玩法、平台皆可自訂。
- **零停機**：資料庫採 additive migration，舊資料保留並回填，不破壞現有使用者。
- **無 build step**：維持純靜態 + 原生 ES modules，部署於 GitHub Pages。
- **後端不搬家**：伺服器邏輯一律留在 Supabase（Edge Functions），不引入 Node server。

---

## 1. 詞彙與領域定調

| 通用概念 | 目前欄位 | 說明 |
|---|---|---|
| 事件 (Event) | `item` | 「巴西 vs 摩洛哥」「BTC 破 10 萬」「某候選人勝選」 |
| 分類 (Category) | 無 | 運動 / 加密 / 選舉 / 電競…（可自訂） |
| 子分類 (Subcategory) | 無 | 聯賽 / 幣種 / 州別… |
| 玩法 (Market) | 無 | 讓分 / 大小 / 二元預測… |
| 選擇 (Selection) | 無 | 押注的那一邊 |
| 賠率 (Odds) | 無（由 payout/principal 反推） | 顯式欄位 |
| 投入 / 支付 | `principal` / `payout` | 保留 |
| 結算 | `status` | 擴充 `void` / `cashed_out` |
| 類型 | `is_hedge` | 改為通用 `bet_type` |

---

## 2. 資料模型（Phase 1，核心）

`bets` 改為通用帳本（全部 additive，保留 `item` 相容舊資料）：

```
bets
  id, user_id
  occurred_at        -- 取代 date，保留 date 相容
  title              -- 事件名稱（由 item backfill）
  category           -- 可自訂分類
  subcategory        -- 可自訂子分類
  market             -- 玩法／市場
  selection          -- 押注選項
  odds               -- 賠率（可空，空則由 payout/stake 推）
  stake              -- = principal
  payout
  pnl                -- generated column: payout - stake
  roi                -- generated column
  status             -- pending / settled / void / cashed_out
  bet_type           -- 一般 / 對沖 / 串關（可自訂）
  platform
  currency           -- 多幣別
  tags               -- text[]
  meta               -- jsonb，分類專屬欄位
  notes
  created_at, updated_at
```

字典表（讓分類／平台／玩法／類型可自訂）：

```
dictionaries (id, user_id, kind, name, color, sort)
  kind ∈ { category, subcategory, platform, market, bet_type }
```

- 舊資料回填：`title = item`、`stake = principal`，其餘留空。
- `pnl` / `roi` 改為 DB generated column，前後端不再各算一次。
- RLS 規則維持不變。

---

## 3. 前端重構（Phase 2）

1. **抽 `config.js`**：品牌名、預設幣別、時區、bet_type 清單、可用分組維度。
2. **拆 `app.js`（1336 行）為 ES modules**（no-build）：
   `state.js` / `api.js`（Supabase）/ `calc.js`（統計、Kelly、對沖）/ `render.js` / `charts.js` / `form.js`。
3. **分組維度參數化**：圖表與平台統計目前寫死按 `platform`，改為可選 `category / subcategory / platform / bet_type / tag`。
4. **表單動態化**：選分類後依 `dictionaries` + `meta` 顯示對應欄位；寫死的「串關／對沖／大球」模板（`index.html:81-83`）改為字典驅動。
5. **保留不動**：離線快取、PWA、分享連結、Kelly、對沖分析（本質皆為通用邏輯）。

---

## 4. 後端（Phase 3）

- `supabase/functions/bets/index.ts` 擴充新欄位（現僅 90 行，好改）。
- 新增 migration SQL：加欄位 → backfill → 加 generated columns → 建 `dictionaries`。
- `supabase/functions/share/index.ts` 只需帶上新欄位，邏輯不變。

---

## 5. 品牌（Phase 4）

- 產品名：**BetLedger（預測帳本）**。
- 更新：`package.json` / `package-lock.json` / PWA manifest（`app.js`）/ `index.html` 標題與 meta / `README.md`。
- 圖示由 ⚽ 改為通用圖表符號。
- 內部 localStorage key `SK`（`app.js:32`）暫不更動，避免舊使用者本地快取遺失；待 Phase 1 完成後再評估遷移。

---

## 6. 部署與環境

### 主機選擇：維持 GitHub Pages

「後端」在 Supabase，GitHub Pages 僅負責靜態檔，是合適組合。

| 項目 | 建議 |
|---|---|
| 靜態前端 | GitHub Pages（Source: Deploy from branch, `/`） |
| 資料庫／Auth | Supabase |
| 伺服器邏輯 | Supabase Edge Functions（`bets`、`share`） |
| 金鑰 | anon key 可公開（`app.js`）；secret key 僅存 Edge Functions，**嚴禁進 repo** |
| RLS | 必須開啟，anon key 公開的前提 |

### 注意事項

- **`.nojekyll`**：目前缺少。若日後引入 `_` 開頭資料夾或 bundler 產物，Jekyll 會忽略它們；建議在 repo 根目錄加一個空的 `.nojekyll`。
- **ES modules 路徑**：拆模組後用相對路徑（`./`），因 project page 位於 `/repo/` 子路徑。
- **路由**：目前單一 `index.html`、無 router，無需處理；若未來加前端路由，Pages 無 fallback，需用 `404.html` 複製法。
- **快取**：Pages 有 CDN，但部署後需注意 Service Worker 版本更新策略。
- **限制**：repo 1GB、月流量 100GB、每小時 10 次建置 — 此規模足夠。
- **不適合 Pages 的場景**：SSR、cron、webhook、影像處理 → 一律放 Supabase Edge Functions。

### 何時才需換主機

僅在需要 SSR／SEO 公開頁面或複雜 server 邏輯時，才評估 Cloudflare Pages / Vercel。現階段不需要。

---

## 7. 風險與執行順序

- **建議順序**：Phase 2（config + 模組化）→ Phase 1（schema）→ Phase 3（後端／migration）→ Phase 4（品牌）。
  先模組化再改 schema，改動才不會在 1336 行單檔中打結。
- **最大風險**：migration 舊資料相容。以 additive + backfill 可零停機。
- **相容期**：前端 `norm()`（`app.js:101`）需同時吃舊欄位與新欄位一段時間。
