/* ================================================================
   BetLedger — 入口模組
   ================================================================ */
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, BRAND,
  STORAGE_KEY, FILTER_KEY, PREF_KEY,
  DEFAULT_RECORDS, DEFAULT_PLATFORMS, TEMPLATES, COLUMNS,
} from './config.js';
import { state, $ } from './state.js';
import {
  fmt, pct, cls, outcome, escH, genId, norm, isSettled, storageOk,
} from './utils.js';
import { computeStats, computePlatformStats, computeKelly } from './calc.js';
import { renderCharts } from './charts.js';
import { parseItem, buildItemString, getOdds, setOdds } from './itemFormat.js';

/* 欄位顯示狀態（全部預設顯示） */
state.cols = Object.fromEntries(COLUMNS.map(c => [c.key, true]));

/* ================================================================
   PWA manifest 動態注入
   ================================================================ */
(function () {
  const manifest = {
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    start_url: './index.html',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [{ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='48' fill='%2301696f'/%3E%3Ctext x='50' y='68' text-anchor='middle' font-size='52' fill='white'%3E%F0%9F%93%8A%3C/text%3E%3C/svg%3E", sizes: '512x512', type: 'image/svg+xml' }],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
})();

/* ================================================================
   主題切換（data-theme 已在 HTML head 中初始化防止閃爍）
   ================================================================ */
(function () {
  const root = document.documentElement;
  let mode = root.getAttribute('data-theme') || 'light';
  const btn = $('themeBtn');
  const paint = () => { btn.innerHTML = mode === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>'; };
  paint();
  btn.addEventListener('click', () => {
    mode = mode === 'dark' ? 'light' : 'dark';
    if (!prefersReducedMotion()) {
      root.classList.add('theme-anim');
      setTimeout(() => root.classList.remove('theme-anim'), 420);
    }
    root.setAttribute('data-theme', mode);
    localStorage.setItem('theme', mode);
    paint();
    setTimeout(renderCharts, 80);
  });
})();

/* ================================================================
   localStorage 快取
   ================================================================ */
function saveCache() {
  state.lastUpdated = new Date().toLocaleString('zh-TW');
  const p = JSON.stringify({ records: state.records, lastUpdated: state.lastUpdated });
  if (storageOk()) { localStorage.setItem(STORAGE_KEY, p); state.cacheMode = 'localStorage'; }
  else { state._mem = p; state.cacheMode = 'memory'; }
  $('cacheStatus').textContent = state.cacheMode === 'localStorage' ? 'localStorage 持久' : '記憶體暫存';
  $('lastUpdated').textContent = state.lastUpdated;
}
function loadCache() {
  try { if (storageOk()) { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } } catch {}
  if (state._mem) { try { return JSON.parse(state._mem); } catch {} }
  return { records: JSON.parse(JSON.stringify(DEFAULT_RECORDS)), lastUpdated: new Date().toLocaleString('zh-TW') };
}

/* ================================================================
   使用者偏好（記住上次平台）與篩選記憶
   ================================================================ */
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } }
function savePrefs(patch) { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); } catch {} }

function saveFilters() {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify({
      platform: $('filterPlatform').value,
      hedge: $('filterHedge').value,
      outcome: $('filterOutcome').value,
      status: $('filterStatus').value,
      q: $('searchInput').value,
      sortKey: state.sortKey,
      sortDir: state.sortDir,
      cols: state.cols,
    }));
  } catch {}
}
function restoreFilters() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
    if (f.platform !== undefined) $('filterPlatform').value = f.platform;
    if (f.hedge !== undefined) $('filterHedge').value = f.hedge;
    if (f.outcome !== undefined) $('filterOutcome').value = f.outcome;
    if (f.status !== undefined) $('filterStatus').value = f.status;
    if (f.q !== undefined) $('searchInput').value = f.q;
    if (f.sortKey) state.sortKey = f.sortKey;
    if (f.sortDir) state.sortDir = f.sortDir;
    if (f.cols) state.cols = { ...state.cols, ...f.cols };
    if ([f.platform, f.hedge, f.outcome, f.status].some(Boolean)) $('filterPanel')?.classList.add('open');
  } catch {}
}

/* ================================================================
   Toast 通知與列高亮
   ================================================================ */
function toast(msg, type = 'info') {
  const host = $('toastHost');
  if (!host) return;
  const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
  t.querySelector('span').textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2600);
}

let highlightId = null;
function flashRow(id) {
  highlightId = id;
  const tr = document.querySelector(`#recordsTbody tr[data-id="${id}"]`);
  if (tr) { tr.classList.remove('row-in'); tr.classList.add('row-flash'); }
  setTimeout(() => {
    highlightId = null;
    document.querySelectorAll('#recordsTbody tr.row-flash').forEach(el => el.classList.remove('row-flash'));
  }, 1600);
}

/* ================================================================
   KPI 數字滾動動畫
   ================================================================ */
function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function animateNumber(el, to, format, duration = 600) {
  if (!el) return;
  const from = typeof el._cur === 'number' ? el._cur : 0;
  if (el._raf) cancelAnimationFrame(el._raf);
  if (prefersReducedMotion() || from === to) {
    el._cur = to;
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = from + (to - from) * eased;
    el._cur = v;
    el.textContent = format(v);
    if (t < 1) el._raf = requestAnimationFrame(tick);
    else { el._cur = to; el._raf = null; }
  };
  el._raf = requestAnimationFrame(tick);
}

/* ================================================================
   確認對話框（取代原生 confirm）
   ================================================================ */
let confirmResolve = null;

function confirmDialog({ title = '確認', message = '', confirmText = '確定', cancelText = '取消', danger = false } = {}) {
  return new Promise(resolve => {
    const m = $('confirmModal');
    if (!m) { resolve(window.confirm(message)); return; }
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    const ok = $('confirmOk');
    ok.textContent = confirmText;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    $('confirmCancel').textContent = cancelText;
    confirmResolve = resolve;
    m.classList.add('show');
    setTimeout(() => ok.focus(), 50);
  });
}

function closeConfirm(result) {
  const m = $('confirmModal');
  if (m) m.classList.remove('show');
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}

$('confirmOk').addEventListener('click', () => closeConfirm(true));
$('confirmCancel').addEventListener('click', () => closeConfirm(false));
$('confirmModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(false); });

/* ================================================================
   Supabase 初始化與 Auth
   ================================================================ */
let supabaseClient = null;
let realtimeChannel = null;
let offlineQueue = [];

/* 手動從 URL hash 取出 OAuth token，避免 SDK 非同步初始化未完成 */
function getTokensFromHash() {
  const h = window.location.hash;
  if (!h || !h.includes('access_token')) return null;
  const p = new URLSearchParams(h.replace('#', ''));
  const at = p.get('access_token');
  const rt = p.get('refresh_token');
  return at ? { access_token: at, refresh_token: rt || '' } : null;
}

async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Supabase 未設定，僅使用本地模式');
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    state.supabase = supabaseClient;
    supabaseClient.auth.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      if (user && !state.user) state.user = user;
      updateAuthUI();
      if (user) {
        setupRealtime();
        processOfflineQueue();
        checkShareMode();
      } else if (state.user) {
        state.user = null;
        updateAuthUI();
        unsubscribeRealtime();
      }
    });
    // 1. 優先處理 OAuth redirect URL hash（手動取出 token）
    const tokens = getTokensFromHash();
    if (tokens) {
      const { data, error } = await supabaseClient.auth.setSession(tokens);
      if (!error && data?.user) {
        state.user = data.user;
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
        updateAuthUI();
        setupRealtime();
        processOfflineQueue();
        checkShareMode();
        return;
      }
    }
    // 2. 從 localStorage 還原 session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user) {
      state.user = session.user;
      updateAuthUI();
      setupRealtime();
      processOfflineQueue();
      checkShareMode();
      return;
    }
    // 3. 最後嘗試由伺服器驗證 token
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        state.user = user;
        updateAuthUI();
        setupRealtime();
        processOfflineQueue();
        checkShareMode();
      }
    } catch (e) {
      /* 無網路時靜默失敗，維持本地模式 */
    }
  } catch (e) {
    console.warn('Supabase 初始化失敗，僅使用本地模式', e);
  }
}

