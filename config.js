/* ================================================================
   全域設定 — 所有可調參數集中於此，改這裡就好
   ================================================================ */

/* Supabase 專案設定（anon key 為公開金鑰，安全性依賴 RLS） */
export const SUPABASE_URL = 'https://vgqoidbtynvpfiwmzdlc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncW9pZGJ0eW52cGZpd216ZGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDIxNjksImV4cCI6MjA5NzcxODE2OX0.oLWbLTuEAHjtM-ar0PR8UrTaC1tQv4qVHB6isH_SMfc';

/* 品牌 */
export const BRAND = {
  name: 'BetLedger · 預測帳本',
  shortName: 'BetLedger',
  description: '通用投注與預測帳本',
  icon: '📊',
};

/* localStorage keys */
export const STORAGE_KEY = 'brd-v3';
export const FILTER_KEY = 'bl-filters-v1';
export const PREF_KEY = 'bl-prefs-v1';

/* 預設資料與平台 */
export const DEFAULT_RECORDS = [];
export const DEFAULT_PLATFORMS = ['Stake', 'MEXC'];

/* 快速模板（對應 index.html 的 data-template） */
export const TEMPLATES = {
  parlay: { label: '串關', item: '【A】+【B】@odds' },
  hedge: { label: '對沖', hedge: '是' },
  overunder: { label: '大/小球', item: '【隊A vs 隊B：大於/小於X.X】' },
};

/* 圖表配色 */
export const CHART_COLORS = ['#01696f', '#437a22', '#964219', '#a12c7b', '#4f98a3', '#78b74d'];

/* 紀錄表格欄位（操作欄固定顯示，不在此列） */
export const COLUMNS = [
  { key: 'date', label: '日期' },
  { key: 'is_hedge', label: '類型' },
  { key: 'status', label: '狀態' },
  { key: 'item', label: '項目' },
  { key: 'platform', label: '平台' },
  { key: 'odds', label: '賠率' },
  { key: 'principal', label: '本金' },
  { key: 'payout', label: '支付額' },
  { key: 'pnl', label: '盈虧' },
  { key: 'roi', label: 'ROI' },
];
