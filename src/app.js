// D3 is loaded by a classic script tag in index.html (vendor/d3.min.js).
const d3 = window.d3;
import { RULES, weeklyRates, kpis, topCause, skuRisk, vendorScores, actions, actionSummary } from './rules.js';

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + d3.format(',')(n);
const signed = (n, digits) => (n > 0 ? '+' : '') + n.toFixed(digits);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const setText = (id, value) => { $(id).textContent = String(value); };
// A rising loss is bad news, so colour by meaning and not by sign.
const setChange = (id, value, digits) => {
  const el = $(id);
  el.textContent = signed(value, digits);
  el.className = value > 0 ? 'bad' : 'good';
};

const fillTip = (node, lines) => node.replaceChildren(...lines.map((line) => {
  const div = document.createElement('div');
  div.textContent = line;
  return div;
}));
const placeTip = (node, box, left, top) => {
  const max = box.clientWidth - node.offsetWidth - 4;
  node.style.left = Math.max(0, Math.min(left + 12, max)) + 'px';
  node.style.top = Math.max(0, top) + 'px';
};

function drawTrend(el, rates) {
  el.replaceChildren();
  const rows = rates.map((r) => ({ date: new Date(r.week_start), shrink: r.shrink_pct, damage: r.damage_pct }));
  const width = el.clientWidth || 600;
  const height = 260;
  const m = { top: 12, right: 16, bottom: 28, left: 40 };
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('height', height)
    .attr('role', 'img').attr('aria-label', 'Line chart of weekly shrink and damage as a percent of sales');
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => Math.max(r.shrink, r.damage)) * 1.15]).nice().range([height - m.bottom, m.top]);
  const yAxis = svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => d3.format('.1f')(v) + '%').tickSize(0).tickPadding(6));
  yAxis.select('.domain').remove();
  let widest = 0;
  yAxis.selectAll('text').each(function () { widest = Math.max(widest, this.getComputedTextLength()); });
  m.left = Math.ceil(widest) + 10;
  yAxis.attr('transform', `translate(${m.left},0)`);
  const x = d3.scaleUtc().domain(d3.extent(rows, (r) => r.date)).range([m.left + 8, width - m.right - 8]);
  svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', m.left).attr('x2', width - m.right).attr('y1', (v) => y(v)).attr('y2', (v) => y(v));
  const step = Math.ceil(rows.length / Math.max(2, Math.floor((width - m.left) / 90)));
  const fmtDate = d3.utcFormat('%b %-d');
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(rows.filter((r, i) => i % step === 0).map((r) => r.date)).tickFormat(fmtDate).tickSizeOuter(0));
  for (const [key, color] of [['shrink', css('--s0')], ['damage', css('--s1')]]) {
    svg.append('path').attr('fill', 'none').attr('stroke-width', 2).attr('stroke', color)
      .attr('d', d3.line().x((r) => x(r.date)).y((r) => y(r[key]))(rows));
    svg.append('g').selectAll('circle').data(rows).join('circle').attr('r', 2.5)
      .attr('cx', (r) => x(r.date)).attr('cy', (r) => y(r[key])).attr('fill', color);
  }
  const marker = svg.append('line').attr('y1', m.top).attr('y2', height - m.bottom).attr('stroke', css('--muted')).style('display', 'none');
  const tip = d3.select(el).append('div').attr('class', 'tip').style('display', 'none');
  svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', Math.max(0, width - m.left - m.right))
    .attr('height', height - m.top - m.bottom).attr('fill', 'transparent')
    .on('pointermove', (event) => {
      const px = d3.pointer(event)[0];
      const r = rows[d3.leastIndex(rows, (a, b) => Math.abs(x(a.date) - px) - Math.abs(x(b.date) - px))];
      marker.style('display', null).attr('x1', x(r.date)).attr('x2', x(r.date));
      tip.style('display', null);
      fillTip(tip.node(), [`Week of ${fmtDate(r.date)}`, `Shrink ${r.shrink.toFixed(2)}%`, `Damage ${r.damage.toFixed(2)}%`]);
      placeTip(tip.node(), el, d3.pointer(event, el)[0], 8);
    })
    .on('pointerleave', () => { tip.style('display', 'none'); marker.style('display', 'none'); });
}