function checkShareMode() {
  const params = new URLSearchParams(location.search);
  const token = params.get('share');
  if (!token) return;
  state.isReadOnly = true;
  document.querySelectorAll('.btn-danger, #addRecordBtn, #fabAdd, #deleteBtn, .icon-btn[data-del], .icon-btn[data-edit], .icon-btn[data-dup], .icon-btn[data-settle]').forEach(el => {
    if (el) el.style.display = 'none';
  });
  const loginBtn = $('loginBtn');
  if (loginBtn) loginBtn.textContent = '唯讀檢視模式';
  if (supabaseClient) {
    loadSharedData(token);
  }
}

async function loadSharedData(token) {
  try {
    const { data: shares, error: shareErr } = await supabaseClient
      .from('shares')
      .select('user_id, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (shareErr || !shares) {
      console.warn('分享連結無效');
      return;
    }
    if (shares.expires_at && new Date(shares.expires_at) < new Date()) {
      toast('此分享連結已過期', 'error');
      return;
    }
    const { data: bets, error: betsErr } = await supabaseClient
      .from('bets')
      .select('*')
      .eq('user_id', shares.user_id)
      .order('date', { ascending: true });
    if (betsErr) throw betsErr;
    if (bets) {
      state.records = bets.map(norm);
      saveCache();
      applyFilters();
    }
  } catch (e) {
    console.warn('載入分享資料失敗', e);
  }
}

function updateAuthUI() {
  const loginBtn = $('loginBtn');
  const userInfo = $('userInfo');
  const shareBtn = $('shareBtn');
  const syncStatus = $('syncStatus');
  /* DOM 尚未就緒時靜默返回 */
  if (!loginBtn || !userInfo) return;
  if (state.user) {
    try { loginBtn.style.display = 'none'; } catch {}
    try { userInfo.style.display = 'flex'; } catch {}
    const av = $('userAvatar'); if (av) av.src = state.user.user_metadata?.avatar_url || '';
    const em = $('userEmail'); if (em) em.textContent = state.user.email || '';
    if (shareBtn) shareBtn.style.display = '';
    if (syncStatus) syncStatus.textContent = '已同步雲端';
    if (state.records.length > 0 && !localStorage.getItem('migrated_' + state.user.id)) {
      promptMigration();
    }
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (userInfo) userInfo.style.display = 'none';
    if (shareBtn) shareBtn.style.display = 'none';
    if (syncStatus) syncStatus.textContent = '本地模式';
  }
}

async function promptMigration() {
  if (state.records.length === 0) return;
  const confirmed = await confirmDialog({
    title: '遷移本地資料',
    message: `偵測到 ${state.records.length} 筆本地資料，是否遷移至雲端？（遷移後仍可透過匯出備份）`,
    confirmText: '遷移至雲端',
  });
  if (confirmed) {
    await migrateLocalData();
  }
}

async function migrateLocalData() {
  if (!supabaseClient || !state.user || state.records.length === 0) return;
  try {
    const recordsToInsert = state.records.map(r => ({
      user_id: state.user.id,
      date: r.date,
      is_hedge: r.is_hedge === '是',
      item: r.item,
      platform: r.platform,
      principal: r.principal,
      payout: r.status === 'pending' ? 0 : r.payout,
      pnl: r.status === 'pending' ? 0 : r.pnl,
      roi: r.status === 'pending' ? 0 : r.roi,
      status: r.status || 'settled',
    }));
    const batchSize = 50;
    for (let i = 0; i < recordsToInsert.length; i += batchSize) {
      const batch = recordsToInsert.slice(i, i + batchSize);
      const { error } = await supabaseClient.from('bets').insert(batch);
      if (error) throw error;
    }
    localStorage.setItem('migrated_' + state.user.id, '1');
    await fetchSupabaseRecords();
  } catch (e) {
    console.error('遷移失敗', e);
    toast('遷移失敗：' + e.message, 'error');
  }
}

async function fetchSupabaseRecords() {
  if (!supabaseClient || !state.user) return;
  try {
    const { data, error } = await supabaseClient
      .from('bets')
      .select('*')
      .eq('user_id', state.user.id)
      .order('id', { ascending: false });
    if (error) throw error;
    if (data) {
      const serverIds = new Set(data.map(r => r.id));
      // keep local records that don't exist on server yet (not synced)
      const localOnly = state.records.filter(r => !r.supabaseId && !serverIds.has(r.id));
      state.records = [...data.map(norm), ...localOnly];
      saveCache();
      applyFilters();
    }
  } catch (e) {
    console.error('讀取雲端資料失敗', e);
  }
}

async function handleLogin() {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  } catch (e) {
    console.error('登入失敗', e);
  }
}

async function handleLogout() {
  if (!supabaseClient) return;
  try {
    await supabaseClient.auth.signOut();
    state.user = null;
    updateAuthUI();
    unsubscribeRealtime();
    const cached = loadCache();
    state.records = cached.records.map(norm);
    applyFilters();
  } catch (e) {
    console.error('登出失敗', e);
  }
}

/* ================================================================
   Supabase Realtime 訂閱
   ================================================================ */
function setupRealtime() {
  if (!supabaseClient || !state.user) return;
  unsubscribeRealtime();
  realtimeChannel = supabaseClient.channel('bets_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'bets', filter: `user_id=eq.${state.user.id}` },
      () => { fetchSupabaseRecords(); }
    )
    .subscribe();
}

function unsubscribeRealtime() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

/* ================================================================
   Supabase CRUD 同步與離線佇列
   ================================================================ */
function isOffline() { return !navigator.onLine; }

function addToOfflineQueue(operation) {
  offlineQueue.push(operation);
  try { localStorage.setItem('offlineQueue_' + (state.user?.id || 'anon'), JSON.stringify(offlineQueue)); } catch {}
}

async function processOfflineQueue() {
  if (!supabaseClient || !state.user) return;
  const key = 'offlineQueue_' + state.user.id;
  try {
    const q = localStorage.getItem(key);
    if (q) offlineQueue = JSON.parse(q);
  } catch { offlineQueue = []; }
  if (offlineQueue.length === 0) return;
  const remaining = [];
  for (const op of offlineQueue) {
    try { await executeSyncOp(op); } catch (e) { remaining.push(op); }
  }
  offlineQueue = remaining;
  try { localStorage.setItem(key, JSON.stringify(offlineQueue)); } catch {}
}

