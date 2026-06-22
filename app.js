/* ================================================================
   SUPABASE 設定 — 請填入你的 Supabase 專案 URL 與 Anon Key
   ================================================================ */
const SUPABASE_URL = 'https://vgqoidbtynvpfiwmzdlc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncW9pZGJ0eW52cGZpd216ZGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDIxNjksImV4cCI6MjA5NzcxODE2OX0.oLWbLTuEAHjtM-ar0PR8UrTaC1tQv4qVHB6isH_SMfc';

/* ================================================================
   PWA manifest 動態注入
   ================================================================ */
(function(){
  const manifest={
    name:'⚽ 投注追蹤',
    short_name:'投注追蹤',
    description:'世界盃投注追蹤計算機',
    start_url:'.',
    display:'standalone',
    background_color:'#0f172a',
    theme_color:'#0f172a',
    icons:[{src:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='48' fill='%2301696f'/%3E%3Ctext x='50' y='68' text-anchor='middle' font-size='52' fill='white'%3E⚽%3C/text%3E%3C/svg%3E",sizes:'512x512',type:'image/svg+xml'}]
  };
  const blob=new Blob([JSON.stringify(manifest)],{type:'application/json'});
  const link=document.createElement('link');
  link.rel='manifest';
  link.href=URL.createObjectURL(blob);
  document.head.appendChild(link);
})();

/* ================================================================
   狀態與工具函式
   ================================================================ */
const SEED = [];
const SK = 'brd-v3';
const state = {
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
};
const $ = id => document.getElementById(id);

/* ================================================================
   主題切換（data-theme 已在 HTML head 中初始化防止閃爍）
   ================================================================ */
(function(){
  const root=document.documentElement;
  let mode=root.getAttribute('data-theme')||'light';
  const btn=$('themeBtn');
  const paint=()=>{btn.innerHTML=mode==='dark'?'<i class="fa-solid fa-sun"></i>':'<i class="fa-solid fa-moon"></i>';};
  paint();
  btn.addEventListener('click',()=>{
    mode=mode==='dark'?'light':'dark';
    root.setAttribute('data-theme',mode);
    localStorage.setItem('theme',mode);
    paint();
    setTimeout(renderCharts,80);
  });
})();

/* ================================================================
   localStorage 快取
   ================================================================ */
function storageOk(){
  try{localStorage.setItem('__t','1');localStorage.removeItem('__t');return true;}
  catch{return false;}
}
function saveCache(){
  state.lastUpdated=new Date().toLocaleString('zh-TW');
  const p=JSON.stringify({records:state.records,lastUpdated:state.lastUpdated});
  if(storageOk()){localStorage.setItem(SK,p);state.cacheMode='localStorage';}
  else{state._mem=p;state.cacheMode='memory';}
  $('cacheStatus').textContent=state.cacheMode==='localStorage'?'localStorage 持久':'記憶體暫存';
  $('lastUpdated').textContent=state.lastUpdated;
}
function loadCache(){
  try{if(storageOk()){const r=localStorage.getItem(SK);if(r)return JSON.parse(r);}}catch{}
  if(state._mem){try{return JSON.parse(state._mem);}catch{}}
  return{records:JSON.parse(JSON.stringify(SEED)),lastUpdated:new Date().toLocaleString('zh-TW')};
}

/* ================================================================
   工具函式
   ================================================================ */
function fmt(v,d=2){return Number(v||0).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});}
function pct(v){return(Number(v||0)*100).toFixed(2)+'%';}
function cls(v){return v>0?'pos':v<0?'neg':'neu';}
function outcome(r){
  if(r.status==='pending')return 'pending';
  return r.pnl>0?'win':r.pnl<0?'loss':'draw';
}
function escH(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function genId(){return state.records.reduce((m,r)=>Math.max(m,+r.id||0),0)+1;}
function norm(r,i){
  return{
    id:+(r.id||i+1),
    date:String(r.date||r['比賽時間']||new Date().toISOString().slice(0,10)).slice(0,10),
    is_hedge:r.is_hedge||r['是否為對沖單']||'否',
    item:r.item||r['項目']||'',
    platform:r.platform||r['平台']||'',
    principal:+(r.principal||r['本金']||0),
    payout:+(r.payout||r['支付額']||0),
    pnl:+(r.pnl||r['盈虧']||0),
    roi:+(r.roi||r['ROI']||0),
    status:r.status||'settled',
  };
}
function cssVar(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function isSettled(r){return r.status==='settled';}

/* ================================================================
   Supabase 初始化與 Auth
   ================================================================ */
let supabaseClient = null;
let realtimeChannel = null;
let offlineQueue = [];

/* 手動從 URL hash 取出 OAuth token，避免 SDK 非同步初始化未完成 */
function getTokensFromHash(){
  const h = window.location.hash;
  if(!h || !h.includes('access_token')) return null;
  const p = new URLSearchParams(h.replace('#',''));
  const at = p.get('access_token');
  const rt = p.get('refresh_token');
  return at ? { access_token: at, refresh_token: rt || '' } : null;
}

async function initSupabase(){
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY){
    console.warn('Supabase 未設定，僅使用本地模式');
    return;
  }
  try{
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    state.supabase = supabaseClient;
    supabaseClient.auth.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      if(user && !state.user) state.user = user;
      updateAuthUI();
      if(user){
        setupRealtime();
        processOfflineQueue();
        checkShareMode();
      } else if(state.user) {
        state.user = null;
        updateAuthUI();
        unsubscribeRealtime();
      }
    });
    // 1️. 優先處理 OAuth redirect URL hash（手動取出 token）
    const tokens = getTokensFromHash();
    if(tokens){
      const { data, error } = await supabaseClient.auth.setSession(tokens);
      if(!error && data?.user){
        state.user = data.user;
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
        updateAuthUI();
        setupRealtime();
        processOfflineQueue();
        checkShareMode();
        return;
      }
    }
    // 2️. 從 localStorage 還原 session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if(session?.user){
      state.user = session.user;
      updateAuthUI();
      setupRealtime();
      processOfflineQueue();
      checkShareMode();
      return;
    }
    // 3️. 最後嘗試由伺服器驗證 token
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if(user){
        state.user = user;
        updateAuthUI();
        setupRealtime();
        processOfflineQueue();
        checkShareMode();
      }
    } catch(e) {
      /* 無網路時靜默失敗，維持本地模式 */
    }
  } catch(e){
    console.warn('Supabase 初始化失敗，僅使用本地模式', e);
  }
}

