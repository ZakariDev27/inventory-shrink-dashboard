import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULES, kpis, topCause, skuRisk, vendorScores, actions, actionSummary, applyIncidents, hotSpots, reviewQueue, claimDraft } from '../src/rules.js';

// The sample files have no quoted commas, so a plain split is enough here.
const csv = (name) => {
  const [head, ...lines] = readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((cell, i) => [cols[i], cell])));
};

const weekly = csv('sample_weekly.csv');
const causes = csv('sample_causes.csv');
const skus = csv('sample_skus.csv');
const vendors = csv('sample_vendors.csv');
const incidents = csv('sample_incidents.csv');

test('kpis compare the latest 4 weeks with the 4 before', () => {
  assert.deepEqual(kpis(weekly), {
    shrink_pct: 1.83,
    shrink_change_pts: 0.15,
    damage_pct: 0.74,
    damage_change_pts: 0.05,
    loss_value: 20660,
    loss_change_pct: 12.8,
  });
});

test('kpis need at least 8 weeks', () => {
  assert.equal(kpis(weekly.slice(0, 7)), null);
});

test('causes add up to the weekly loss and the top cause is found', () => {
  const total = causes.reduce((t, c) => t + Number(c.loss_value), 0);
  assert.equal(total, kpis(weekly).loss_value);
  assert.deepEqual(topCause(causes), { cause: 'External theft', type: 'Shrink', loss_value: 5730, share_pct: 27.7 });
});

test('sku risk is sorted by loss value', () => {
  const risk = skuRisk(skus);
  assert.equal(risk.length, 14);
  assert.equal(risk[0].sku, 'EL-1042');
  assert.equal(risk[0].variance_pct, 13.3);
  for (let i = 1; i < risk.length; i++) assert.ok(risk[i - 1].loss_value >= risk[i].loss_value);
});

test('vendor scores flag the right vendors', () => {
  const flagged = vendorScores(vendors)
    .filter((v) => v.doa_pct >= RULES.doaPct || v.short_pct >= RULES.shortPct)
    .map((v) => v.vendor)
    .sort();
  assert.deepEqual(flagged, ['Brightside Home', 'Harbor Foods', 'Meridian Apparel', 'Northline Electronics']);
});

test('action queue applies every rule', () => {
  const queue = actions(skus, vendors);
  const ids = queue.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(queue[0].id, 'count-EL-1042');
  assert.equal(queue[0].value_at_stake, 992);
  assert.ok(ids.includes('expiry-GR-3044'));
  assert.ok(ids.includes('damage-HG-4009'));
  assert.ok(ids.includes('arrival-brightside-home'));
  assert.ok(ids.includes('short-northline-electronics'));
  assert.ok(!ids.includes('count-EL-1107'), 'under the variance threshold');
  const tablet = queue.find((a) => a.id === 'count-EL-1210');
  assert.match(tablet.action, /locked cage/);
  const summary = actionSummary(queue);
  assert.equal(summary.open_actions, queue.length);
  assert.equal(summary.high_priority, queue.filter((a) => a.value_at_stake >= RULES.highValue).length);
});

test('stricter thresholds produce fewer actions', () => {
  const strict = actions(skus, vendors, { ...RULES, variancePct: 50, damagePct: 50, doaPct: 50, shortPct: 50, expiryDays: 0 });
  assert.equal(strict.length, 0);
});

test('incidents add damage and take known losses off the shelf', () => {
  const after = applyIncidents(skus, incidents);
  const plates = after.find((s) => s.sku === 'HG-4009');
  assert.equal(plates.damaged_units_28d, 16);
  const earbuds = after.find((s) => s.sku === 'EL-1042');
  assert.equal(earbuds.counted_qty, 101);
  assert.equal(after.find((s) => s.sku === 'AP-5020'), skus.find((s) => s.sku === 'AP-5020'), 'untouched SKUs are returned as is');
});

test('a loss logged before the latest count is not applied twice', () => {
  const counted = skus.map((s) => (s.sku === 'EL-1042' ? { ...s, counted_qty: 100, counted_at: '2026-11-16T00:00:00Z' } : s));
  assert.equal(applyIncidents(counted, incidents).find((s) => s.sku === 'EL-1042').counted_qty, 100);
  const later = [...incidents, { at: '2026-11-17T00:00:00Z', sku: 'EL-1042', type: 'Shrink', units: 2, shift: 'Morning' }];
  assert.equal(applyIncidents(counted, later).find((s) => s.sku === 'EL-1042').counted_qty, 98);
});

test('hot spots group incidents by location and shift', () => {
  const spots = hotSpots(incidents, skus);
  assert.deepEqual(spots[0], { location: 'Aisle 9', shift: 'Overnight', incidents: 4, units: 6, value: 127, flagged: true });
  assert.deepEqual(spots.filter((s) => s.flagged).map((s) => `${s.location} ${s.shift}`), ['Aisle 9 Overnight', 'Aisle 14 Afternoon']);
  const queue = actions(applyIncidents(skus, incidents), vendors, RULES, spots);
  assert.ok(queue.some((a) => a.id === 'hotspot-aisle-9-overnight'));
});

test('an action counts as fixed only when its rule stops triggering', () => {
  const queue = actions(skus, vendors);
  const done = { 'count-EL-1042': { at: '2026-11-18', value: 992, item: 'EL-1042 Wireless earbuds', trigger: 'Count variance' } };
  const before = reviewQueue(queue, done);
  assert.equal(before.waiting.length, 1);
  assert.equal(before.resolved.length, 0);
  assert.equal(before.open.length, queue.length - 1);
  const recounted = skus.map((s) => (s.sku === 'EL-1042' ? { ...s, counted_qty: 120 } : s));
  const after = reviewQueue(actions(recounted, vendors), done);
  assert.equal(after.waiting.length, 0);
  assert.equal(after.resolved.length, 1);
  assert.equal(after.recovered_value, 992);
});

test('claim draft carries the evidence and the amount', () => {
  const claim = actions(skus, vendors).find((a) => a.id === 'arrival-brightside-home');
  const text = claimDraft(claim);
  assert.match(text, /Brightside Home/);
  assert.match(text, /19 of 320 units arrived damaged/);
  assert.match(text, /\$437/);
});