async function executeSyncOp(op) {
  if (!supabaseClient || !state.user) return;
  const { action, record } = op;
  const base = {
    user_id: state.user.id,
    date: record.date,
    is_hedge: record.is_hedge === '是',
    item: record.item,
    platform: record.platform,
    principal: record.principal,
    payout: record.status === 'pending' ? 0 : (record.payout || 0),
    pnl: record.status === 'pending' ? 0 : (record.pnl || 0),
    roi: record.status === 'pending' ? 0 : (record.roi || 0),
    status: record.status || 'settled',
  };
  if (action === 'insert') {
    const { error } = await supabaseClient.from('bets').insert(base);
    if (error) throw error;
  } else if (action === 'update') {
    const { error, status } = await supabaseClient.from('bets').update(base).eq('id', record.supabaseId || record.id);
    if (status === 404) {
      state.records = state.records.filter(r => (r.supabaseId || r.id) !== (record.supabaseId || record.id));
      saveCache();
      return;
    }
    if (error) throw error;
  } else if (action === 'delete') {
    const { error, status } = await supabaseClient.from('bets').delete().eq('id', record.supabaseId || record.id);
    if (status === 404) return;
    if (error) throw error;
  }
}

async function syncToSupabase(action, record) {
  if (!supabaseClient || !state.user || state.isReadOnly) return;
  if (isOffline()) {
    addToOfflineQueue({ action, record });
    return;
  }
  try {
    await executeSyncOp({ action, record });
    await fetchSupabaseRecords();
  } catch (e) {
    console.warn('同步失敗，加入離線佇列', e);
    addToOfflineQueue({ action, record });
  }
}

/* ================================================================
   PWA Service Worker 動態註冊（同源 JS/HTML 採 network-first 避免模組版本不一致）
   ================================================================ */
(function () {
  if (!('serviceWorker' in navigator)) return;
  const host = SUPABASE_URL.replace('https://', '').split('.')[0];
  const origin = location.origin;
  const swCode = `
    const CACHE = 'betledger-v1';
    const ORIGIN = '${origin}';
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', e => {
      if (e.request.method !== 'GET') return;
      const url = new URL(e.request.url);
      if (url.hostname.includes('supabase')) {
        e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
        return;
      }
      const d = e.request.destination;
      if (url.origin === ORIGIN && (d === 'script' || d === 'document' || d === 'style')) {
        e.respondWith(
          fetch(e.request).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
            return res;
          }).catch(() => caches.match(e.request))
        );
        return;
      }
      e.respondWith(
        caches.open(CACHE).then(cache =>
          cache.match(e.request).then(cached =>
            cached || fetch(e.request).then(res => {
              if (res.ok) cache.put(e.request, res.clone());
              return res;
            })
          )
        )
      );
    });
  `;
  try {
    const swUrl = URL.createObjectURL(new Blob([swCode], { type: 'application/javascript' }));
    navigator.serviceWorker.register(swUrl).catch(() => {});
  } catch (e) {}
})();

/* ================================================================
   離線偵測
   ================================================================ */
window.addEventListener('online', () => {
  state.isOnline = true;
  $('offlineBanner').classList.remove('show');
  processOfflineQueue();
  if (state.user) fetchSupabaseRecords();
});
window.addEventListener('offline', () => {
  state.isOnline = false;
  $('offlineBanner').classList.add('show');
});

/* ================================================================
   項目快速建立器（解析歷史格式、自動完成，減少打字）
   ================================================================ */
const builderLegs = $('builderLegs');
const builderPreview = $('builderPreview');
const freeToggle = $('freeTextToggle');
const freeField = $('freeTextField');

/* 解析 `聯賽【對戰：選項】+【…】@賠率` */
function makeLeg(data = {}) {
  const leg = document.createElement('div');
  leg.className = 'leg';
  leg.innerHTML = `
    <div class="leg-fields">
      <input class="leg-league" list="leagueList" placeholder="聯賽（英超）" autocomplete="off" value="${escH(data.league || '')}"/>
      <input class="leg-match" list="matchList" placeholder="對戰（曼城vs水晶宮）" autocomplete="off" value="${escH(data.match || '')}"/>
      <input class="leg-selection" list="selectionList" placeholder="選項（波膽0-1）" autocomplete="off" value="${escH(data.selection || '')}"/>
    </div>
    <button type="button" class="leg-remove" title="移除這腿"><i class="fa-solid fa-xmark"></i></button>`;
  leg.querySelectorAll('input').forEach(inp => inp.addEventListener('input', syncBuilder));
  leg.querySelector('.leg-remove').addEventListener('click', () => {
    if (builderLegs.querySelectorAll('.leg').length > 1) {
      leg.classList.add('leg-out');
      let done = false;
      const finish = () => { if (done) return; done = true; leg.remove(); };
      leg.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 250);
    } else {
      leg.querySelectorAll('input').forEach(i => { i.value = ''; });
    }
    syncBuilder();
  });
  builderLegs.appendChild(leg);
  return leg;
}

function composeItem() {
  const legs = [...builderLegs.querySelectorAll('.leg')].map(leg => ({
    league: leg.querySelector('.leg-league').value,
    match: leg.querySelector('.leg-match').value,
    selection: leg.querySelector('.leg-selection').value,
  }));
  return buildItemString(legs, $('fOdds').value.trim());
}

function syncBuilder() {
  if (freeToggle.checked) return;
  const item = composeItem();
  $('fItem').value = item;
  builderPreview.textContent = item || '尚未填寫，直接輸入聯賽／對戰／選項即可';
  builderPreview.classList.toggle('is-empty', !item);
}

function setFreeText(on) {
  freeToggle.checked = on;
  $('itemBuilder').classList.toggle('collapsed', on);
  freeField.style.display = on ? '' : 'none';
}

function fillBuilder(itemStr) {
  builderLegs.innerHTML = '';
  const { legs, odds } = parseItem(itemStr);
  if (odds) $('fOdds').value = odds;
  const hasBrackets = String(itemStr || '').includes('【');
  if (hasBrackets && legs.length) {
    setFreeText(false);
    legs.forEach(l => makeLeg(l));
    syncBuilder();
  } else if (String(itemStr || '').trim()) {
    setFreeText(true);
    $('fItem').value = itemStr;
  } else {
    setFreeText(false);
    makeLeg();
    syncBuilder();
  }
}

function fillDatalist(id, values) {
  const dl = $(id);
  if (!dl) return;
  dl.innerHTML = [...values].filter(Boolean).sort().map(v => `<option value="${escH(v)}"></option>`).join('');
}

function refreshItemDatalists() {
  const leagues = new Set(), matches = new Set(), selections = new Set(), platforms = new Set(DEFAULT_PLATFORMS);
  state.records.forEach(r => {
    if (r.platform) platforms.add(r.platform);
    parseItem(r.item).legs.forEach(l => {
      if (l.league) leagues.add(l.league);
      if (l.match) matches.add(l.match);
      if (l.selection) selections.add(l.selection);
    });
  });
  fillDatalist('leagueList', leagues);
  fillDatalist('matchList', matches);
  fillDatalist('selectionList', selections);
  fillDatalist('platformList', platforms);
}