function checkShareMode(){
  const params = new URLSearchParams(location.search);
  const token = params.get('share');
  if(!token) return;
  state.isReadOnly = true;
  document.querySelectorAll('.btn-danger, #newRecordBtn, #deleteBtn, .icon-btn[data-del], .icon-btn[data-edit]').forEach(el => {
    if(el) el.style.display = 'none';
  });
  const loginBtn = $('#loginBtn');
  if(loginBtn) loginBtn.textContent = '唯讀檢視模式';
  if(supabaseClient){
    loadSharedData(token);
  }
}

async function loadSharedData(token){
  try{
    const { data: shares, error: shareErr } = await supabaseClient
      .from('shares')
      .select('user_id, expires_at')
      .eq('token', token)
      .maybeSingle();
    if(shareErr || !shares) {
      console.warn('分享連結無效');
      return;
    }
    if(shares.expires_at && new Date(shares.expires_at) < new Date()){
      alert('此分享連結已過期');
      return;
    }
    const { data: bets, error: betsErr } = await supabaseClient
      .from('bets')
      .select('*')
      .eq('user_id', shares.user_id)
      .order('date', { ascending: true });
    if(betsErr) throw betsErr;
    if(bets) {
      state.records = bets.map(norm);
      saveCache();
      applyFilters();
    }
  } catch(e){
    console.warn('載入分享資料失敗', e);
  }
}

function updateAuthUI(){
  const loginBtn = $('#loginBtn');
  const userInfo = $('#userInfo');
  const shareBtn = $('#shareBtn');
  if(state.user){
    loginBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    $('#userAvatar').src = state.user.user_metadata?.avatar_url || '';
    $('#userEmail').textContent = state.user.email || '';
    shareBtn.style.display = '';
    $('syncStatus').textContent = '已同步雲端';
    if(state.records.length > 0 && !localStorage.getItem('migrated_'+state.user.id)){
      promptMigration();
    }
  } else {
    loginBtn.style.display = '';
    userInfo.style.display = 'none';
    shareBtn.style.display = 'none';
    $('syncStatus').textContent = '本地模式';
  }
}

async function promptMigration(){
  if(state.records.length === 0) return;
  const confirmed = confirm(`偵測到 ${state.records.length} 筆本地資料，是否遷移至雲端？\n（遷移後仍可透過匯出備份）`);
  if(confirmed){
    await migrateLocalData();
  }
}

async function migrateLocalData(){
  if(!supabaseClient || !state.user || state.records.length === 0) return;
  try{
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
    for(let i=0; i<recordsToInsert.length; i+=batchSize){
      const batch = recordsToInsert.slice(i, i+batchSize);
      const { error } = await supabaseClient.from('bets').insert(batch);
      if(error) throw error;
    }
    localStorage.setItem('migrated_'+state.user.id, '1');
    await fetchSupabaseRecords();
  } catch(e){
    console.error('遷移失敗', e);
    alert('遷移失敗：'+e.message);
  }
}

async function fetchSupabaseRecords(){
  if(!supabaseClient || !state.user) return;
  try{
    const { data, error } = await supabaseClient
      .from('bets')
      .select('*')
      .eq('user_id', state.user.id)
      .order('id', { ascending: false });
    if(error) throw error;
    if(data){
      state.records = data.map(norm);
      saveCache();
      applyFilters();
    }
  } catch(e){
    console.error('讀取雲端資料失敗', e);
  }
}

async function handleLogin(){
  if(!supabaseClient) return;
  try{
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname }
    });
    if(error) throw error;
  } catch(e){
    console.error('登入失敗', e);
  }
}

async function handleLogout(){
  if(!supabaseClient) return;
  try{
    await supabaseClient.auth.signOut();
    state.user = null;
    updateAuthUI();
    unsubscribeRealtime();
    const cached = loadCache();
    state.records = cached.records.map(norm);
    applyFilters();
  } catch(e){
    console.error('登出失敗', e);
  }
}

/* ================================================================
   Supabase Realtime 訂閱
   ================================================================ */
function setupRealtime(){
  if(!supabaseClient || !state.user) return;
  unsubscribeRealtime();
  realtimeChannel = supabaseClient.channel('bets_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'bets', filter: `user_id=eq.${state.user.id}` },
      payload => { fetchSupabaseRecords(); }
    )
    .subscribe();
}

