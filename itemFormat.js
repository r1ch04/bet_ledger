/* ================================================================
   項目字串格式：`聯賽【對戰：選項】+【…】@賠率`
   ================================================================ */

/* 解析字串為 { legs, odds } */
export function parseItem(str) {
  const text = String(str || '');
  const oddsMatch = text.match(/@([\d.]+)\s*$/);
  const odds = oddsMatch ? oddsMatch[1] : '';
  const body = oddsMatch ? text.slice(0, oddsMatch.index) : text;
  const legs = [];
  const re = /([^【+]*?)【([^】]*)】/g;
  let m;
  while ((m = re.exec(body))) {
    const league = m[1].trim();
    const inner = m[2];
    const ci = inner.search(/[：:]/);
    const match = ci >= 0 ? inner.slice(0, ci).trim() : inner.trim();
    const selection = ci >= 0 ? inner.slice(ci + 1).trim() : '';
    legs.push({ league, match, selection });
  }
  if (!legs.length && body.trim()) legs.push({ league: '', match: '', selection: body.trim() });
  return { legs, odds };
}

/* 由 legs 與賠率組回字串；同聯賽只在第一腿重複標示 */
export function buildItemString(legs, odds) {
  const valid = (legs || []).map(l => ({
    league: (l.league || '').trim(),
    match: (l.match || '').trim(),
    selection: (l.selection || '').trim(),
  })).filter(l => l.league || l.match || l.selection);
  if (!valid.length) return '';
  let lastLeague = '';
  const parts = valid.map(l => {
    const inner = l.match && l.selection ? `${l.match}：${l.selection}` : (l.match || l.selection);
    const bracket = `【${inner}】`;
    if (l.league && l.league !== lastLeague) { lastLeague = l.league; return l.league + bracket; }
    return bracket;
  });
  return parts.join('+') + (odds ? '@' + odds : '');
}

/* 取得項目字串中的賠率（原始字串，無則空字串） */
export function getOdds(item) {
  return parseItem(item).odds;
}

/* 設定/移除項目字串結尾的 @賠率 */
export function setOdds(item, odds) {
  const base = String(item || '').replace(/@[\d.]+\s*$/, '').trimEnd();
  const o = String(odds ?? '').trim();
  return o ? `${base}@${o}` : base;
}
