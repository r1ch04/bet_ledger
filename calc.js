/* ================================================================
   統計計算（純函式）
   ================================================================ */
import { isSettled } from './utils.js';

export function computeStats(records) {
  const settled = records.filter(isSettled);
  const stake = settled.reduce((a, r) => a + r.principal, 0);
  const pnlSum = settled.reduce((a, r) => a + r.pnl, 0);
  const wins = settled.filter(r => r.pnl > 0);
  const draws = settled.filter(r => r.pnl === 0);
  const losses = settled.filter(r => r.pnl < 0);
  const roi = stake ? pnlSum / stake : 0;
  const winRate = settled.length ? wins.length / settled.length : 0;
  const nh = settled.filter(r => r.is_hedge === '否');
  const nhS = nh.reduce((a, r) => a + r.principal, 0);
  const nhP = nh.reduce((a, r) => a + r.pnl, 0);
  const nhRoi = nhS ? nhP / nhS : 0;
  const avgOdds = wins.length ? wins.reduce((a, r) => a + (r.principal ? r.payout / r.principal : 0), 0) / wins.length : 0;
  const maxLoss = losses.length ? Math.min(...losses.map(r => r.pnl)) : 0;
  const avgStake = settled.length ? stake / settled.length : 0;
  const totalPayout = settled.reduce((a, r) => a + r.payout, 0);
  const hedgeCount = settled.filter(r => r.is_hedge === '是').length;
  const hedgePnl = settled.filter(r => r.is_hedge === '是').reduce((a, r) => a + r.pnl, 0);
  const consLoss = (() => {
    let mx = 0, cur = 0;
    [...settled].sort((a, b) => a.date < b.date ? -1 : 1).forEach(r => {
      if (r.pnl < 0) { cur++; mx = Math.max(mx, cur); } else cur = 0;
    });
    return mx;
  })();
  const avgWin = wins.length ? wins.reduce((a, r) => a + r.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, r) => a + r.pnl, 0) / losses.length : 0;
  const rr = avgLoss ? Math.abs(avgWin / avgLoss) : 0;
  const pf = losses.length ? Math.abs(wins.reduce((a, r) => a + r.pnl, 0) / losses.reduce((a, r) => a + r.pnl, 0)) : Infinity;
  const allStake = records.reduce((a, r) => a + r.principal, 0);
  const allPnl = records.reduce((a, r) => a + r.pnl, 0);
  return {
    stake, pnlSum, wins: wins.length, draws: draws.length, losses: losses.length,
    roi, winRate, nhRoi, avgOdds, maxLoss, avgStake, totalPayout, hedgeCount, hedgePnl,
    consLoss, avgWin, avgLoss, rr, pf, nhP, nhS, settledCount: settled.length, allStake, allPnl,
  };
}

export function computePlatformStats(records) {
  const settled = records.filter(isSettled);
  const platforms = [...new Set(settled.map(r => r.platform).filter(Boolean))].sort();
  const allStats = computeStats(records);
  const result = { '': { ...allStats, name: '全部', count: settled.length } };
  platforms.forEach(p => {
    const recs = settled.filter(r => r.platform === p);
    const s = computeStats(recs);
    result[p] = { ...s, name: p, count: recs.length };
  });
  return result;
}

export function computeKelly(records) {
  const nh = records.filter(r => isSettled(r) && r.is_hedge === '否');
  if (nh.length < 5) return null;
  const wins = nh.filter(r => r.pnl > 0);
  const p = wins.length / nh.length;
  const avgOdds = wins.length
    ? wins.reduce((a, r) => a + (r.principal ? r.payout / r.principal : 0), 0) / wins.length
    : 0;
  const b = avgOdds - 1;
  if (b <= 0) return null;
  const q = 1 - p;
  const f = (b * p - q) / b;
  return { f: Math.max(0, f), p, b, n: nh.length };
}