function unsubscribeRealtime(){
  if(realtimeChannel){
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

/* ================================================================
   Supabase CRUD 同步與離線佇列
   ================================================================ */
function isOffline(){ return !navigator.onLine; }

function addToOfflineQueue(operation){
  offlineQueue.push(operation);
  try{ localStorage.setItem('offlineQueue_'+ (state.user?.id||'anon'), JSON.stringify(offlineQueue)); }catch{}
}

async function processOfflineQueue(){
  if(!supabaseClient || !state.user) return;
  const key = 'offlineQueue_'+state.user.id;
  try{
    const q = localStorage.getItem(key);
    if(q) offlineQueue = JSON.parse(q);
  } catch{ offlineQueue = []; }
  if(offlineQueue.length === 0) return;
  const remaining = [];
  for(const op of offlineQueue){
    try{ await executeSyncOp(op); } catch(e){ remaining.push(op); }
  }
  offlineQueue = remaining;
  try{ localStorage.setItem(key, JSON.stringify(offlineQueue)); }catch{}
}

async function executeSyncOp(op){
  if(!supabaseClient || !state.user) return;
  const { action, record } = op;
  const base = {
    user_id: state.user.id,
    date: record.date,
    is_hedge: record.is_hedge === '是',
    item: record.item,
    platform: record.platform,
    principal: record.principal,
    payout: record.status === 'pending' ? 0 : (record.payout||0),
    pnl: record.status === 'pending' ? 0 : (record.pnl||0),
    roi: record.status === 'pending' ? 0 : (record.roi||0),
    status: record.status || 'settled',
  };
  if(action === 'insert'){
    const { error } = await supabaseClient.from('bets').insert(base);
    if(error) throw error;
  } else if(action === 'update'){
    const { error } = await supabaseClient.from('bets').update(base).eq('id', record.supabaseId||record.id);
    if(error) throw error;
  } else if(action === 'delete'){
    const { error } = await supabaseClient.from('bets').delete().eq('id', record.supabaseId||record.id);
    if(error) throw error;
  }
}

async function syncToSupabase(action, record){
  if(!supabaseClient || !state.user || state.isReadOnly) return;
  if(isOffline()){
    addToOfflineQueue({action, record});
    return;
  }
  try{
    await executeSyncOp({action, record});
    await fetchSupabaseRecords();
  } catch(e){
    console.warn('同步失敗，加入離線佇列', e);
    addToOfflineQueue({action, record});
  }
}

/* ================================================================
   PWA Service Worker 動態註冊
   ================================================================ */
(function(){
  if('serviceWorker' in navigator){
    const swCode = `
      const CACHE = 'bets-v2';
      const SUPA_HOST = '${SUPABASE_URL.replace('https://','').split('.')[0]}.supabase.co';
      self.addEventListener('install', e => { self.skipWaiting(); });
      self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
      self.addEventListener('fetch', e => {
        const url = new URL(e.request.url);
        if(url.hostname === SUPA_HOST || url.hostname.includes('supabase')){
          e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
        } else {
          e.respondWith(
            caches.open(CACHE).then(cache =>
              cache.match(e.request).then(cached => {
                const fetchPromise = fetch(e.request).then(res => {
                  if(res.ok) cache.put(e.request, res.clone());
                  return res;
                }).catch(() => cached);
                return cached || fetchPromise;
              })
            )
          );
        }
      });
    `;
    try{
      const swBlob = new Blob([swCode], {type: 'application/javascript'});
      const swUrl = URL.createObjectURL(swBlob);
      navigator.serviceWorker.register(swUrl).catch(()=>{});
    } catch(e){}
  }
})();

/* ================================================================
   離線偵測
   ================================================================ */
window.addEventListener('online', ()=>{
  state.isOnline = true;
  $('#offlineBanner').classList.remove('show');
  processOfflineQueue();
  if(state.user) fetchSupabaseRecords();
});
window.addEventListener('offline', ()=>{
  state.isOnline = false;
  $('#offlineBanner').classList.add('show');
});

/* ================================================================
   表單操作
   ================================================================ */
function fillForm(r){
  state.editingId = r?.id ?? null;
  $('recordId').value = r?.id ?? '';
  $('fDate').value = r?.date ?? new Date().toISOString().slice(0,10);
  $('fStatus').value = r?.status ?? 'settled';
  $('fHedge').value = r?.is_hedge ?? '否';
  $('fItem').value = r?.item ?? '';
  $('fPlatform').value = r?.platform ?? '';
  $('fPrincipal').value = r?.principal ?? '';
  $('fPayout').value = r?.payout ?? '';
  if(r?.status === 'pending'){
    $('fPayout').value = '0';
    $('fPnl').value = '0';
    $('fRoi').value = '0';
  } else {
    $('fPnl').value = r?.pnl ?? '';
    $('fRoi').value = r?.roi ?? '';
  }
  $('deleteBtn').disabled = !r;
  $('saveBtn').innerHTML = r ? '<i class="fa-solid fa-floppy-disk"></i> 更新紀錄' : '<i class="fa-solid fa-floppy-disk"></i> 儲存紀錄';
  $('formTitle').textContent = r ? `編輯紀錄 #${r.id}` : '新增紀錄';
  $('formSection').style.display = '';
}

function resetForm(){ fillForm(null); $('formSection').style.display='none'; }

function recalcDerived(){
  const p = +($('fPrincipal').value||0);
  const pay = $('fStatus').value === 'pending' ? 0 : +($('fPayout').value||0);
  $('fPnl').value = +(pay-p).toFixed(6);
  $('fRoi').value = p ? +((pay-p)/p).toFixed(6) : 0;
}

function applyTemplate(type){
  const itemField = $('fItem');
  const hedgeField = $('fHedge');
  if(type === 'parlay'){
    itemField.value = '【A】+【B】@odds';
    itemField.focus();
  } else if(type === 'hedge'){
    hedgeField.value = '是';
  } else if(type === 'overunder'){
    itemField.value = '【隊A vs 隊B：大於/小於X.X】';
    itemField.focus();
  }
}

$('recordForm').addEventListener('submit', e => {
  e.preventDefault();
  if(state.isReadOnly) return;
  const id = +($('recordId').value||0);
  const p = +($('fPrincipal').value||0);
  const isPending = $('fStatus').value === 'pending';
  const pay = isPending ? 0 : +($('fPayout').value||0);
  const pnlV = isPending ? 0 : ($('fPnl').value==='' ? pay-p : +$('fPnl').value);
  const roiV = isPending ? 0 : ($('fRoi').value==='' ? (p?pnlV/p:0) : +$('fRoi').value);
  const record = {
    id: id || genId(),
    date: $('fDate').value,
    status: $('fStatus').value,
    is_hedge: $('fHedge').value,
    item: $('fItem').value.trim(),
    platform: $('fPlatform').value.trim(),
    principal: p,
    payout: pay,
    pnl: +pnlV.toFixed(6),
    roi: +roiV.toFixed(6),
  };
  if(!record.item || !record.platform || !record.date) return;
  const idx = state.records.findIndex(r => r.id === record.id);
  if(idx >= 0){
    state.records[idx] = record;
    if(supabaseClient && state.user) syncToSupabase('update', record);
  } else {
    state.records.push(record);
    if(supabaseClient && state.user) syncToSupabase('insert', record);
  }
  saveCache();
  refreshPlatformOpts();
  applyFilters();
  fillForm(record);
});

$('clearBtn').addEventListener('click', resetForm);
$('deleteBtn').addEventListener('click', () => {
  if(!state.editingId || state.isReadOnly) return;
  const rec = state.records.find(r => r.id === state.editingId);
  state.records = state.records.filter(r => r.id !== state.editingId);
  if(supabaseClient && state.user && rec) syncToSupabase('delete', rec);
  saveCache();
  refreshPlatformOpts();
  applyFilters();
  resetForm();
});
$('closeFormBtn').addEventListener('click', resetForm);
['fPrincipal','fPayout','fStatus'].forEach(id => $(id).addEventListener('input', recalcDerived));

document.querySelectorAll('[data-template]').forEach(btn => {
  btn.addEventListener('click', () => applyTemplate(btn.dataset.template));
});

/* ================================================================
   分頁切換
   ================================================================ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active'); b.setAttribute('aria-selected','false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active'); btn.setAttribute('aria-selected','true');
    $('tab-'+btn.dataset.tab).classList.add('active');
    setTimeout(renderCharts, 40);
  });
});

/* ================================================================
   拖曳排序
   ================================================================ */
function initDragGrid(gridEl){
  if(!gridEl) return;
  let srcEl = null;
  gridEl.querySelectorAll('.drag-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      srcEl = item; item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.dragId||'');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      gridEl.querySelectorAll('.drag-item').forEach(i => i.classList.remove('drag-over'));
      srcEl = null; setTimeout(renderCharts, 60);
    });
    item.addEventListener('dragover', e => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      if(srcEl && srcEl !== item) item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('drag-over');
      if(!srcEl || srcEl === item) return;
      const items = [...gridEl.querySelectorAll('.drag-item')];
      const srcIdx = items.indexOf(srcEl), dstIdx = items.indexOf(item);
      if(srcIdx < dstIdx) item.after(srcEl); else item.before(srcEl);
    });
  });
}

