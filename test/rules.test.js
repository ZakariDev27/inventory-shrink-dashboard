import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULES, kpis, topCause, skuRisk, vendorScores, actions, actionSummary } from '../src/rules.js';

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
