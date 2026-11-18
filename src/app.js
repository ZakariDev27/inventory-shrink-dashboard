import {
  RULES, weeklyRates, kpis, topCause, skuRisk, vendorScores, actions, actionSummary,
  applyIncidents, hotSpots, reviewQueue, claimDraft,
} from './rules.js';

// D3 is loaded by a classic script tag in index.html (vendor/d3.min.js).
const d3 = window.d3;

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

// textContent only: values come from data files and from what people type, and are never treated as HTML.
// A column gives either text(row) or node(row), an element built with the same rule.
function fillTable(id, rows, cols, rowClass) {
  $(id).replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    if (rowClass) tr.className = rowClass(r) || '';
    for (const col of cols) {
      const td = document.createElement('td');
      if (col.node) td.append(col.node(r));
      else td.textContent = col.text(r);
      const cls = typeof col.cls === 'function' ? col.cls(r) : col.cls;
      if (cls) td.className = cls;
      tr.append(td);
    }
    return tr;
  }));
}

const button = (label, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'small';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
};
const day = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ---- state: what the person has entered, kept in this browser ----

const KEY = 'inventory-shrink-dashboard-v1';
let history = null; // weekly and cause rows, sample only
let sample = null; // starting SKUs, vendors and incidents
let state = null; // { skus, vendors, incidents, done, rules }

const clone = (x) => JSON.parse(JSON.stringify(x));
const freshState = () => ({ skus: clone(sample.skus), vendors: clone(sample.vendors), incidents: clone(sample.incidents), done: {}, rules: { ...RULES } });
const validState = (s) => s && Array.isArray(s.skus) && Array.isArray(s.vendors) && Array.isArray(s.incidents);
const normalise = (s) => ({
  skus: s.skus,
  vendors: s.vendors,
  incidents: s.incidents,
  done: s.done && typeof s.done === 'object' ? s.done : {},
  rules: { ...RULES, ...(s.rules && typeof s.rules === 'object' ? s.rules : {}) },
});
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (validState(saved)) return normalise(saved);
  } catch (err) { /* private mode or bad data: fall back to the sample */ }
  return null;
}
function saveState() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (err) { /* storage unavailable: keep working in memory */ }
}

function say(text, isError) {
  const el = $('form-msg');
  el.textContent = text;
  el.className = isError ? 'msg err' : 'msg';
}
function commit(message) {
  saveState();
  render();
  if (message) say(message);
}

// ---- drawing everything that depends on the state ----

function fillSelect(select, items) {
  const keep = select.value;
  select.replaceChildren(...items.map(([value, label]) => new Option(label, value)));
  if (items.some(([value]) => value === keep)) select.value = keep;
}