/* ================================================================
   篩選與搜尋
   ================================================================ */
function refreshPlatformOpts(){
  const cur = $('filterPlatform').value;
  const platforms = [...new Set(state.records.map(r => r.platform).filter(Boolean))].sort();
  $('filterPlatform').innerHTML = '<option value="">全部</option>' +
    platforms.map(p => `<option>${escH(p)}</option>`).join('');
  $('filterPlatform').value = platforms.includes(cur) ? cur : '';
}

function applyFilters(){
  const pl = $('filterPlatform').value;
  const hd = $('filterHedge').value;
  const oc = $('filterOutcome').value;
  const st = $('filterStatus').value;
  const q = $('searchInput').value.trim().toLowerCase();
  state.filtered = state.records
    .filter(r => !pl || r.platform === pl)
    .filter(r => !hd || r.is_hedge === hd)
    .filter(r => !oc || outcome(r) === oc)
    .filter(r => !st || r.status === st)
    .filter(r => !q || [r.item, r.platform, r.date].join(' ').toLowerCase().includes(q))
    .sort((a,b) => a.date<b.date ? -1 : a.date>b.date ? 1 : a.id-b.id);
  state.pendingCount = state.records.filter(r => r.status === 'pending').length;
  renderTable();
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
function renderTable(){
  const tbody = $('recordsTbody');
  tbody.innerHTML = '';
  $('recordCount').textContent = state.filtered.length;
  $('emptyState').classList.toggle('show', !state.filtered.length);
  state.filtered.forEach(r => {
    const isPend = r.status === 'pending';
    const tr = document.createElement('tr');
    if(isPend) tr.className = 'row-pending';
    tr.innerHTML = `
      <td><span class="inline-edit" data-field="date" data-id="${r.id}">${escH(r.date)}</span></td>
      <td><span class="chip ${r.is_hedge==='是'?'chip-hedge':'chip-normal'}"><i class="fa-solid ${r.is_hedge==='是'?'fa-shield-halved':'fa-circle-check'}"></i>${r.is_hedge==='是'?'對沖':'一般'}</span></td>
      <td><span class="chip ${isPend?'chip-pending':'chip-normal'}">${isPend?'進行中':'已結算'}</span></td>
      <td class="col-item" title="${escH(r.item)}"><span class="inline-edit" data-field="item" data-id="${r.id}">${escH(r.item)}</span></td>
      <td><span class="inline-edit" data-field="platform" data-id="${r.id}">${escH(r.platform)}</span></td>
      <td><span class="inline-edit" data-field="principal" data-id="${r.id}">${fmt(r.principal)}</span></td>
      <td>${isPend ? '<span class="pnl-pending">待結算</span>' : `<span class="inline-edit" data-field="payout" data-id="${r.id}">${fmt(r.payout,4)}</span>`}</td>
      <td class="${isPend ? '' : cls(r.pnl)}">${isPend ? '<span class="pnl-pending">待結算</span>' : fmt(r.pnl,4)}</td>
      <td class="${isPend ? '' : cls(r.roi)}">${isPend ? '<span class="pnl-pending">—</span>' : pct(r.roi)}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${r.id}" title="編輯"><i class="fa-solid fa-pen"></i></button>
        ${isPend ? `<button class="icon-btn" data-settle="${r.id}" title="結算"><i class="fa-solid fa-check"></i></button>` : ''}
        <button class="icon-btn" data-del="${r.id}" title="刪除"><i class="fa-solid fa-trash-can"></i></button>
      </div></td>`;
    tbody.appendChild(tr);
  });
  setupInlineEditEvents(tbody);
}

function setupInlineEditEvents(tbody){
  tbody.querySelectorAll('.inline-edit').forEach(el => {
    el.addEventListener('click', function(e){
      if(state.isReadOnly) return;
      if(this.tagName === 'INPUT' || this.tagName === 'SELECT') return;
      const field = this.dataset.field;
      const id = +this.dataset.id;
      let current = this.textContent.trim();
      if(field === 'principal') current = state.records.find(r=>r.id===id)?.principal || '0';
      if(field === 'payout') current = state.records.find(r=>r.id===id)?.payout || '0';
      if(field==='platform'){
        const sel = document.createElement('select');
        sel.className = 'inline-edit';
        const platforms = [...new Set(state.records.map(r=>r.platform).filter(Boolean)), 'Stake', 'MEXC'];
        [...new Set(platforms)].forEach(p => {
          const opt = document.createElement('option');
          opt.value = p; opt.textContent = p;
          if(p === current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function(){
          const rec = state.records.find(r=>r.id===id);
          if(rec){ rec.platform = this.value; saveCache(); syncToSupabase('update', rec); applyFilters(); }
        });
        sel.addEventListener('blur', () => sel.remove());
        sel.addEventListener('keydown', e => { if(e.key==='Escape') sel.remove(); });
        this.replaceWith(sel);
        sel.focus();
        return;
      }
      const input = document.createElement('input');
      input.className = 'inline-edit';
      input.type = field==='date'?'date':field==='principal'||field==='payout'?'number':'text';
      if(field==='principal'||field==='payout'){ input.step = '0.0001'; input.min = '0'; }
      if(field==='date') input.value = this.textContent.trim() || new Date().toISOString().slice(0,10);
      else input.value = current;
      input.addEventListener('keydown', e => {
        if(e.key === 'Enter'){
          const rec = state.records.find(r=>r.id===id);
          if(rec && input.value !== undefined){
            let val = input.value;
            if(field === 'principal' || field === 'payout') val = +val;
            rec[field] = val;
            if(field === 'payout' && rec.status === 'pending'){
              rec.status = 'settled';
              rec.pnl = rec.payout - rec.principal;
              rec.roi = rec.principal ? rec.pnl/rec.principal : 0;
            } else if(field === 'payout' || field === 'principal'){
              rec.pnl = rec.payout - rec.principal;
              rec.roi = rec.principal ? rec.pnl/rec.principal : 0;
            }
            saveCache();
            syncToSupabase('update', rec);
            applyFilters();
          }
        } else if(e.key === 'Escape'){
          applyFilters();
        }
      });
      input.addEventListener('blur', () => applyFilters());
      this.replaceWith(input);
      input.focus();
    });
  });
}

$('recordsTbody').addEventListener('click', e => {
  const editId = e.target.closest('[data-edit]')?.dataset.edit;
  const delId = e.target.closest('[data-del]')?.dataset.del;
  const settleId = e.target.closest('[data-settle]')?.dataset.settle;
  if(editId){
    const r = state.records.find(r => r.id === +editId);
    fillForm(r);
  }
  if(delId && !state.isReadOnly){
    const rec = state.records.find(r => r.id === +delId);
    state.records = state.records.filter(r => r.id !== +delId);
    if(supabaseClient && state.user && rec) syncToSupabase('delete', rec);
    saveCache();
    refreshPlatformOpts();
    applyFilters();
    if(state.editingId === +delId) resetForm();
  }
  if(settleId){
    const r = state.records.find(r => r.id === +settleId);
    if(r && r.status === 'pending'){
      fillForm(r);
      $('fPayout').focus();
    }
  }
});

/* ================================================================
   KPI 渲染
   ================================================================ */
function computeStats(records){
  const settled = records.filter(isSettled);
  const stake = settled.reduce((a,r) => a+r.principal, 0);
  const pnlSum = settled.reduce((a,r) => a+r.pnl, 0);
  const wins = settled.filter(r => r.pnl>0);
  const draws = settled.filter(r => r.pnl===0);
  const losses = settled.filter(r => r.pnl<0);
  const roi = stake ? pnlSum/stake : 0;
  const winRate = settled.length ? wins.length/settled.length : 0;
  const nh = settled.filter(r => r.is_hedge==='否');
  const nhS = nh.reduce((a,r) => a+r.principal,0);
  const nhP = nh.reduce((a,r) => a+r.pnl,0);
  const nhRoi = nhS ? nhP/nhS : 0;
  const avgOdds = wins.length ? wins.reduce((a,r) => a+(r.principal?r.payout/r.principal:0),0)/wins.length : 0;
  const maxLoss = losses.length ? Math.min(...losses.map(r => r.pnl)) : 0;
  const avgStake = settled.length ? stake/settled.length : 0;
  const totalPayout = settled.reduce((a,r) => a+r.payout, 0);
  const hedgeCount = settled.filter(r => r.is_hedge==='是').length;
  const hedgePnl = settled.filter(r => r.is_hedge==='是').reduce((a,r) => a+r.pnl, 0);
  const consLoss = (() => {
    let mx=0, cur=0;
    [...settled].sort((a,b) => a.date<b.date?-1:1).forEach(r => {
      if(r.pnl<0){ cur++; mx=Math.max(mx,cur); } else cur=0;
    });
    return mx;
  })();
  const avgWin = wins.length ? wins.reduce((a,r) => a+r.pnl,0)/wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a,r) => a+r.pnl,0)/losses.length : 0;
  const rr = avgLoss ? Math.abs(avgWin/avgLoss) : 0;
  const pf = losses.length ? Math.abs(wins.reduce((a,r) => a+r.pnl,0)/losses.reduce((a,r) => a+r.pnl,0)) : Infinity;
  const allStake = records.reduce((a,r) => a+r.principal, 0);
  const allPnl = records.reduce((a,r) => a+r.pnl, 0);
  return { stake, pnlSum, wins: wins.length, draws: draws.length, losses: losses.length,
    roi, winRate, nhRoi, avgOdds, maxLoss, avgStake, totalPayout, hedgeCount, hedgePnl,
    consLoss, avgWin, avgLoss, rr, pf, nhP, nhS, settledCount: settled.length, allStake, allPnl };
}

function renderKPIs(){
  const st = computeStats(state.filtered);
  const set = (id, val, c) => { const el=$(id); el.textContent=val; el.className='kpi-value'+(c?' '+c:''); };
  set('kpiStake', fmt(st.stake));
  set('kpiPnl', (st.pnlSum>=0?'+':'')+fmt(st.pnlSum,4), cls(st.pnlSum));
  set('kpiRoi', pct(st.roi), cls(st.roi));
  set('kpiWinRate', pct(st.winRate), cls(st.winRate-.5));
  set('kpiNHRoi', pct(st.nhRoi), cls(st.nhRoi));
  set('kpiAvgOdds', fmt(st.avgOdds,2)+'x');
  set('kpiMaxLoss', fmt(st.maxLoss,4), 'neg');
  set('kpiPending', state.pendingCount, state.pendingCount ? 'neu' : '');
}

/* ================================================================
   深入統計
   ================================================================ */
function renderStatsGrid(){
  const st = computeStats(state.filtered);
  const cards = [
    { label: '非對沖本金', value: fmt(st.nhS), sub: '', c: '' },
    { label: '非對沖盈虧', value: (st.nhP>=0?'+':'')+fmt(st.nhP,4), sub: '', c: cls(st.nhP) },
    { label: '平均獲利', value: (st.avgWin>=0?'+':'')+fmt(st.avgWin,4), sub: '贏單平均', c: cls(st.avgWin) },
    { label: '平均虧損', value: fmt(st.avgLoss,4), sub: '輸單平均', c: cls(st.avgLoss) },
    { label: '賺賠比 R:R', value: fmt(st.rr,2), sub: '平均獲利÷平均虧損', c: cls(st.rr-1) },
    { label: '獲利因子', value: isFinite(st.pf)?fmt(st.pf,2):'∞', sub: '總獲利÷總虧損', c: cls(st.pf-1) },
  ];
  $('statsGrid').innerHTML = cards.map(c =>
    `<div class="stat-card"><div class="label">${c.label}</div><div class="value ${c.c}" style="font-variant-numeric:tabular-nums">${c.value}</div><div style="font-size:var(--text-xs);color:var(--faint);margin-top:2px">${c.sub}</div></div>`
  ).join('');
}

/* ================================================================
   平台分頁統計
   ================================================================ */
function computePlatformStats(){
  const settled = state.records.filter(isSettled);
  const platforms = [...new Set(settled.map(r => r.platform).filter(Boolean))].sort();
  const allStats = computeStats(state.records);
  const result = { '': { ...allStats, name: '全部', count: settled.length } };
  platforms.forEach(p => {
    const recs = settled.filter(r => r.platform === p);
    const s = computeStats(recs);
    result[p] = { ...s, name: p, count: recs.length };
  });
  state.platformStats = result;
  return result;
}

function renderPlatformStats(){
  const stats = computePlatformStats();
  const tabsContainer = $('#platformTabs');
  const content = $('#platformStatsContent');
  const platforms = Object.keys(stats);
  tabsContainer.innerHTML = platforms.map(p => {
    const name = p === '' ? '全部' : stats[p].name;
    const count = stats[p].count;
    return `<button class="platform-sub-tab ${p===state.selectedPlatform?'active':''}" data-platform="${escH(p)}">${escH(name)} (${count})</button>`;
  }).join('');
  const sel = stats[state.selectedPlatform] || stats[''];
  const s = sel;
  const hedgeCount = state.records.filter(isSettled).filter(r => r.is_hedge==='是' && (state.selectedPlatform===''||r.platform===state.selectedPlatform)).length;
  const hedgePct = s.count ? hedgeCount / s.count * 100 : 0;
  content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">注單數</div><div class="value">${s.count}</div></div>
      <div class="stat-card"><div class="label">總本金</div><div class="value">${fmt(s.stake)}</div></div>
      <div class="stat-card"><div class="label">總盈虧</div><div class="value ${cls(s.pnlSum)}">${(s.pnlSum>=0?'+':'')+fmt(s.pnlSum,4)}</div></div>
      <div class="stat-card"><div class="label">ROI</div><div class="value ${cls(s.roi)}">${pct(s.roi)}</div></div>
      <div class="stat-card"><div class="label">勝率</div><div class="value ${cls(s.winRate-.5)}">${pct(s.winRate)}</div></div>
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
function computeKelly(){
  const nh = state.records.filter(r => isSettled(r) && r.is_hedge === '否');
  if(nh.length < 5) return null;
  const wins = nh.filter(r => r.pnl > 0);
  const p = wins.length / nh.length;
  const avgOdds = wins.length
    ? wins.reduce((a,r) => a + (r.principal ? r.payout/r.principal : 0), 0) / wins.length
    : 0;
  const b = avgOdds - 1;
  if(b <= 0) return null;
  const q = 1 - p;
  const f = (b * p - q) / b;
  return { f: Math.max(0, f), p, b, n: nh.length };
}

function renderKelly(){
  const kelly = computeKelly();
  const valEl = $('#kellyValue');
  const subEl = $('#kellySub');
  if(!kelly){
    valEl.textContent = '—';
    subEl.textContent = '需有至少 5 筆非對沖已結算紀錄方可計算';
    return;
  }
  valEl.textContent = (kelly.f * 100).toFixed(2) + '% of bankroll';
  subEl.textContent = `依過去 ${kelly.n} 筆非對沖注單估算（勝率 ${(kelly.p*100).toFixed(1)}%，平均賠率 ${kelly.b.toFixed(2)}x）`;
}

/* ================================================================
   對沖效益分析
   ================================================================ */
function renderHedgeAnalysis(){
  const settled = state.records.filter(isSettled);
  const hedgeBets = settled.filter(r => r.is_hedge === '是');
  const保住金額 = hedgeBets.reduce((a,r) => a + r.payout, 0);
  const對沖成本 = hedgeBets.reduce((a,r) => a + r.principal, 0);
  const淨效益 = 保住金額 - 對沖成本;
  const hedgePnl = hedgeBets.reduce((a,r) => a + r.pnl, 0);
  $('#hedgeStatsGrid').innerHTML = `
    <div class="stat-card"><div class="label">對沖注單數</div><div class="value">${hedgeBets.length}</div></div>
    <div class="stat-card"><div class="label">對沖保住金額</div><div class="value ${cls(保住金額)}">${fmt(保住金額,4)}</div></div>
    <div class="stat-card"><div class="label">對沖成本</div><div class="value">${fmt(對沖成本,4)}</div></div>
    <div class="stat-card"><div class="label">淨對沖效益</div><div class="value ${cls(淨效益)}">${(淨效益>=0?'+':'')+fmt(淨效益,4)}</div></div>
    <div class="stat-card"><div class="label">對沖總盈虧</div><div class="value ${cls(hedgePnl)}">${(hedgePnl>=0?'+':'')+fmt(hedgePnl,4)}</div></div>
    <div class="stat-card"><div class="label">成本回收率</div><div class="value">${對沖成本?((保住金額/對沖成本)*100).toFixed(1)+'%':'—'}</div></div>
  `;
}

/* ================================================================
   衍生洞察
   ================================================================ */
function renderInsights(){
  const st = computeStats(state.filtered);
  const rows = [
    ['<i class="fa-solid fa-trophy"></i> 勝 / 平 / 敗（已結算）', `${st.wins} / ${st.draws} / ${st.losses}`, ''],
    ['<i class="fa-solid fa-shield-halved"></i> 對沖單數', `${st.hedgeCount} 筆`, ''],
    ['<i class="fa-solid fa-scale-balanced"></i> 對沖總盈虧', fmt(st.hedgePnl,4), cls(st.hedgePnl)],
    ['<i class="fa-solid fa-coins"></i> 平均注碼', fmt(st.avgStake), ''],
    ['<i class="fa-solid fa-fire"></i> 最長連敗', `${st.consLoss} 場`, ''],
    ['<i class="fa-solid fa-sack-dollar"></i> 總支付額', fmt(st.totalPayout,4), ''],
    ['<i class="fa-solid fa-clock"></i> 進行中注單', state.pendingCount, state.pendingCount ? 'neu' : ''],
  ];
  $('insightTable').innerHTML = rows.map(([l,v,c]) =>
    `<tr><td class="ins-label">${l}</td><td class="${c}" style="font-weight:600;font-variant-numeric:tabular-nums">${v}</td></tr>`
  ).join('');
}

/* ================================================================
   圖表
   ================================================================ */
function destroyCharts(){
  Object.values(state.charts).forEach(c => c?.destroy?.());
  state.charts = {};
}

function renderCharts(){
  if(typeof Chart === 'undefined') return;
  destroyCharts();
  const records = [...state.filtered].sort((a,b) => a.date<b.date?-1:a.date>b.date?1:a.id-b.id);
  const txt = cssVar('--txt'), muted = cssVar('--muted'), faint = cssVar('--faint'), div = cssVar('--div');
  const pri = cssVar('--pri'), suc = cssVar('--suc'), err = cssVar('--err'), warn = cssVar('--warn'), yellow = cssVar('--yellow');
  const baseScales = { x: { ticks: { color: muted }, grid: { color: div } }, y: { ticks: { color: muted }, grid: { color: div } } };
  const baseLegend = { labels: { color: txt, boxWidth: 12 } };
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // 1. 累積盈虧走勢
  let run = 0;
  const tL=[], tD=[], tC=[];
  records.forEach((r,i) => {
    if(r.status === 'pending') return;
    run += r.pnl;
    tL.push(`${r.date.slice(5)} #${i+1}`);
    tD.push(+run.toFixed(4));
    tC.push(r.is_hedge==='是'?warn:pri);
  });
  if(tD.length){
    state.charts.trend = new Chart($('chartPnlTrend'), {
      type: 'line',
      data: { labels: tL, datasets: [{ label: '累積盈虧', data: tD, borderColor: pri, backgroundColor: pri+'22', fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: tC }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: baseLegend }, scales: baseScales }
    });
  }

  // 2. 各注單盈虧分布
  const settledRecs = records.filter(r => r.status === 'settled');
  if(settledRecs.length){
    state.charts.bar = new Chart($('chartPnlBar'), {
      type: 'bar',
      data: { labels: settledRecs.map((_,i) => `#${i+1}`), datasets: [{ label: '盈虧', data: settledRecs.map(r => r.pnl), backgroundColor: settledRecs.map(r => r.pnl>0?suc+'cc':r.pnl<0?err+'cc':warn+'cc'), borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: baseScales }
    });
  }

  // 3. 勝平敗分布
  const wins = settledRecs.filter(r => r.pnl>0).length;
  const draws = settledRecs.filter(r => r.pnl===0).length;
  const losses = settledRecs.filter(r => r.pnl<0).length;
  if(wins+draws+losses > 0){
    state.charts.outcome = new Chart($('chartOutcome'), {
      type: 'doughnut',
      data: { labels: ['勝','平','敗'], datasets: [{ data: [wins, draws, losses], backgroundColor: [suc, warn, err], borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: baseLegend } }
    });
  }

  // 4. ROI 散點
  const nPts = settledRecs.filter(r => r.is_hedge==='否').map((r,i) => ({ x: i, y: +(r.roi*100).toFixed(2) }));
  const hPts = settledRecs.filter(r => r.is_hedge==='是').map((r,i) => ({ x: i, y: +(r.roi*100).toFixed(2) }));
  if(nPts.length || hPts.length){
    state.charts.scatter = new Chart($('chartRoiScatter'), {
      type: 'scatter',
      data: { datasets: [
        { label: '一般單', data: nPts, backgroundColor: pri+'bb', pointRadius: 7 },
        { label: '對沖單', data: hPts, backgroundColor: warn+'bb', pointRadius: 7 }
      ]},
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: baseLegend }, scales: baseScales }
    });
  }

  // 5. 每日本金使用率
  const dailyMap = {};
  records.forEach(r => {
    if(r.status === 'pending') return;
    if(!dailyMap[r.date]) dailyMap[r.date] = { total: 0, hedge: 0, normal: 0 };
    dailyMap[r.date].total += r.principal;
    if(r.is_hedge === '是') dailyMap[r.date].hedge += r.principal;
    else dailyMap[r.date].normal += r.principal;
  });
  const dates = Object.keys(dailyMap).sort();
  if(dates.length){
    state.charts.dailyPrincipal = new Chart($('chartDailyPrincipal'), {
      type: 'bar',
      data: {
        labels: dates.map(d => d.slice(5)),
        datasets: [
          { label: '一般本金', data: dates.map(d => dailyMap[d].normal), backgroundColor: pri+'cc', borderRadius: 2 },
          { label: '對沖本金', data: dates.map(d => dailyMap[d].hedge), backgroundColor: warn+'cc', borderRadius: 2 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { ...baseLegend, labels: { ...baseLegend.labels, boxWidth: 12 } } },
        scales: { x: { stacked: true, ticks: { color: muted }, grid: { color: div } }, y: { stacked: true, ticks: { color: muted }, grid: { color: div } } }
      }
    });
  }

  // 6. 平台雷達圖
  const platformStats = computePlatformStats();
  const platKeys = Object.keys(platformStats).filter(p => p !== '' && platformStats[p].count >= 2);
  if(platKeys.length >= 2){
    const radarData = {
      labels: ['ROI', '勝率', '平均賠率', '對沖比例'],
      datasets: platKeys.map((p, i) => {
        const s = platformStats[p];
        const colors = ['#01696f', '#437a22', '#964219', '#a12c7b', '#4f98a3', '#78b74d'];
        const c = colors[i % colors.length];
        const hedgeCount = settledRecs.filter(r => r.is_hedge === '是' && r.platform === p).length;
        const hedgeRatio = s.count ? hedgeCount / s.count : 0;
        return {
          label: p,
          data: [
            Math.min(s.roi * 100, 100),
            s.winRate * 100,
            Math.min(s.avgOdds, 10),
            hedgeRatio * 100,
          ],
          borderColor: c,
          backgroundColor: c + '33',
          pointBackgroundColor: c,
        };
      })
    };
    state.charts.radar = new Chart($('chartPlatformRadar'), {
      type: 'radar',
      data: radarData,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { ...baseLegend, position: 'bottom' } },
        scales: { r: { ticks: { color: muted, backdropColor: 'transparent' }, grid: { color: div }, pointLabels: { color: txt } } }
      }
    });
  }

  // 7. 本金 vs 支付額
  if(settledRecs.length){
    state.charts.sp = new Chart($('chartStakePayout'), {
      type: 'scatter',
      data: { datasets: [{
        label: '注單',
        data: settledRecs.map(r => ({ x: r.principal, y: r.payout })),
        backgroundColor: settledRecs.map(r => r.pnl>0?suc+'bb':r.pnl<0?err+'bb':warn+'bb'),
        pointRadius: 6,
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: muted }, grid: { color: div }, title: { display: true, text: '本金', color: muted } }, y: { ticks: { color: muted }, grid: { color: div }, title: { display: true, text: '支付額', color: muted } } }
      }
    });
  }
}

/* ================================================================
   匯出 / 匯入
   ================================================================ */
function dl(blob,name){
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

$('exportJsonBtn').addEventListener('click', () => {
  const data = state.records.map(r => ({...r}));
  dl(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}), `bets-${Date.now()}.json`);
});

