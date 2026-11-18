# Inventory shrink and damage dashboard

A dashboard for a store or warehouse that tracks shrink (unexplained inventory loss) and damaged product, and runs a small rules engine that turns the numbers into a prioritised list of actions.

**Live demo:** https://zakaridev27.github.io/inventory-shrink-dashboard/

> The dashboard starts with sample data for a fictional store. Add your own counts, incidents, deliveries and SKUs on the page.

## What it does

- **Put information in**: log a damage or theft incident, enter a cycle count, log a vendor delivery, or add a SKU. Everything updates straight away.
- **Automated action queue**: every SKU, vendor and shift is checked against thresholds; each breach becomes an action with a recommended next step and the dollar value at stake.
- **Follow-up that checks itself**: marking an action done does not close it. It stays in the queue as waiting until new counts or deliveries stop triggering the rule, and only then moves to "Confirmed fixed".
- **Hot spots**: incidents are grouped by location and shift, so repeat problems in the same aisle on the same shift stand out and get their own action.
- **Credit claim drafts**: one click turns a vendor action into a ready-to-send claim with the evidence and the amount.
- **Tunable rules**: change any threshold on the page and the queue is worked out again.
- **Headline figures and charts**: shrink rate, damage rate and loss value for the last 4 weeks against the 4 before, a weekly trend and loss by cause (sample history).
- **SKU table and vendor scorecard**.

## Where your data lives

Entries are saved in your browser's local storage, on your device only. Nothing is sent to a server. Use **Export backup** to save a file and **Import backup** to load it on another device. Clearing site data erases your entries.

## The rules

| Rule | Triggers when | Action |
|---|---|---|
| Count variance | SKU is missing 3% or more of its system count | Recount, hold adjustments for sign-off (locked cage if a unit costs $150 or more) |
| Damage rate | 2% or more of received units damaged | Inspect packaging, re-slot |
| Expiry risk | Within 14 days of expiry and will not sell in time | Mark down |
| Arrives damaged | Vendor has 3% or more of units damaged on arrival | Credit claim, photos at receiving |
| Short shipments | Vendor short by 2% or more of units | Blind receiving counts |
| Hot spot | 3 or more incidents in one location on one shift | Check staffing, cameras and handling |

Priority is High at $600 or more at stake, Medium at $200 or more. All thresholds are in one object, `RULES`, at the top of [`src/rules.js`](src/rules.js). They are starting values, not industry standards: tune them on the page or in the file.

## Run it

No build step and no network dependencies: D3 is bundled in `vendor/`. The page reads the CSV files with `fetch`, so it has to be served over http:

```bash
npm start        # python3 -m http.server 8080
# open http://localhost:8080
```

It also works as-is on GitHub Pages (Settings → Pages → deploy from the `main` branch root).

## Test it

```bash
npm test         # node --test, needs Node 20+
```

The tests run the rules engine against the sample files: metrics, every rule, incidents, hot spots, the follow-up check and claim drafts.

## Layout

```
index.html          page structure and all fixed text
styles.css          light and dark theme
src/rules.js        metrics and rules engine: pure functions, no DOM
src/app.js          loads the sample CSVs, keeps your entries, handles the forms, draws charts and tables
data/*.csv          sample data
vendor/d3.min.js    D3 v7 (ISC license, see vendor/d3-LICENSE)
test/rules.test.js  tests for rules.js
```

`rules.js` knows nothing about the page, so the same functions can run on a server, in a scheduled job that emails the action queue, or behind an API.

## Change the starting data

The page starts from the CSV files in `data/`. Keep the column names and replace the rows:

| File | Columns |
|---|---|
| `sample_weekly.csv` | `week_start, sales_value, shrink_value, damage_value` |
| `sample_causes.csv` | `cause, type, loss_value` (`type` is `Shrink` or `Damage`) |
| `sample_skus.csv` | `sku, product, category, vendor, location, unit_cost, system_qty, counted_qty, received_28d, damaged_units_28d, weekly_sales_units, days_to_expiry` |
| `sample_vendors.csv` | `vendor, units_received_28d, damaged_on_arrival_units, short_shipped_units, avg_unit_cost, open_claims_value` |
| `sample_incidents.csv` | `at, sku, type, units, cause, shift, note` |

## Ideas for next steps

- Move storage from the browser to an API backed by PostgreSQL, so a team shares one set of data.
- Feed logged incidents into the weekly trend and loss-by-cause charts.
- Run the rules on a schedule and notify the owner of each High priority action.
- Filter by location, category and vendor.
