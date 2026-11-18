// Rules engine and metrics. Pure functions: rows in, rows out. No DOM, no network.
// Rows come straight from the CSV files, so every numeric cell is converted with Number().

export const RULES = {
  variancePct: 3, // SKU missing this % or more of its system count -> recount
  cageUnitCost: 150, // ...and if a unit costs this much or more -> locked cage
  damagePct: 2, // % of received units damaged -> packaging inspection
  expiryDays: 14, // stock this close to expiry that will not sell in time -> markdown
  doaPct: 3, // vendor units damaged on arrival -> credit claim
  shortPct: 2, // vendor units short shipped -> blind receiving
  highValue: 600, // value at stake for High priority
  mediumValue: 200, // value at stake for Medium priority
  topSkus: 8, // rows shown in the SKU table
  hotSpotIncidents: 3, // incidents in one location on one shift -> hot spot
};

export const SHIFTS = ['Morning', 'Afternoon', 'Overnight'];

const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field]), 0);
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;
const pct = (part, whole) => round((part / whole) * 100, 1);

export function weeklyRates(weekly) {
  return weekly.map((week) => ({
    week_start: week.week_start,
    shrink_pct: round((Number(week.shrink_value) / Number(week.sales_value)) * 100, 2),
    damage_pct: round((Number(week.damage_value) / Number(week.sales_value)) * 100, 2),
  }));
}

// Latest 4 weeks against the 4 weeks before.
export function kpis(weekly) {
  const rows = [...weekly].sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
  if (rows.length < 8) return null;
  const now = rows.slice(-4);
  const prev = rows.slice(-8, -4);
  const rate = (list, field) => (sum(list, field) / sum(list, 'sales_value')) * 100;
  const lossNow = sum(now, 'shrink_value') + sum(now, 'damage_value');
  const lossPrev = sum(prev, 'shrink_value') + sum(prev, 'damage_value');
  return {
    shrink_pct: round(rate(now, 'shrink_value'), 2),
    shrink_change_pts: round(rate(now, 'shrink_value') - rate(prev, 'shrink_value'), 2),
    damage_pct: round(rate(now, 'damage_value'), 2),
    damage_change_pts: round(rate(now, 'damage_value') - rate(prev, 'damage_value'), 2),
    loss_value: Math.round(lossNow),
    loss_change_pct: round((lossNow / lossPrev - 1) * 100, 1),
  };
}

export function topCause(causes) {
  if (!causes.length) return null;
  const total = sum(causes, 'loss_value');
  const top = [...causes].sort((a, b) => Number(b.loss_value) - Number(a.loss_value))[0];
  return {
    cause: top.cause,
    type: top.type,
    loss_value: Number(top.loss_value),
    share_pct: pct(Number(top.loss_value), total),
  };
}

export function skuRisk(skus) {
  return skus
    .map((sku) => {
      const cost = Number(sku.unit_cost);
      const missing = Number(sku.system_qty) - Number(sku.counted_qty);
      const damaged = Number(sku.damaged_units_28d);
      const received = Number(sku.received_28d);
      return {
        sku: sku.sku,
        product: sku.product,
        location: sku.location,
        variance_units: missing,
        variance_pct: pct(missing, Number(sku.system_qty)),
        damage_pct: received > 0 ? pct(damaged, received) : 0,
        loss_value: Math.round((Math.max(missing, 0) + damaged) * cost),
      };
    })
    .sort((a, b) => b.loss_value - a.loss_value);
}

export function vendorScores(vendors) {
  return vendors
    .map((vendor) => ({
      vendor: vendor.vendor,
      units_received_28d: Number(vendor.units_received_28d),
      doa_pct: pct(Number(vendor.damaged_on_arrival_units), Number(vendor.units_received_28d)),
      short_pct: pct(Number(vendor.short_shipped_units), Number(vendor.units_received_28d)),
      open_claims_value: Number(vendor.open_claims_value),
    }))
    .sort((a, b) => b.doa_pct + b.short_pct - (a.doa_pct + a.short_pct));
}