$('exportCsvBtn').addEventListener('click', () => {
  const h = ['id','date','status','is_hedge','item','platform','principal','payout','pnl','roi'];
  const esc = v => { const t=String(v??''); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; };
  const csv = [h.join(','), ...state.records.map(r => h.map(k => esc(r[k])).join(','))].join('\n');
  dl(new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'}), `bets-${Date.now()}.csv`);
});

$('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const text = String(reader.result||'');
      let data = [];
      if(file.name.endsWith('.json')) data = JSON.parse(text);
      else {
        const rows = text.trim().replace(/^\uFEFF/,'').split(/\r?\n/);
        const heads = rows[0].split(',');
        data = rows.slice(1).filter(Boolean).map(row => {
          const cols=[]; let cur='', q=false;
          for(let i=0; i<row.length; i++){
            const c=row[i];
            if(c==='"'){ if(q&&row[i+1]==='"'){ cur+='"'; i++; } else q=!q; }
            else if(c===','&&!q){ cols.push(cur); cur=''; } else cur+=c;
          }
          cols.push(cur);
          const obj={}; heads.forEach((k,i) => obj[k.trim()] = cols[i]??'');
          return obj;
        });
      }
      state.records = data.map(norm);
      saveCache();
      refreshPlatformOpts();
      applyFilters();
      resetForm();
    } catch(err){
      alert('匯入失敗，請確認格式正確。');
    }
  };
  reader.readAsText(file, 'utf-8');
});

