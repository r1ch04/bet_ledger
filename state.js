/* ================================================================
   共用狀態與 DOM 工具
   ================================================================ */
export const state = {
  records: [],
  filtered: [],
  editingId: null,
  charts: {},
  cacheMode: 'memory',
  lastUpdated: null,
  user: null,
  supabase: null,
  isOnline: navigator.onLine,
  isReadOnly: false,
  pendingCount: 0,
  platformStats: {},
  selectedPlatform: '',
  sortKey: 'date',
  sortDir: 'asc',
  animateRows: false,
};

export const $ = id => document.getElementById(id);
