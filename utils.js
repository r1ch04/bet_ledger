/* ================================================================
   純工具函式
   ================================================================ */

export function fmt(v, d = 2) {
  return Number(v || 0).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function pct(v) {
  return (Number(v || 0) * 100).toFixed(2) + '%';
}

export function cls(v) {
  return v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
}

export function outcome(r) {
  if (r.status === 'pending') return 'pending';
  return r.pnl > 0 ? 'win' : r.pnl < 0 ? 'loss' : 'draw';
}

export function escH(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function genId(records) {
  return records.reduce((m, r) => Math.max(m, +r.id || 0), 0) + 1;
}

export function norm(r, i) {
  return {
    id: +(r.id || i + 1),
    date: String(r.date || r['比賽時間'] || new Date().toISOString().slice(0, 10)).slice(0, 10),
    is_hedge: r.is_hedge || r['是否為對沖單'] || '否',
    item: r.item || r['項目'] || '',
    platform: r.platform || r['平台'] || '',
    principal: +(r.principal || r['本金'] || 0),
    payout: +(r.payout || r['支付額'] || 0),
    pnl: +(r.pnl || r['盈虧'] || 0),
    roi: +(r.roi || r['ROI'] || 0),
    status: r.status || 'settled',
  };
}

export function cssVar(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

export function isSettled(r) {
  return r.status === 'settled';
}

export function storageOk() {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
  catch { return false; }
}