$('newRecordBtn').addEventListener('click', () => fillForm(null));
$('resetSeedBtn').addEventListener('click', () => {
  if(!confirm('確定清除所有本地資料？此操作無法還原。')) return;
  state.records = [];
  saveCache();
  refreshPlatformOpts();
  applyFilters();
  resetForm();
});

['filterPlatform','filterHedge','filterOutcome','filterStatus','searchInput'].forEach(id =>
  $(id).addEventListener('input', applyFilters)
);

/* ================================================================
   分享功能
   ================================================================ */
$('shareBtn').addEventListener('click', () => {
  $('#shareModal').classList.add('show');
  $('#shareGenerated').style.display = 'none';
});
$('closeShareModal').addEventListener('click', () => {
  $('#shareModal').classList.remove('show');
});
$('shareModal').addEventListener('click', e => {
  if(e.target === $('#shareModal')) $('#shareModal').classList.remove('show');
});

$('generateShareBtn').addEventListener('click', async () => {
  if(!supabaseClient || !state.user){
    alert('請先登入才能分享');
    return;
  }
  const expiration = $('#shareExpiration').value;
  let expiresAt = null;
  if(expiration){
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiration));
    expiresAt = d.toISOString();
  }
  try{
    const { data, error } = await supabaseClient.from('shares').insert({
      user_id: state.user.id,
      expires_at: expiresAt,
    }).select('token').single();
    if(error) throw error;
    const shareUrl = location.origin + location.pathname + '?share=' + data.token;
    $('#shareLinkText').textContent = shareUrl;
    $('#shareGenerated').style.display = '';
  } catch(e){
    alert('產生分享連結失敗：' + e.message);
  }
});