freeToggle.addEventListener('change', () => {
  const on = freeToggle.checked;
  if (on) $('fItem').value = composeItem();
  setFreeText(on);
  if (on) $('fItem').focus();
  else syncBuilder();
});

$('addLegBtn').addEventListener('click', () => {
  const leg = makeLeg();
  syncBuilder();
  leg.querySelector('.leg-match').focus();
});

document.querySelectorAll('.chip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const leg = builderLegs.querySelector('.leg:last-child');
    if (!leg) return;
    const sel = leg.querySelector('.leg-selection');
    sel.value = sel.value ? sel.value + btn.dataset.chip : btn.dataset.chip;
    sel.focus();
    syncBuilder();
  });
});

/* ================================================================
   表單抽屜
   ================================================================ */
function openDrawer() {
  const d = $('recordDrawer');
  if (!d) return;
  d.classList.add('show');
  document.body.classList.add('no-scroll');
  setTimeout(() => {
    const first = d.querySelector('.leg-match') || d.querySelector('input,select,textarea');
    first?.focus?.();
  }, 60);
}

function closeDrawer() {
  const d = $('recordDrawer');
  if (!d) return;
  d.classList.remove('show');
  document.body.classList.remove('no-scroll');
}

function populateForm(r) {
  const isEdit = !!(r && r.id);
  state.editingId = isEdit ? r.id : null;
  $('recordId').value = isEdit ? r.id : '';
  $('fDate').value = r?.date ?? new Date().toISOString().slice(0, 10);
  $('fStatus').value = r?.status ?? 'settled';
  $('fHedge').value = r?.is_hedge ?? '否';
  $('fItem').value = r?.item ?? '';
  $('fPlatform').value = r?.platform ?? (loadPrefs().lastPlatform || '');
  $('fPrincipal').value = r?.principal ?? '';
  $('fPayout').value = r?.payout ?? '';
  $('fOdds').value = '';
  if (r?.status === 'pending') {
    $('fPayout').value = '0';
    $('fPnl').value = '0';
    $('fRoi').value = '0';
  } else {
    $('fPnl').value = r?.pnl ?? '';
    $('fRoi').value = r?.roi ?? '';
  }
  $('deleteBtn').disabled = !isEdit;
  $('saveBtn').innerHTML = isEdit ? '<i class="fa-solid fa-floppy-disk"></i> 更新紀錄' : '<i class="fa-solid fa-floppy-disk"></i> 儲存紀錄';
  $('formTitle').textContent = isEdit ? `編輯紀錄 #${r.id}` : (r ? '複製紀錄' : '新增紀錄');
  fillBuilder(r?.item);
}

function fillForm(r) { populateForm(r); openDrawer(); }

function resetForm() { closeDrawer(); }

function recalcDerived() {
  const p = +($('fPrincipal').value || 0);
  const pay = $('fStatus').value === 'pending' ? 0 : +($('fPayout').value || 0);
  $('fPnl').value = +(pay - p).toFixed(6);
  $('fRoi').value = p ? +((pay - p) / p).toFixed(6) : 0;
}

/* 賠率輔助：填了賠率就自動算支付額 */
function applyOdds() {
  const oddsEl = $('fOdds');
  if (!oddsEl || oddsEl.value === '') return;
  const p = +($('fPrincipal').value || 0);
  $('fPayout').value = +(p * (+oddsEl.value)).toFixed(4);
  recalcDerived();
}

function applyTemplate(type) {
  const tpl = TEMPLATES[type];
  if (!tpl) return;
  const itemField = $('fItem');
  const hedgeField = $('fHedge');
  if (tpl.item !== undefined) { itemField.value = tpl.item; itemField.focus(); }
  if (tpl.hedge !== undefined) hedgeField.value = tpl.hedge;
}

$('recordForm').addEventListener('submit', e => {
  e.preventDefault();
  if (state.isReadOnly) return;
  const id = +($('recordId').value || 0);
  const p = +($('fPrincipal').value || 0);
  const isPending = $('fStatus').value === 'pending';
  const pay = isPending ? 0 : +($('fPayout').value || 0);
  const pnlV = isPending ? 0 : ($('fPnl').value === '' ? pay - p : +$('fPnl').value);
  const roiV = isPending ? 0 : ($('fRoi').value === '' ? (p ? pnlV / p : 0) : +$('fRoi').value);
  const record = {
    id: id || genId(state.records),
    date: $('fDate').value,
    status: $('fStatus').value,
    is_hedge: $('fHedge').value,
    item: (freeToggle.checked ? $('fItem').value : composeItem()).trim(),
    platform: $('fPlatform').value.trim(),
    principal: p,
    payout: pay,
    pnl: +pnlV.toFixed(6),
    roi: +roiV.toFixed(6),
  };
  if (!record.item || !record.platform || !record.date) return;
  const idx = state.records.findIndex(r => r.id === record.id);
  if (idx >= 0) {
    state.records[idx] = record;
    if (supabaseClient && state.user) syncToSupabase('update', record);
  } else {
    state.records.push(record);
    if (supabaseClient && state.user) syncToSupabase('insert', record);
  }
  if (record.platform) savePrefs({ lastPlatform: record.platform });
  saveCache();
  refreshPlatformOpts();
  state.animateRows = true;
  applyFilters();
  populateForm(record);
  flashRow(record.id);
  toast(idx >= 0 ? '已更新紀錄' : '已新增紀錄', 'success');
});

function openRecordById(id) {
  const r = state.records.find(x => x.id === id);
  if (r) fillForm(r);
}

async function deleteRecord(id) {
  const rec = state.records.find(x => x.id === id);
  if (!rec) return;
  const ok = await confirmDialog({
    title: '刪除紀錄',
    message: '確定刪除此筆紀錄？此操作無法還原。',
    confirmText: '刪除',
    danger: true,
  });
  if (!ok) return;
  state.records = state.records.filter(r => r.id !== id);
  if (supabaseClient && state.user) syncToSupabase('delete', rec);
  saveCache();
  refreshPlatformOpts();
  state.animateRows = true;
  applyFilters();
  if (state.editingId === id) resetForm();
  toast('已刪除紀錄', 'success');
}

$('clearBtn').addEventListener('click', resetForm);
$('deleteBtn').addEventListener('click', () => {
  if (!state.editingId || state.isReadOnly) return;
  deleteRecord(state.editingId);
});
$('closeFormBtn').addEventListener('click', resetForm);
$('recordDrawer').addEventListener('click', e => { if (e.target === e.currentTarget) resetForm(); });
['fPrincipal', 'fPayout', 'fStatus'].forEach(id => $(id).addEventListener('input', recalcDerived));
$('fOdds').addEventListener('input', applyOdds);
$('fOdds').addEventListener('input', syncBuilder);
$('fPrincipal').addEventListener('input', applyOdds);

document.querySelectorAll('[data-template]').forEach(btn => {
  btn.addEventListener('click', () => applyTemplate(btn.dataset.template));
});

/* ================================================================
   分頁切換
   ================================================================ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active'); b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    $('tab-' + btn.dataset.tab).classList.add('active');
    setTimeout(renderCharts, 40);
  });
});

/* ================================================================
   拖曳排序
   ================================================================ */