function render() {
  const rules = state.rules;
  const skus = applyIncidents(state.skus, state.incidents);
  const spots = hotSpots(state.incidents, state.skus, rules);
  const queue = actions(skus, state.vendors, rules, spots);
  const review = reviewQueue(queue, state.done);
  const summary = actionSummary(review.open);

  setText('k-actions', summary.open_actions);
  setText('k-high', summary.high_priority);
  setText('k-stake', money(summary.value_at_stake));
  setText('k-fixed', review.resolved.length);
  setText('k-recovered', money(review.recovered_value));
  setText('t-top', rules.topSkus);
  setText('t-hot', rules.hotSpotIncidents);

  document.querySelectorAll('select[data-fill="skus"]').forEach((el) => fillSelect(el, state.skus.map((s) => [s.sku, `${s.sku} ${s.product}`])));
  document.querySelectorAll('select[data-fill="vendors"]').forEach((el) => fillSelect(el, state.vendors.map((v) => [v.vendor, v.vendor])));
  $('vendor-list').replaceChildren(...state.vendors.map((v) => new Option(v.vendor)));
  document.querySelectorAll('[data-rule]').forEach((el) => { if (document.activeElement !== el) el.value = rules[el.dataset.rule]; });

  const status = (a) => {
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';
    const done = state.done[a.id];
    if (done) {
      const note = document.createElement('span');
      note.textContent = `Done ${day(done.at)}, waiting on new data`;
      wrap.append(note, button('Undo', () => { delete state.done[a.id]; commit(`Reopened: ${a.item}.`); }));
    } else {
      wrap.append(button('Mark done', () => {
        state.done[a.id] = { at: new Date().toISOString(), value: a.value_at_stake, item: a.item, trigger: a.trigger };
        commit(`Marked done: ${a.item}. It counts as fixed once new data stops triggering the rule.`);
      }));
    }
    if (a.trigger === 'Arrives damaged' || a.trigger === 'Short shipments') {
      wrap.append(button('Draft claim', () => {
        $('claim-text').value = claimDraft(a);
        $('claim-panel').hidden = false;
        $('claim-panel').scrollIntoView({ block: 'nearest' });
      }));
    }
    return wrap;
  };
  fillTable('actions-body', [...review.open, ...review.waiting], [
    { text: (r) => r.priority, cls: (r) => `nowrap p-${r.priority.toLowerCase()}` },
    { text: (r) => r.item },
    { text: (r) => r.evidence },
    { text: (r) => r.action },
    { text: (r) => money(r.value_at_stake), cls: 'num' },
    { node: status },
  ], (r) => (state.done[r.id] ? 'waiting' : ''));

  $('fixed-wrap').hidden = review.resolved.length === 0;
  fillTable('fixed-body', review.resolved, [
    { text: (r) => r.item || r.id },
    { text: (r) => r.trigger || '' },
    { text: (r) => day(r.at), cls: 'nowrap' },
    { text: (r) => money(Number(r.value || 0)), cls: 'num' },
    { node: (r) => button('Remove', () => { delete state.done[r.id]; commit('Removed from the fixed list.'); }) },
  ]);

  fillTable('spots-body', spots, [
    { text: (r) => r.location, cls: (r) => (r.flagged ? 'flag' : '') },
    { text: (r) => r.shift },
    { text: (r) => String(r.incidents), cls: (r) => 'num' + (r.flagged ? ' flag' : '') },
    { text: (r) => String(r.units), cls: 'num' },
    { text: (r) => money(r.value), cls: 'num' },
  ]);

  const latest = state.incidents.map((incident, index) => ({ ...incident, index })).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 10);
  fillTable('incidents-body', latest, [
    { text: (r) => day(r.at), cls: 'nowrap' },
    { text: (r) => r.sku, cls: 'nowrap' },
    { text: (r) => (r.type === 'Damage' ? 'Damage' : 'Loss') },
    { text: (r) => String(r.units), cls: 'num' },
    { text: (r) => r.cause || '' },
    { text: (r) => r.shift || '' },
    { text: (r) => r.note || '' },
    { node: (r) => button('Remove', () => { state.incidents.splice(r.index, 1); commit('Incident removed.'); }) },
  ]);

  fillTable('skus-body', skuRisk(skus).slice(0, rules.topSkus), [
    { text: (r) => r.sku, cls: 'nowrap' },
    { text: (r) => r.product },
    { text: (r) => r.location, cls: 'nowrap' },
    { text: (r) => String(r.variance_units), cls: 'num' },
    { text: (r) => r.variance_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.variance_pct >= rules.variancePct ? ' flag' : '') },
    { text: (r) => r.damage_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.damage_pct >= rules.damagePct ? ' flag' : '') },
    { text: (r) => money(r.loss_value), cls: 'num' },
  ]);
  fillTable('vendors-body', vendorScores(state.vendors), [
    { text: (r) => r.vendor },
    { text: (r) => d3.format(',')(r.units_received_28d), cls: 'num' },
    { text: (r) => r.doa_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.doa_pct >= rules.doaPct ? ' flag' : '') },
    { text: (r) => r.short_pct.toFixed(1) + '%', cls: (r) => 'num' + (r.short_pct >= rules.shortPct ? ' flag' : '') },
    { text: (r) => money(r.open_claims_value), cls: 'num' },
  ]);
}