// The automated part: every SKU and vendor is checked against RULES and each
// breach becomes one action with a recommended next step and a value at stake.
export function actions(skus, vendors, rules = RULES, spots = []) {
  const queue = [];
  const add = (id, item, trigger, evidence, action, value) =>
    queue.push({
      id,
      priority: value >= rules.highValue ? 'High' : value >= rules.mediumValue ? 'Medium' : 'Low',
      item,
      trigger,
      evidence,
      action,
      value_at_stake: Math.round(value),
    });

  for (const sku of skus) {
    const cost = Number(sku.unit_cost);
    const label = `${sku.sku} ${sku.product}`;
    const system = Number(sku.system_qty);
    const missing = system - Number(sku.counted_qty);
    if (missing > 0 && pct(missing, system) >= rules.variancePct) {
      add(
        `count-${sku.sku}`,
        label,
        'Count variance',
        `${missing} units missing, ${pct(missing, system)}% of the system count`,
        cost >= rules.cageUnitCost
          ? 'Recount today, hold adjustments for sign-off and move to a locked cage'
          : 'Recount today and hold adjustments for manager sign-off',
        missing * cost,
      );
    }

    const damaged = Number(sku.damaged_units_28d);
    const received = Number(sku.received_28d);
    if (received > 0 && pct(damaged, received) >= rules.damagePct) {
      add(
        `damage-${sku.sku}`,
        label,
        'Damage rate',
        `${damaged} of ${received} received units damaged, ${pct(damaged, received)}%`,
        'Inspect packaging and re-slot away from heavy traffic',
        damaged * cost,
      );
    }

    if (sku.days_to_expiry != null && sku.days_to_expiry !== '') {
      const days = Number(sku.days_to_expiry);
      const unsold = Math.round(Number(sku.counted_qty) - (Number(sku.weekly_sales_units) * days) / 7);
      if (days <= rules.expiryDays && unsold > 0) {
        add(
          `expiry-${sku.sku}`,
          label,
          'Expiry risk',
          `${unsold} units will not sell before expiry in ${days} days`,
          'Mark down now to sell through',
          unsold * cost,
        );
      }
    }
  }

  for (const vendor of vendors) {
    const slug = String(vendor.vendor).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const received = Number(vendor.units_received_28d);
    const cost = Number(vendor.avg_unit_cost);
    const arrivedDamaged = Number(vendor.damaged_on_arrival_units);
    const short = Number(vendor.short_shipped_units);
    if (received > 0 && pct(arrivedDamaged, received) >= rules.doaPct) {
      add(
        `arrival-${slug}`,
        vendor.vendor,
        'Arrives damaged',
        `${arrivedDamaged} of ${received} units arrived damaged, ${pct(arrivedDamaged, received)}%`,
        'File a credit claim and require photos at receiving',
        arrivedDamaged * cost,
      );
    }
    if (received > 0 && pct(short, received) >= rules.shortPct) {
      add(
        `short-${slug}`,
        vendor.vendor,
        'Short shipments',
        `${short} of ${received} units short shipped, ${pct(short, received)}%`,
        'Switch this vendor to blind receiving counts',
        short * cost,
      );
    }
  }

  for (const spot of spots) {
    if (!spot.flagged) continue;
    const slug = `${spot.location}-${spot.shift}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    add(
      `hotspot-${slug}`,
      `${spot.location}, ${spot.shift} shift`,
      'Hot spot',
      `${spot.incidents} incidents and ${spot.units} units lost in the same place on the same shift`,
      'Check staffing, cameras and handling on this shift',
      spot.value,
    );
  }

  return queue.sort((a, b) => b.value_at_stake - a.value_at_stake);
}

export function actionSummary(queue) {
  return {
    open_actions: queue.length,
    high_priority: queue.filter((action) => action.priority === 'High').length,
    value_at_stake: queue.reduce((total, action) => total + action.value_at_stake, 0),
  };
}

// Logged incidents change the picture: damage adds to a SKU's damaged units,
// and a known loss (theft, empty package) comes off what is on the shelf.
// A loss logged before the SKU's latest count is already in that count, so it is skipped.
export function applyIncidents(skus, incidents) {
  return skus.map((sku) => {
    let damaged = 0;
    let lost = 0;
    for (const incident of incidents) {
      if (incident.sku !== sku.sku) continue;
      if (incident.type === 'Damage') damaged += Number(incident.units);
      else if (!sku.counted_at || String(incident.at) > String(sku.counted_at)) lost += Number(incident.units);
    }
    if (!damaged && !lost) return sku;
    return {
      ...sku,
      damaged_units_28d: Number(sku.damaged_units_28d) + damaged,
      counted_qty: Math.max(0, Number(sku.counted_qty) - lost),
    };
  });
}

// Where and when loss clusters: incidents grouped by location and shift.
export function hotSpots(incidents, skus, rules = RULES) {
  const bySku = new Map(skus.map((sku) => [sku.sku, sku]));
  const groups = new Map();
  for (const incident of incidents) {
    const sku = bySku.get(incident.sku);
    if (!sku) continue;
    const key = `${sku.location}|${incident.shift}`;
    const group = groups.get(key) || { location: sku.location, shift: incident.shift, incidents: 0, units: 0, value: 0 };
    group.incidents += 1;
    group.units += Number(incident.units);
    group.value += Number(incident.units) * Number(sku.unit_cost);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, value: Math.round(group.value), flagged: group.incidents >= rules.hotSpotIncidents }))
    .sort((a, b) => b.incidents - a.incidents || b.value - a.value);
}

// Closing the loop. An action marked done is not counted as fixed until new data
// stops triggering its rule. `done` maps action id -> { at, value, item, trigger }.
export function reviewQueue(queue, done = {}) {
  const live = new Set(queue.map((action) => action.id));
  const resolved = Object.entries(done)
    .filter(([id]) => !live.has(id))
    .map(([id, record]) => ({ id, ...record }));
  return {
    open: queue.filter((action) => !done[action.id]),
    waiting: queue.filter((action) => done[action.id]),
    resolved,
    recovered_value: resolved.reduce((total, record) => total + Number(record.value || 0), 0),
  };
}

// A ready-to-send credit claim for a vendor action, built from the same evidence.
export function claimDraft(action) {
  const kind = action.trigger === 'Short shipments' ? 'short shipments' : 'product damaged on arrival';
  return [
    `Subject: Credit claim for ${kind}`,
    '',
    `Hello ${action.item} team,`,
    '',
    `Over the last 28 days, ${action.evidence}.`,
    `We are requesting a credit of $${action.value_at_stake.toLocaleString('en-US')} for the affected units, valued at our average unit cost.`,
    '',
    'Receiving records and photos are available on request. Please confirm the credit, or tell us what else you need, within 10 business days.',
    '',
    'Thank you,',
    '[Your name]',
    '[Store name]',
  ].join('\n');
}