function initDragGrid(gridEl) {
  if (!gridEl) return;
  let srcEl = null;
  gridEl.querySelectorAll('.drag-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      srcEl = item; item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.dragId || '');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      gridEl.querySelectorAll('.drag-item').forEach(i => i.classList.remove('drag-over'));
      srcEl = null; setTimeout(renderCharts, 60);
    });
    item.addEventListener('dragover', e => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      if (srcEl && srcEl !== item) item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('drag-over');
      if (!srcEl || srcEl === item) return;
      const items = [...gridEl.querySelectorAll('.drag-item')];
      const srcIdx = items.indexOf(srcEl), dstIdx = items.indexOf(item);
      if (srcIdx < dstIdx) item.after(srcEl); else item.before(srcEl);
    });
  });
}

/* ================================================================
   篩選與搜尋
   ================================================================ */
function refreshPlatformOpts() {
  const cur = $('filterPlatform').value;
  const platforms = [...new Set(state.records.map(r => r.platform).filter(Boolean))].sort();
  $('filterPlatform').innerHTML = '<option value="">全部</option>' +
    platforms.map(p => `<option>${escH(p)}</option>`).join('');
  $('filterPlatform').value = platforms.includes(cur) ? cur : '';
  refreshItemDatalists();
}

const filterPanel = $('filterPanel');
const filterToggle = $('filterToggle');

function updateFilterCount() {
  const active = ['filterPlatform', 'filterHedge', 'filterOutcome', 'filterStatus']
    .filter(id => $(id)?.value).length;
  const badge = $('filterCount');
  if (badge) badge.textContent = active ? String(active) : '';
  filterToggle?.classList.toggle('has-active', active > 0);
}

if (filterToggle && filterPanel) {
  filterToggle.addEventListener('click', () => {
    const open = filterPanel.classList.toggle('open');
    filterToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

const colMenu = $('colMenu');
const colToggle = $('colToggle');

function buildColMenu() {
  if (!colMenu) return;
  colMenu.innerHTML = COLUMNS.map(c =>
    `<label class="menu-check"><input type="checkbox" data-col-toggle="${c.key}" ${state.cols[c.key] ? 'checked' : ''}/><span>${c.label}</span></label>`
  ).join('');
  colMenu.querySelectorAll('[data-col-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.cols[cb.dataset.colToggle] = cb.checked;
      applyColumnVisibility();
      saveFilters();
    });
  });
}

function applyColumnVisibility() {
  document.querySelectorAll('#recordsTable [data-col]').forEach(el => {
    el.classList.toggle('col-hidden', state.cols[el.dataset.col] === false);
  });
}

if (colToggle && colMenu) {
  colToggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = colMenu.classList.toggle('open');
    colToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#colMenu') && !e.target.closest('#colToggle')) {
      colMenu.classList.remove('open');
      colToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

const SORT_TEXT = new Set(['is_hedge', 'status', 'item', 'platform']);

function sortRecords(arr) {
  const key = state.sortKey || 'date';
  const dir = state.sortDir === 'desc' ? -1 : 1;
  return arr.sort((a, b) => {
    let d;
    if (SORT_TEXT.has(key)) d = String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'zh-Hant');
    else if (key === 'date') d = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    else if (key === 'odds') d = (+getOdds(a.item) || 0) - (+getOdds(b.item) || 0);
    else d = (+a[key] || 0) - (+b[key] || 0);
    return (d * dir) || (a.id - b.id);
  });
}

function updateSortHeaders() {
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    if (th.dataset.sort === state.sortKey) th.setAttribute('aria-sort', state.sortDir === 'desc' ? 'descending' : 'ascending');
    else th.removeAttribute('aria-sort');
  });
}

document.querySelectorAll('thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortKey = key;
      state.sortDir = SORT_TEXT.has(key) || key === 'date' ? 'asc' : 'desc';
    }
    applyFilters();
  });
});

function applyFilters() {
  const pl = $('filterPlatform').value;
  const hd = $('filterHedge').value;
  const oc = $('filterOutcome').value;
  const st = $('filterStatus').value;
  const q = $('searchInput').value.trim().toLowerCase();
  saveFilters();
  updateFilterCount();
  state.filtered = sortRecords(state.records
    .filter(r => !pl || r.platform === pl)
    .filter(r => !hd || r.is_hedge === hd)
    .filter(r => !oc || outcome(r) === oc)
    .filter(r => !st || r.status === st)
    .filter(r => !q || [r.item, r.platform, r.date].join(' ').toLowerCase().includes(q)));
  updateSortHeaders();
  state.pendingCount = state.records.filter(r => r.status === 'pending').length;
  const stagger = state.animateRows;
  state.animateRows = false;
  renderTable(stagger);
  applyColumnVisibility();
  renderKPIs();
  renderInsights();
  renderStatsGrid();
  renderPlatformStats();
  renderKelly();
  renderHedgeAnalysis();
  renderCharts();
}

/* ================================================================
   表格渲染（含行內編輯、狀態標示）
   ================================================================ */
function renderTable(stagger) {
  const tbody = $('recordsTbody');
  tbody.innerHTML = '';
  $('recordCount').textContent = state.filtered.length;
  $('emptyState').classList.toggle('show', !state.filtered.length);
  state.filtered.forEach((r, i) => {
    const isPend = r.status === 'pending';
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (isPend) tr.className = 'row-pending';
    if (r.id === highlightId) tr.classList.add('row-flash');
    if (stagger) { tr.classList.add('row-in'); tr.style.animationDelay = Math.min(i, 15) * 16 + 'ms'; }
    const actions = state.isReadOnly ? '' : `<div class="menu">
        <button class="icon-btn menu-btn" data-menu="${r.id}" title="更多動作" aria-label="更多動作"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        <div class="menu-list">
          <button data-edit="${r.id}"><i class="fa-solid fa-pen"></i> 編輯</button>
          <button data-dup="${r.id}"><i class="fa-solid fa-copy"></i> 複製</button>
          ${isPend ? `<button data-settle="${r.id}"><i class="fa-solid fa-check"></i> 結算</button>` : ''}
          <button data-del="${r.id}" class="danger"><i class="fa-solid fa-trash-can"></i> 刪除</button>
        </div>
      </div>`;
    const odds = getOdds(r.item);
    tr.innerHTML = `
      <td data-col="date"><span class="inline-edit" data-field="date" data-id="${r.id}">${escH(r.date)}</span></td>
      <td data-col="is_hedge"><span class="chip ${r.is_hedge === '是' ? 'chip-hedge' : 'chip-normal'}"><i class="fa-solid ${r.is_hedge === '是' ? 'fa-shield-halved' : 'fa-circle-check'}"></i>${r.is_hedge === '是' ? '對沖' : '一般'}</span></td>
      <td data-col="status"><span class="chip ${isPend ? 'chip-pending' : 'chip-normal'}">${isPend ? '進行中' : '已結算'}</span></td>
      <td class="col-item" data-col="item" title="${escH(r.item)}"><span class="inline-edit" data-field="item" data-id="${r.id}">${escH(r.item)}</span></td>
      <td data-col="platform"><span class="inline-edit" data-field="platform" data-id="${r.id}">${escH(r.platform)}</span></td>
      <td data-col="odds">${odds ? `<span class="inline-edit" data-field="odds" data-id="${r.id}">${escH(odds)}</span>` : '<span class="pnl-pending">—</span>'}</td>
      <td data-col="principal"><span class="inline-edit" data-field="principal" data-id="${r.id}">${fmt(r.principal)}</span></td>
      <td data-col="payout">${isPend ? '<span class="pnl-pending">待結算</span>' : `<span class="inline-edit" data-field="payout" data-id="${r.id}">${fmt(r.payout, 4)}</span>`}</td>
      <td data-col="pnl" class="${isPend ? '' : cls(r.pnl)}">${isPend ? '<span class="pnl-pending">待結算</span>' : fmt(r.pnl, 4)}</td>
      <td data-col="roi" class="${isPend ? '' : cls(r.roi)}">${isPend ? '<span class="pnl-pending">—</span>' : pct(r.roi)}</td>
      <td class="col-actions">${actions}</td>`;
    tbody.appendChild(tr);
  });
  setupInlineEditEvents(tbody);
}

