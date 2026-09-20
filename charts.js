/* ================================================================
   圖表渲染
   ================================================================ */
import { state, $ } from './state.js';
import { cssVar } from './utils.js';
import { computePlatformStats } from './calc.js';
import { CHART_COLORS } from './config.js';

export function destroyCharts() {
  Object.values(state.charts).forEach(c => c?.destroy?.());
  state.charts = {};
}

export function renderCharts() {
  if (typeof Chart === 'undefined') return;
  destroyCharts();
  const records = [...state.filtered].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);
  const txt = cssVar('--txt'), muted = cssVar('--muted'), div = cssVar('--div');
  const pri = cssVar('--pri'), suc = cssVar('--suc'), err = cssVar('--err'), warn = cssVar('--warn');
  const baseScales = { x: { ticks: { color: muted }, grid: { color: div } }, y: { ticks: { color: muted }, grid: { color: div } } };
  const baseLegend = { labels: { color: txt, boxWidth: 12 } };

  // 1. 累積盈虧走勢
  let run = 0;
  const tL = [], tD = [], tC = [];
  records.forEach((r, i) => {
    if (r.status === 'pending') return;
    run += r.pnl;
    tL.push(`${r.date.slice(5)} #${i + 1}`);
    tD.push(+run.toFixed(4));
    tC.push(r.is_hedge === '是' ? warn : pri);
  });
  if (tD.length) {
    state.charts.trend = new Chart($('chartPnlTrend'), {
      type: 'line',
      data: { labels: tL, datasets: [{ label: '累積盈虧', data: tD, borderColor: pri, backgroundColor: pri + '22', fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: tC }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: baseLegend }, scales: baseScales },
    });
  }

  // 2. 各注單盈虧分布
  const settledRecs = records.filter(r => r.status === 'settled');
  if (settledRecs.length) {
    state.charts.bar = new Chart($('chartPnlBar'), {
      type: 'bar',
      data: { labels: settledRecs.map((_, i) => `#${i + 1}`), datasets: [{ label: '盈虧', data: settledRecs.map(r => r.pnl), backgroundColor: settledRecs.map(r => r.pnl > 0 ? suc + 'cc' : r.pnl < 0 ? err + 'cc' : warn + 'cc'), borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: baseScales },
    });
  }

  // 3. 勝平敗分布
  const wins = settledRecs.filter(r => r.pnl > 0).length;
  const draws = settledRecs.filter(r => r.pnl === 0).length;
  const losses = settledRecs.filter(r => r.pnl < 0).length;
  if (wins + draws + losses > 0) {
    state.charts.outcome = new Chart($('chartOutcome'), {
      type: 'doughnut',
      data: { labels: ['勝', '平', '敗'], datasets: [{ data: [wins, draws, losses], backgroundColor: [suc, warn, err], borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: baseLegend } },
    });
  }

  // 4. ROI 散點
  const nPts = settledRecs.filter(r => r.is_hedge === '否').map((r, i) => ({ x: i, y: +(r.roi * 100).toFixed(2) }));
  const hPts = settledRecs.filter(r => r.is_hedge === '是').map((r, i) => ({ x: i, y: +(r.roi * 100).toFixed(2) }));
  if (nPts.length || hPts.length) {
    state.charts.scatter = new Chart($('chartRoiScatter'), {
      type: 'scatter',
      data: {
        datasets: [
          { label: '一般單', data: nPts, backgroundColor: pri + 'bb', pointRadius: 7 },
          { label: '對沖單', data: hPts, backgroundColor: warn + 'bb', pointRadius: 7 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: baseLegend }, scales: baseScales },
    });
  }

  // 5. 每日本金使用率
  const dailyMap = {};
  records.forEach(r => {
    if (r.status === 'pending') return;
    if (!dailyMap[r.date]) dailyMap[r.date] = { total: 0, hedge: 0, normal: 0 };
    dailyMap[r.date].total += r.principal;
    if (r.is_hedge === '是') dailyMap[r.date].hedge += r.principal;
    else dailyMap[r.date].normal += r.principal;
  });
  const dates = Object.keys(dailyMap).sort();
  if (dates.length) {
    state.charts.dailyPrincipal = new Chart($('chartDailyPrincipal'), {
      type: 'bar',
      data: {
        labels: dates.map(d => d.slice(5)),
        datasets: [
          { label: '一般本金', data: dates.map(d => dailyMap[d].normal), backgroundColor: pri + 'cc', borderRadius: 2 },
          { label: '對沖本金', data: dates.map(d => dailyMap[d].hedge), backgroundColor: warn + 'cc', borderRadius: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { ...baseLegend, labels: { ...baseLegend.labels, boxWidth: 12 } } },
        scales: { x: { stacked: true, ticks: { color: muted }, grid: { color: div } }, y: { stacked: true, ticks: { color: muted }, grid: { color: div } } },
      },
    });
  }

  // 6. 平台雷達圖
  const platformStats = computePlatformStats(state.records);
  const platKeys = Object.keys(platformStats).filter(p => p !== '' && platformStats[p].count >= 2);
  if (platKeys.length >= 2) {
    const radarData = {
      labels: ['ROI', '勝率', '平均賠率', '對沖比例'],
      datasets: platKeys.map((p, i) => {
        const s = platformStats[p];
        const c = CHART_COLORS[i % CHART_COLORS.length];
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
      }),
    };
    state.charts.radar = new Chart($('chartPlatformRadar'), {
      type: 'radar',
      data: radarData,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { ...baseLegend, position: 'bottom' } },
        scales: { r: { ticks: { color: muted, backdropColor: 'transparent' }, grid: { color: div }, pointLabels: { color: txt } } },
      },
    });
  }

  // 7. 本金 vs 支付額
  if (settledRecs.length) {
    state.charts.sp = new Chart($('chartStakePayout'), {
      type: 'scatter',
      data: {
        datasets: [{
          label: '注單',
          data: settledRecs.map(r => ({ x: r.principal, y: r.payout })),
          backgroundColor: settledRecs.map(r => r.pnl > 0 ? suc + 'bb' : r.pnl < 0 ? err + 'bb' : warn + 'bb'),
          pointRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: muted }, grid: { color: div }, title: { display: true, text: '本金', color: muted } },
          y: { ticks: { color: muted }, grid: { color: div }, title: { display: true, text: '支付額', color: muted } },
        },
      },
    });
  }
}