$('copyShareLink').addEventListener('click', () => {
  const text = $('#shareLinkText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    $('copyShareLink').innerHTML = '<i class="fa-solid fa-check"></i> 已複製';
    setTimeout(() => { $('copyShareLink').innerHTML = '<i class="fa-solid fa-copy"></i> 複製'; }, 2000);
  });
});

/* ================================================================
   鍵盤快捷鍵
   ================================================================ */
document.addEventListener('keydown', e => {
  if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if($('#shareModal').classList.contains('show')) return;
  if(e.key === 'n' || e.key === 'N'){
    e.preventDefault();
    if(!state.isReadOnly) fillForm(null);
  }
  if(e.key === '/'){
    e.preventDefault();
    $('searchInput').focus();
  }
  if(e.key === 'Escape'){
    if($('#formSection').style.display !== 'none') resetForm();
  }
});

/* ================================================================
   Auth 事件綁定
   ================================================================ */
$('loginBtn').addEventListener('click', handleLogin);
$('logoutBtn').addEventListener('click', handleLogout);

/* ================================================================
   初始化
   ================================================================ */
(async function init(){
  const cached = loadCache();
  state.records = cached.records.map(norm);
  state.lastUpdated = cached.lastUpdated;
  $('cacheStatus').textContent = storageOk() ? 'localStorage 持久' : '記憶體暫存';
  $('lastUpdated').textContent = state.lastUpdated || '—';
  await initSupabase();
  if(!state.isReadOnly){
    refreshPlatformOpts();
    resetForm();
    applyFilters();
    initDragGrid($('recordsDragGrid'));
    initDragGrid($('analyticsDragGrid'));
  }
})();