function setupInlineEditEvents(tbody) {
  tbody.querySelectorAll('.inline-edit').forEach(el => {
    el.addEventListener('dblclick', function () {
      clearTimeout(rowClickTimer);
      if (state.isReadOnly) return;
      if (this.tagName === 'INPUT' || this.tagName === 'SELECT') return;
      const field = this.dataset.field;
      const id = +this.dataset.id;
      let current = this.textContent.trim();
      if (field === 'principal') current = state.records.find(r => r.id === id)?.principal || '0';
      if (field === 'payout') current = state.records.find(r => r.id === id)?.payout || '0';
      if (field === 'odds') current = getOdds(state.records.find(r => r.id === id)?.item || '');
      if (field === 'platform') {
        const sel = document.createElement('select');
        sel.className = 'inline-edit';
        const platforms = [...new Set([...state.records.map(r => r.platform).filter(Boolean), ...DEFAULT_PLATFORMS])];
        platforms.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p; opt.textContent = p;
          if (p === current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function () {
          const rec = state.records.find(r => r.id === id);
          if (rec) { rec.platform = this.value; saveCache(); syncToSupabase('update', rec); applyFilters(); }
        });
        sel.addEventListener('blur', () => sel.remove());
        sel.addEventListener('keydown', e => { if (e.key === 'Escape') sel.remove(); });
        this.replaceWith(sel);
        sel.focus();
        return;
      }
      const input = document.createElement('input');
      input.className = 'inline-edit';
      input.type = field === 'date' ? 'date' : (field === 'principal' || field === 'payout' || field === 'odds') ? 'number' : 'text';
      if (field === 'principal' || field === 'payout') { input.step = '0.0001'; input.min = '0'; }
      if (field === 'odds') { input.step = '0.001'; input.min = '0'; }
      if (field === 'date') input.value = this.textContent.trim() || new Date().toISOString().slice(0, 10);
      else input.value = current;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const rec = state.records.find(r => r.id === id);
          if (rec && input.value !== undefined) {
            if (field === 'odds') {
              rec.item = setOdds(rec.item, input.value);
              saveCache();
              syncToSupabase('update', rec);
              refreshItemDatalists();
              applyFilters();
              return;
            }
            let val = input.value;
            if (field === 'principal' || field === 'payout') val = +val;
            rec[field] = val;
            if (field === 'payout' && rec.status === 'pending') {
              rec.status = 'settled';
              rec.pnl = rec.payout - rec.principal;
              rec.roi = rec.principal ? rec.pnl / rec.principal : 0;
            } else if (field === 'payout' || field === 'principal') {
              rec.pnl = rec.payout - rec.principal;
              rec.roi = rec.principal ? rec.pnl / rec.principal : 0;
            }
            saveCache();
            syncToSupabase('update', rec);
            applyFilters();
          }
        } else if (e.key === 'Escape') {
          applyFilters();
        }
      });
      input.addEventListener('blur', () => applyFilters());
      this.replaceWith(input);
      input.focus();
    });
  });
}

function closeMenus() {
  document.querySelectorAll('#recordsTbody .menu-list.open').forEach(m => m.classList.remove('open'));
}

let rowClickTimer = null;

$('recordsTbody').addEventListener('click', e => {
  const menuBtn = e.target.closest('[data-menu]');
  if (menuBtn) {
    e.stopPropagation();
    const list = menuBtn.parentElement.querySelector('.menu-list');
    const wasOpen = list.classList.contains('open');
    closeMenus();
    if (!wasOpen) list.classList.add('open');
    return;
  }
  const editId = e.target.closest('[data-edit]')?.dataset.edit;
  const dupId = e.target.closest('[data-dup]')?.dataset.dup;
  const delId = e.target.closest('[data-del]')?.dataset.del;
  const settleId = e.target.closest('[data-settle]')?.dataset.settle;
  if (editId || dupId || delId || settleId) closeMenus();
  if (editId) { openRecordById(+editId); return; }
  if (dupId && !state.isReadOnly) {
    const r = state.records.find(r => r.id === +dupId);
    if (r) fillForm({ ...r, id: null, date: new Date().toISOString().slice(0, 10) });
    return;
  }
  if (delId && !state.isReadOnly) { deleteRecord(+delId); return; }
  if (settleId) {
    const r = state.records.find(r => r.id === +settleId);
    if (r && r.status === 'pending') { fillForm(r); setTimeout(() => $('fPayout')?.focus(), 80); }
    return;
  }
  /* 點列開啟完整編輯（延遲以區分雙擊快編） */
  if (state.isReadOnly) return;
  if (e.target.closest('.menu')) return;
  const tr = e.target.closest('tr[data-id]');
  if (tr) {
    clearTimeout(rowClickTimer);
    rowClickTimer = setTimeout(() => openRecordById(+tr.dataset.id), 180);
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('#recordsTbody .menu')) closeMenus();
});

/* ================================================================
   KPI 渲染
   ================================================================ */
function renderKPIs() {
  const st = computeStats(state.filtered);
  const set = (id, to, format, c) => {
    const el = $(id);
    if (!el) return;
    if (c !== undefined) el.className = 'kpi-value' + (c ? ' ' + c : '');
    animateNumber(el, to, format);
  };
  set('kpiStake', st.stake, v => fmt(v));
  set('kpiPnl', st.pnlSum, v => (v >= 0 ? '+' : '') + fmt(v, 4), cls(st.pnlSum));
  set('kpiRoi', st.roi, v => pct(v), cls(st.roi));
  set('kpiWinRate', st.winRate, v => pct(v), cls(st.winRate - .5));
  set('kpiNHRoi', st.nhRoi, v => pct(v), cls(st.nhRoi));
  set('kpiAvgOdds', st.avgOdds, v => fmt(v, 2) + 'x');
  set('kpiMaxLoss', st.maxLoss, v => fmt(v, 4), 'neg');
  set('kpiPending', state.pendingCount, v => String(Math.round(v)), state.pendingCount ? 'neu' : '');
}

/* ================================================================
   深入統計
   ================================================================ */