function drawCauses(el, causes) {
  el.replaceChildren();
  const rows = causes.map((r) => ({ cause: r.cause, type: r.type, value: Number(r.loss_value) })).sort((a, b) => b.value - a.value);
  const total = d3.sum(rows, (r) => r.value);
  const width = el.clientWidth || 600;
  const rowH = 28;
  const height = rows.length * rowH + 8;
  const mid = (i) => 4 + i * rowH + rowH / 2;
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('height', height)
    .attr('role', 'img').attr('aria-label', 'Bar chart of loss value by cause over the last 4 weeks, shrink and damage');
  const groups = svg.selectAll('g').data(rows).join('g');
  const labels = groups.append('text').attr('class', 'bar-label').attr('x', 0).attr('y', (r, i) => mid(i)).attr('dominant-baseline', 'central').text((r) => r.cause);
  const values = groups.append('text').attr('y', (r, i) => mid(i)).attr('dominant-baseline', 'central').text((r) => money(r.value));
  let left = 0;
  let right = 0;
  labels.each(function () { left = Math.max(left, this.getComputedTextLength()); });
  values.each(function () { right = Math.max(right, this.getComputedTextLength()); });
  left = Math.min(Math.ceil(left) + 10, width * 0.55);
  right = Math.ceil(right) + 8;
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.value)]).range([0, Math.max(10, width - left - right)]);
  groups.append('rect').attr('x', left).attr('y', (r, i) => mid(i) - 8).attr('height', 16).attr('rx', 2)
    .attr('width', (r) => x(r.value)).attr('fill', (r) => css(r.type === 'Damage' ? '--s1' : '--s0'));
  values.attr('x', (r) => left + x(r.value) + 6);
  const tip = d3.select(el).append('div').attr('class', 'tip').style('display', 'none');
  groups.on('pointermove', (event, r) => {
    const p = d3.pointer(event, el);
    tip.style('display', null);
    fillTip(tip.node(), [r.cause, `${r.type}, ${money(r.value)}`, `${((r.value / total) * 100).toFixed(1)}% of all loss`]);
    placeTip(tip.node(), el, p[0], p[1] + 14);
  }).on('pointerleave', () => tip.style('display', 'none'));
}

// textContent only: cell values come from data files and are never treated as HTML.
function fillTable(id, rows, cols) {
  $(id).replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    for (const col of cols) {
      const td = document.createElement('td');
      td.textContent = col.text(r);
      const cls = typeof col.cls === 'function' ? col.cls(r) : col.cls;
      if (cls) td.className = cls;
      tr.append(td);
    }
    return tr;
  }));
}

async function main() {
  const [weekly, causes, skus, vendors] = await Promise.all(
    ['sample_weekly', 'sample_causes', 'sample_skus', 'sample_vendors'].map((name) => d3.csv(`data/${name}.csv`)),
  );

  const k = kpis(weekly);
  const top = topCause(causes);
  const queue = actions(skus, vendors);
  const summary = actionSummary(queue);
  const rates = weeklyRates(weekly);

  if (k) {
    setText('lede-loss', money(k.loss_value));
    setText('lede-change', signed(k.loss_change_pct, 1));
    setText('k-shrink', k.shrink_pct.toFixed(2));
    setChange('k-shrink-chg', k.shrink_change_pts, 2);
    setText('k-damage', k.damage_pct.toFixed(2));
    setChange('k-damage-chg', k.damage_change_pts, 2);
    setText('k-loss', money(k.loss_value));
    setChange('k-loss-chg', k.loss_change_pct, 1);
  }
  if (top) {
    setText('lede-cause', top.cause.toLowerCase());
    setText('lede-share', top.share_pct.toFixed(1));
  }
  setText('k-actions', summary.open_actions);
  setText('k-high', summary.high_priority);
  setText('k-stake', money(summary.value_at_stake));

  const thresholds = {
    't-top': RULES.topSkus, 't-variance': RULES.variancePct, 't-cage': RULES.cageUnitCost, 't-damage': RULES.damagePct,
    't-expiry': RULES.expiryDays, 't-doa': RULES.doaPct, 't-short': RULES.shortPct, 't-high': RULES.highValue, 't-medium': RULES.mediumValue,
  };
  for (const [id, value] of Object.entries(thresholds)) setText(id, value);

  fillTable('actions-body', queue, [
    { text: (r) => r.priority, cls: (r) => `nowrap p-${r.priority.toLowerCase()}` },
    { text: (r) => r.item },
    { text: (r) => r.evidence },
    { text: (r) => r.action },
    { text: (r) => money(r.value_at_stake), cls: 'num' },
  ]);
  fillTable('skus-body', skuRisk(skus).slice(0, RULES.topSkus), [
    { text: (r) => r.sku, cls: 'nowrap' },
    { text: (r) => r.product },
    { text: (r) => r.location, cls: 'nowrap' },
    { text: (r) => String(r.variance_units), cls: 'num' },
    { text: (r) => r.variance_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.variance_pct >= RULES.variancePct ? ' flag' : '') },
    { text: (r) => r.damage_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.damage_pct >= RULES.damagePct ? ' flag' : '') },
    { text: (r) => money(r.loss_value), cls: 'num' },
  ]);
  fillTable('vendors-body', vendorScores(vendors), [
    { text: (r) => r.vendor },
    { text: (r) => d3.format(',')(r.units_received_28d), cls: 'num' },
    { text: (r) => r.doa_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.doa_pct >= RULES.doaPct ? ' flag' : '') },
    { text: (r) => r.short_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.short_pct >= RULES.shortPct ? ' flag' : '') },
    { text: (r) => money(r.open_claims_value), cls: 'num' },
  ]);

  const drawCharts = () => {
    drawTrend($('trend'), rates);
    drawCauses($('causes'), causes);
  };
  drawCharts();
  new ResizeObserver(drawCharts).observe($('trend'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawCharts);
}

main().catch((err) => {
  const el = $('error');
  el.hidden = false;
  el.textContent = `Could not load the dashboard: ${err.message}. Serve the folder over http (npm start) instead of opening the file directly.`;
});