function renderHistory() {
  const k = kpis(history.weekly);
  const top = topCause(history.causes);
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
  const rates = weeklyRates(history.weekly);
  const drawCharts = () => {
    drawTrend($('trend'), rates);
    drawCauses($('causes'), history.causes);
  };
  drawCharts();
  new ResizeObserver(drawCharts).observe($('trend'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawCharts);
}

// ---- forms: every handler checks its input and says what is wrong before saving ----

const whole = (text, min) => {
  const n = Number(text);
  return String(text).trim() !== '' && Number.isInteger(n) && n >= min ? n : null;
};
function onSubmit(id, handler) {
  $(id).addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.target));
    const result = handler(fields, event.target);
    if (result.error) say(result.error, true);
    else commit(result.ok);
  });
}

function wireForms() {
  onSubmit('f-incident', (f, form) => {
    const units = whole(f.units, 1);
    if (units === null) return { error: 'Enter the units as a whole number, 1 or more.' };
    if (!state.skus.some((s) => s.sku === f.sku)) return { error: 'Pick a SKU first.' };
    state.incidents.push({ at: new Date().toISOString(), sku: f.sku, type: f.type, units, cause: f.cause, shift: f.shift, note: (f.note || '').trim() });
    form.elements.units.value = '';
    form.elements.note.value = '';
    return { ok: `Incident saved: ${units} units of ${f.sku}, ${f.shift.toLowerCase()} shift.` };
  });

  onSubmit('f-count', (f, form) => {
    const counted = whole(f.counted, 0);
    if (counted === null) return { error: 'Enter the count as a whole number, 0 or more.' };
    const sku = state.skus.find((s) => s.sku === f.sku);
    if (!sku) return { error: 'Pick a SKU first.' };
    sku.counted_qty = counted;
    sku.counted_at = new Date().toISOString();
    form.elements.counted.value = '';
    const missing = Number(sku.system_qty) - counted;
    return { ok: `Count saved for ${sku.sku}: ${counted} counted against ${sku.system_qty} in the system (${missing > 0 ? missing + ' missing' : 'nothing missing'}).` };
  });

  onSubmit('f-delivery', (f) => {
    const received = whole(f.received, 1);
    const damaged = whole(f.damaged === '' ? '0' : f.damaged, 0);
    const short = whole(f.short === '' ? '0' : f.short, 0);
    if (received === null) return { error: 'Enter units received as a whole number, 1 or more.' };
    if (damaged === null || short === null) return { error: 'Damaged and short units must be whole numbers, 0 or more.' };
    if (damaged > received) return { error: 'Damaged units cannot be more than units received.' };
    const vendor = state.vendors.find((v) => v.vendor === f.vendor);
    if (!vendor) return { error: 'Pick a vendor first.' };
    vendor.units_received_28d = Number(vendor.units_received_28d) + received;
    vendor.damaged_on_arrival_units = Number(vendor.damaged_on_arrival_units) + damaged;
    vendor.short_shipped_units = Number(vendor.short_shipped_units) + short;
    document.querySelectorAll('input[form="f-delivery"]').forEach((el) => { el.value = ''; });
    return { ok: `Delivery saved for ${vendor.vendor}: ${received} received, ${damaged} damaged, ${short} short.` };
  });

  onSubmit('f-sku', (f, form) => {
    const code = (f.sku || '').trim();
    const product = (f.product || '').trim();
    const location = (f.location || '').trim();
    const vendorName = (f.vendor || '').trim();
    if (!code || !product || !location) return { error: 'SKU code, product and location are all needed.' };
    if (state.skus.some((s) => s.sku.toLowerCase() === code.toLowerCase())) return { error: `SKU ${code} is already in the list.` };
    const cost = Number(f.unit_cost);
    if (String(f.unit_cost).trim() === '' || !Number.isFinite(cost) || cost < 0) return { error: 'Enter the unit cost as a number, 0 or more.' };
    const system = whole(f.system_qty, 1);
    const counted = whole(f.counted_qty, 0);
    const weekly = whole(f.weekly_sales_units === '' ? '0' : f.weekly_sales_units, 0);
    if (system === null) return { error: 'System quantity must be a whole number, 1 or more.' };
    if (counted === null) return { error: 'Units counted must be a whole number, 0 or more.' };
    if (weekly === null) return { error: 'Weekly sales must be a whole number, 0 or more.' };
    let expiry = '';
    if (String(f.days_to_expiry).trim() !== '') {
      expiry = whole(f.days_to_expiry, 0);
      if (expiry === null) return { error: 'Days to expiry must be a whole number, 0 or more.' };
    }
    state.skus.push({
      sku: code, product, category: '', vendor: vendorName, location, unit_cost: cost, system_qty: system, counted_qty: counted,
      received_28d: 0, damaged_units_28d: 0, weekly_sales_units: weekly, days_to_expiry: expiry, counted_at: new Date().toISOString(),
    });
    form.reset();
    return { ok: `SKU ${code} added.` };
  });

  // Thresholds apply as they are typed, so nothing is rebuilt at the moment the
  // field loses focus (a rebuild then would swallow a click on a button in the tables).
  const readRule = (el) => {
    const value = Number(el.value);
    const min = Number(el.min || 0);
    return el.value.trim() !== '' && Number.isFinite(value) && value >= min ? value : null;
  };
  document.querySelectorAll('[data-rule]').forEach((el) => {
    el.addEventListener('input', () => {
      const value = readRule(el);
      if (value === null || value === state.rules[el.dataset.rule]) return;
      state.rules[el.dataset.rule] = value;
      commit('Threshold updated. The action queue has been worked out again.');
    });
    el.addEventListener('change', () => {
      if (readRule(el) !== null) return;
      el.value = state.rules[el.dataset.rule];
      say(`That threshold needs a number, ${Number(el.min || 0)} or more.`, true);
    });
  });
  $('rules-reset').addEventListener('click', () => { state.rules = { ...RULES }; commit('Thresholds reset.'); });

  $('claim-close').addEventListener('click', () => { $('claim-panel').hidden = true; });
  $('claim-copy').addEventListener('click', () => {
    const box = $('claim-text');
    const fallback = () => { box.focus(); box.select(); say('Select all is on. Press Ctrl+C or Cmd+C to copy.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(() => say('Claim copied.'), fallback);
    else fallback();
  });

  $('data-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inventory-backup.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('data-import').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text);
      if (!validState(parsed)) throw new Error('not a backup');
      state = normalise(parsed);
      commit('Backup imported.');
    }).catch(() => say('That file is not a backup from this dashboard.', true));
  });
  let armed = 0;
  $('data-reset').addEventListener('click', (event) => {
    if (Date.now() - armed > 4000) {
      armed = Date.now();
      event.target.textContent = 'Click again to erase your entries';
      setTimeout(() => { event.target.textContent = 'Reset to sample data'; }, 4000);
      return;
    }
    armed = 0;
    event.target.textContent = 'Reset to sample data';
    state = freshState();
    commit('Back to the sample data.');
  });
}

async function main() {
  const [weekly, causes, skus, vendors, incidents] = await Promise.all(
    ['sample_weekly', 'sample_causes', 'sample_skus', 'sample_vendors', 'sample_incidents'].map((name) => d3.csv(`data/${name}.csv`)),
  );
  history = { weekly, causes };
  sample = { skus, vendors, incidents };
  state = loadState() || freshState();
  wireForms();
  renderHistory();
  render();
}

main().catch((err) => {
  const el = $('error');
  el.hidden = false;
  el.textContent = `Could not load the dashboard: ${err.message}. Serve the folder over http (npm start) instead of opening the file directly.`;
});
