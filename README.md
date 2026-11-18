# Inventory shrink and damage dashboard

A dashboard for a store or warehouse that tracks shrink (unexplained inventory loss) and damaged product, and runs a small rules engine that turns the numbers into a prioritised list of actions.

> All data in `data/` is sample data for a fictional store. Swap in your own exports to use it for real.

## What it does

- **Headline figures**: shrink rate, damage rate and loss value for the last 4 weeks, each against the 4 weeks before.
- **Weekly trend**: shrink and damage as a share of sales.
- **Loss by cause**: theft, receiving errors, handling damage, damaged on arrival and so on.
- **Automated action queue**: every SKU and vendor is checked against thresholds; each breach becomes an action with a recommended next step and the value at stake.
- **SKU table**: the SKUs losing the most, with count variance and damage rate.
- **Vendor scorecard**: share of each vendor's units that arrived damaged or short, and open credit claims.

## The rules

| Rule | Triggers when | Action |
|---|---|---|
| Count variance | SKU is missing 3% or more of its system count | Recount, hold adjustments for sign-off (locked cage if a unit costs $150 or more) |
| Damage rate | 2% or more of received units damaged | Inspect packaging, re-slot |
| Expiry risk | Within 14 days of expiry and will not sell in time | Mark down |
| Arrives damaged | Vendor has 3% or more of units damaged on arrival | Credit claim, photos at receiving |
| Short shipments | Vendor short by 2% or more of units | Blind receiving counts |

Priority is High at $600 or more at stake, Medium at $200 or more. All thresholds are in one object, `RULES`, at the top of [`src/rules.js`](src/rules.js). They are starting values, not industry standards: tune them to your own store.

## Run it

No build step. The page loads D3 from a CDN and reads the CSV files with `fetch`, so it has to be served over http:

```bash
npm start        # python3 -m http.server 8080
# open http://localhost:8080
```

It also works as-is on GitHub Pages (Settings → Pages → deploy from the `main` branch root).

## Test it

```bash
npm test         # node --test, needs Node 20+
```

The tests run the rules engine against the sample files.

## Layout

```
index.html          page structure and all fixed text
styles.css          light and dark theme
src/rules.js        metrics and rules engine: pure functions, no DOM
src/app.js          loads the CSVs, calls rules.js, draws charts and tables
data/*.csv          sample data
test/rules.test.js  tests for rules.js
```

`rules.js` knows nothing about the page, so the same functions can run on a server, in a scheduled job that emails the action queue, or behind an API.

## Use your own data

Keep the column names and replace the rows:

| File | Columns |
|---|---|
| `sample_weekly.csv` | `week_start, sales_value, shrink_value, damage_value` |
| `sample_causes.csv` | `cause, type, loss_value` (`type` is `Shrink` or `Damage`) |
| `sample_skus.csv` | `sku, product, category, vendor, location, unit_cost, system_qty, counted_qty, received_28d, damaged_units_28d, weekly_sales_units, days_to_expiry` |
| `sample_vendors.csv` | `vendor, units_received_28d, damaged_on_arrival_units, short_shipped_units, avg_unit_cost, open_claims_value` |

## Ideas for next steps

- Replace the CSVs with an API backed by PostgreSQL.
- Let users mark actions as done and keep an audit log.
- Run the rules on a schedule and notify the owner of each High priority action.
- Filter by location, category and vendor.