function renderStatsGrid() {
  const st = computeStats(state.filtered);
  const cards = [
    { label: '非對沖本金', value: fmt(st.nhS), sub: '', c: '' },
    { label: '非對沖盈虧', value: (st.nhP >= 0 ? '+' : '') + fmt(st.nhP, 4), sub: '', c: cls(st.nhP) },
    { label: '平均獲利', value: (st.avgWin >= 0 ? '+' : '') + fmt(st.avgWin, 4), sub: '贏單平均', c: cls(st.avgWin) },
    { label: '平均虧損', value: fmt(st.avgLoss, 4), sub: '輸單平均', c: cls(st.avgLoss) },
    { label: '賺賠比 R:R', value: fmt(st.rr, 2), sub: '平均獲利÷平均虧損', c: cls(st.rr - 1) },
    { label: '獲利因子', value: isFinite(st.pf) ? fmt(st.pf, 2) : '∞', sub: '總獲利÷總虧損', c: cls(st.pf - 1) },
  ];
  $('statsGrid').innerHTML = cards.map(c =>
    `<div class="stat-card"><div class="label">${c.label}</div><div class="value ${c.c}" style="font-variant-numeric:tabular-nums">${c.value}</div><div style="font-size:var(--text-xs);color:var(--faint);margin-top:2px">${c.sub}</div></div>`
  ).join('');
}

/* ================================================================
   平台分頁統計
   ================================================================ */
function renderPlatformStats() {
  const stats = computePlatformStats(state.records);
  state.platformStats = stats;
  const tabsContainer = $('platformTabs');
  const content = $('platformStatsContent');
  if (!tabsContainer || !content) return;
  const platforms = Object.keys(stats);
  tabsContainer.innerHTML = platforms.map(p => {
    const name = p === '' ? '全部' : stats[p].name;
    const count = stats[p].count;
    return `<button class="platform-sub-tab ${p === state.selectedPlatform ? 'active' : ''}" data-platform="${escH(p)}">${escH(name)} (${count})</button>`;
  }).join('');
  const s = stats[state.selectedPlatform] || stats[''];
  const hedgeCount = state.records.filter(isSettled).filter(r => r.is_hedge === '是' && (state.selectedPlatform === '' || r.platform === state.selectedPlatform)).length;
  const hedgePct = s.count ? hedgeCount / s.count * 100 : 0;
  content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">注單數</div><div class="value">${s.count}</div></div>
      <div class="stat-card"><div class="label">總本金</div><div class="value">${fmt(s.stake)}</div></div>
      <div class="stat-card"><div class="label">總盈虧</div><div class="value ${cls(s.pnlSum)}">${(s.pnlSum >= 0 ? '+' : '') + fmt(s.pnlSum, 4)}</div></div>
      <div class="stat-card"><div class="label">ROI</div><div class="value ${cls(s.roi)}">${pct(s.roi)}</div></div>
      <div class="stat-card"><div class="label">勝率</div><div class="value ${cls(s.winRate - .5)}">${pct(s.winRate)}</div></div>
      <div class="stat-card"><div class="label">對沖比例</div><div class="value">${hedgePct.toFixed(1)}%</div></div>
    </div>
  `;
  tabsContainer.querySelectorAll('.platform-sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedPlatform = btn.dataset.platform;
      renderPlatformStats();
    });
  });
}

/* ================================================================
   Kelly 建議比例
   ================================================================ */
function renderKelly() {
  const kelly = computeKelly(state.records);
  const valEl = $('kellyValue');
  const subEl = $('kellySub');
  if (!kelly) {
    valEl.textContent = '—';
    subEl.textContent = '需有至少 5 筆非對沖已結算紀錄方可計算';
    return;
  }
  valEl.textContent = (kelly.f * 100).toFixed(2) + '% of bankroll';
  subEl.textContent = `依過去 ${kelly.n} 筆非對沖注單估算（勝率 ${(kelly.p * 100).toFixed(1)}%，平均賠率 ${kelly.b.toFixed(2)}x）`;
}

/* ================================================================
   對沖效益分析
   ================================================================ */
function renderHedgeAnalysis() {
  const el = $('hedgeStatsGrid');
  if (!el) return;
  const settled = state.records.filter(isSettled);
  const hedgeBets = settled.filter(r => r.is_hedge === '是');
  const 保住金額 = hedgeBets.reduce((a, r) => a + r.payout, 0);
  const 對沖成本 = hedgeBets.reduce((a, r) => a + r.principal, 0);
  const 淨效益 = 保住金額 - 對沖成本;
  const hedgePnl = hedgeBets.reduce((a, r) => a + r.pnl, 0);
  el.innerHTML = `
    <div class="stat-card"><div class="label">對沖注單數</div><div class="value">${hedgeBets.length}</div></div>
    <div class="stat-card"><div class="label">對沖保住金額</div><div class="value ${cls(保住金額)}">${fmt(保住金額, 4)}</div></div>
    <div class="stat-card"><div class="label">對沖成本</div><div class="value">${fmt(對沖成本, 4)}</div></div>
    <div class="stat-card"><div class="label">淨對沖效益</div><div class="value ${cls(淨效益)}">${(淨效益 >= 0 ? '+' : '') + fmt(淨效益, 4)}</div></div>
    <div class="stat-card"><div class="label">對沖總盈虧</div><div class="value ${cls(hedgePnl)}">${(hedgePnl >= 0 ? '+' : '') + fmt(hedgePnl, 4)}</div></div>
    <div class="stat-card"><div class="label">成本回收率</div><div class="value">${對沖成本 ? ((保住金額 / 對沖成本) * 100).toFixed(1) + '%' : '—'}</div></div>
  `;
}

/* ================================================================
   衍生洞察
   ================================================================ */
function renderInsights() {
  const st = computeStats(state.filtered);
  const rows = [
    ['<i class="fa-solid fa-trophy"></i> 勝 / 平 / 敗（已結算）', `${st.wins} / ${st.draws} / ${st.losses}`, ''],
    ['<i class="fa-solid fa-shield-halved"></i> 對沖單數', `${st.hedgeCount} 筆`, ''],
    ['<i class="fa-solid fa-scale-balanced"></i> 對沖總盈虧', fmt(st.hedgePnl, 4), cls(st.hedgePnl)],
    ['<i class="fa-solid fa-coins"></i> 平均注碼', fmt(st.avgStake), ''],
    ['<i class="fa-solid fa-fire"></i> 最長連敗', `${st.consLoss} 場`, ''],
    ['<i class="fa-solid fa-sack-dollar"></i> 總支付額', fmt(st.totalPayout, 4), ''],
    ['<i class="fa-solid fa-clock"></i> 進行中注單', state.pendingCount, state.pendingCount ? 'neu' : ''],
  ];
  $('insightTable').innerHTML = rows.map(([l, v, c]) =>
    `<tr><td class="ins-label">${l}</td><td class="${c}" style="font-weight:600;font-variant-numeric:tabular-nums">${v}</td></tr>`
  ).join('');
}

/* ================================================================
   匯出 / 匯入
   ================================================================ */
function dl(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('exportJsonBtn').addEventListener('click', () => {
  const data = state.records.map(r => ({ ...r }));
  dl(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `betledger-${Date.now()}.json`);
});

$('exportCsvBtn').addEventListener('click', () => {
  const h = ['id', 'date', 'status', 'is_hedge', 'item', 'platform', 'principal', 'payout', 'pnl', 'roi'];
  const esc = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = [h.join(','), ...state.records.map(r => h.map(k => esc(r[k])).join(','))].join('\n');
  dl(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `betledger-${Date.now()}.csv`);
});

/* 解析匯入檔：支援 CSV 與 JSON（含舊版 { records: [...] } 快取格式） */
function parseImport(text, fileName) {
  if (fileName.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.records)) return parsed.records;
    throw new Error('JSON 格式不符');
  }
  const rows = text.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
  const heads = rows[0].split(',').map(h => h.trim());
  return rows.slice(1).filter(Boolean).map(row => {
    const cols = []; let cur = '', q = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"') { if (q && row[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { cols.push(cur); cur = ''; } else cur += c;
    }
    cols.push(cur);
    const obj = {}; heads.forEach((k, i) => obj[k] = cols[i] ?? '');
    return obj;
  });
}

/* 用於去重：日期＋項目＋平台＋金額等組合簽章 */
function recordSignature(r) {
  return [r.date, r.item, r.platform, r.principal, r.payout, r.is_hedge, r.status].join('|');
}

/* 批次上傳至 Supabase（登入時使用） */
async function pushRecords(records) {
  if (!supabaseClient || !state.user || state.isReadOnly || !records.length) return 0;
  const rows = records.map(r => ({
    user_id: state.user.id,
    date: r.date,
    is_hedge: r.is_hedge === '是',
    item: r.item,
    platform: r.platform,
    principal: r.principal,
    payout: r.status === 'pending' ? 0 : (r.payout || 0),
    pnl: r.status === 'pending' ? 0 : (r.pnl || 0),
    roi: r.status === 'pending' ? 0 : (r.roi || 0),
    status: r.status || 'settled',
  }));
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabaseClient.from('bets').insert(rows.slice(i, i + 50));
    if (error) throw error;
  }
  await fetchSupabaseRecords();
  return rows.length;
}

$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = parseImport(await file.text(), file.name);
    const normalized = data.map(norm);
    const seen = new Set(state.records.map(recordSignature));
    let nextId = genId(state.records);
    const added = [];
    normalized.forEach(r => {
      const sig = recordSignature(r);
      if (seen.has(sig)) return;
      r.id = nextId++;
      seen.add(sig);
      added.push(r);
    });
    if (!added.length) {
      toast(`沒有新增任何紀錄（${normalized.length} 筆皆為重複或空白）`, 'info');
      return;
    }
    state.records.push(...added);
    saveCache();
    refreshPlatformOpts();
    state.animateRows = true;
    applyFilters();
    resetForm();
    if (supabaseClient && state.user && !state.isReadOnly) await pushRecords(added);
    const skipped = normalized.length - added.length;
    toast(`已匯入 ${added.length} 筆${skipped ? `（略過 ${skipped} 筆重複）` : ''}`, 'success');
  } catch (err) {
    console.error(err);
    toast('匯入失敗，請確認格式正確', 'error');
  } finally {
    e.target.value = '';
  }
});

['addRecordBtn', 'fabAdd'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('click', () => { if (!state.isReadOnly) fillForm(null); });
});
$('resetSeedBtn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: '清除所有本地資料',
    message: '確定清除所有本地資料？此操作無法還原。',
    confirmText: '清除',
    danger: true,
  });
  if (!ok) return;
  state.records = [];
  saveCache();
  refreshPlatformOpts();
  state.animateRows = true;
  applyFilters();
  resetForm();
  toast('已清除所有本地資料', 'success');
});

['filterPlatform', 'filterHedge', 'filterOutcome', 'filterStatus', 'searchInput'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', applyFilters);
});

/* ================================================================
   分享功能
   ================================================================ */
if ($('shareBtn')) $('shareBtn').addEventListener('click', () => {
  const m = $('shareModal'), g = $('shareGenerated');
  if (m) m.classList.add('show');
  if (g) g.style.display = 'none';
});
if ($('closeShareModal')) $('closeShareModal').addEventListener('click', () => {
  const m = $('shareModal');
  if (m) m.classList.remove('show');
});
if ($('shareModal')) $('shareModal').addEventListener('click', e => {
  const m = $('shareModal');
  if (e.target === m && m) m.classList.remove('show');
});

if ($('generateShareBtn')) $('generateShareBtn').addEventListener('click', async () => {
  if (!supabaseClient || !state.user) {
    toast('請先登入才能分享', 'error');
    return;
  }
  const expiration = $('shareExpiration')?.value;
  let expiresAt = null;
  if (expiration) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiration));
    expiresAt = d.toISOString();
  }
  try {
    const { data, error } = await supabaseClient.from('shares').insert({
      user_id: state.user.id,
      expires_at: expiresAt,
    }).select('token').single();
    if (error) throw error;
    const shareUrl = location.origin + location.pathname + '?share=' + data.token;
    const lt = $('shareLinkText'), sg = $('shareGenerated');
    if (lt) lt.textContent = shareUrl;
    if (sg) sg.style.display = '';
  } catch (e) {
    toast('產生分享連結失敗：' + e.message, 'error');
  }
});

if ($('copyShareLink')) $('copyShareLink').addEventListener('click', () => {
  const text = $('shareLinkText')?.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const c = $('copyShareLink');
    if (c) c.innerHTML = '<i class="fa-solid fa-check"></i> 已複製';
    setTimeout(() => { if (c) c.innerHTML = '<i class="fa-solid fa-copy"></i> 複製'; }, 2000);
  });
});

/* ================================================================
   鍵盤快捷鍵
   ================================================================ */
document.addEventListener('keydown', e => {
  const confirmOpen = $('confirmModal')?.classList.contains('show');
  if (confirmOpen) {
    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
    return;
  }
  const drawerOpen = $('recordDrawer')?.classList.contains('show');
  /* Ctrl/Cmd + Enter：儲存表單 */
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (drawerOpen) {
      e.preventDefault();
      $('recordForm').requestSubmit();
    }
    return;
  }
  /* Esc：關閉抽屜或分享視窗 */
  if (e.key === 'Escape') {
    if (drawerOpen) { e.preventDefault(); resetForm(); return; }
    const sm = $('shareModal');
    if (sm && sm.classList.contains('show')) { sm.classList.remove('show'); return; }
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const shareModal = $('shareModal');
  if (shareModal && shareModal.classList.contains('show')) return;
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    if (!state.isReadOnly) fillForm(null);
  }
  if (e.key === '/') {
    e.preventDefault();
    const si = $('searchInput');
    if (si) si.focus();
  }
});

/* ================================================================
   Auth 事件綁定
   ================================================================ */
if ($('loginBtn')) $('loginBtn').addEventListener('click', handleLogin);
if ($('logoutBtn')) $('logoutBtn').addEventListener('click', handleLogout);

/* ================================================================
   初始化
   ================================================================ */
(async function init() {
  const cached = loadCache();
  state.records = cached.records.map(norm);
  state.lastUpdated = cached.lastUpdated;
  if ($('cacheStatus')) $('cacheStatus').textContent = storageOk() ? 'localStorage 持久' : '記憶體暫存';
  if ($('lastUpdated')) $('lastUpdated').textContent = state.lastUpdated || '—';
  await initSupabase();
  if (!state.isReadOnly) {
    refreshPlatformOpts();
    restoreFilters();
    buildColMenu();
    resetForm();
    state.animateRows = true;
    applyFilters();
    initDragGrid($('recordsDragGrid'));
    initDragGrid($('analyticsDragGrid'));
  }
})();
