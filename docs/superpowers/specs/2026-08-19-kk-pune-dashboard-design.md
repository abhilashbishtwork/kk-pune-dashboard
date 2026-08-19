# KK Pune Dashboard — Design Spec

Date: 2026-08-19
Owner: Abhilash Bisht (Growth Head, Curefoods)
Audience: Pune KK ground team (no Google login assumed)
Timeframe: first draft for a 15-day aggressive Pune push, iterate from there

## 1. Purpose

A single-page, Pune-only, no-login dashboard covering all 13 live Krispy
Kreme Pune stores: revenue (online + offline), ratings, and
Swiggy/Zomato/Google storefront operational metrics (availability,
serviceability, KPT, cancellation %). It must clearly call out what is
*not working* at the store level, not just report numbers. Nothing about
any other city or brand appears anywhere in it.

This is explicitly a first draft — several inputs are manual today and
are expected to become automated over time; the design should not need
to be reworked when that happens (see §6).

## 2. Store roster (static, hardcoded)

13 stores, keyed by the UrbanPiper (`store_name` in ClickHouse) name,
each mapped to a display name and one of three categories:

| UP Name (ClickHouse store_name) | Display Name | Category |
|---|---|---|
| PNQ KK Tribeca | PNQ Tribeca | Offline |
| PNQ KK Amanora | PNQ Amanora Mall | Offline |
| PNQ KK Pimpri | PNQ Pimpri | Cfi |
| PNQ KK Kothrud | PNQ Kothrud | Cfi |
| PNQ KK Viman Nagar | PNQ Viman Nagar | Cfi |
| PNQ KK Wagholi | PNQ Wagholi | Cfi |
| KK Ravet Cloud | PNQ Ravet | Cfi |
| PNQ KK Dhanori | PNQ KK Dhanori | Rebel |
| PNQ KK Hinjewadi | PNQ KK Hinjewadi | Rebel |
| PNQ KK Law College | PNQ KK Law College | Rebel |
| PNQ KK Sangvi | PNQ KK Sangvi | Rebel |
| PNQ KK Niyati Plaza | PNQ KK Niyati Plaza | Offline |
| PNQ KK FB Baner | KK FB Baner | Offline |

Categories: **Cfi** = Curefoods-owned/operated (5), **Rebel** = franchise
partner-operated (4), **Offline** = dine-in/dining-format stores (4).
Confirmed correct by user, including Ravet (cloud kitchen format) as Cfi.

`launch_date` per store is **not** hardcoded — it is computed as
`MIN(created_at_ist)` for that store_name from ClickHouse during the
daily build, across all channels. This makes newly launched stores
(e.g. Ravet, live only a few days as of this writing) self-correcting:
no manual maintenance, and no false "zero revenue" alerts for dates
before a store existed.

## 3. Data domains & sources

| Domain | Source | Refresh |
|---|---|---|
| Online revenue (Swiggy/Zomato/Ownly) | ClickHouse `orders`, `brand_id=95469015`, `store_name` IN (13 UP names), `channel` IN ('swiggy','zomato','ownly') | Daily local pull |
| Offline/dine-in revenue | Same ClickHouse table, `channel='pos'` | Daily local pull |
| Store `launch_date` | `MIN(created_at_ist)` per store_name, ClickHouse | Daily local pull |
| Availability %, Serviceability %, KPT, Cancellation % | Manual entry, per store × platform (Swiggy/Zomato/Google) × day, in a Google Sheet ops maintains | Live read, client-side, on every page load |
| Ratings (Swiggy/Zomato/Google) | Same Sheet, per store × platform, with a last-updated date | Live read, client-side, on every page load |

Revenue formula (validated, reused from prior work):
`sub_total_amount − (discount − aggregator_discount) + charges`,
cancelled/rejected orders excluded via a join on
`orders_state_transitions` keyed on `(brand_id, order_id)` together
(never `order_id` alone — collides across brands).

All ClickHouse date logic uses explicit `Asia/Kolkata` — never bare
`toDateTime()`/`today()`, which resolve in server UTC.

**Full-day-only rule**: the current in-progress day never appears as a
completed point in any trend — it's either omitted or visibly labeled
partial, per standing project convention.

Storefront ops metrics (availability/serviceability/KPT/cancellation %)
and all three platforms' ratings are sourced from manual exports today,
by explicit user decision — even though cancellation % could in
principle be computed from ClickHouse `orders_state_transitions`, the
manually-entered number is what the ground team already sees on the
Swiggy/Zomato partner apps and acts on, so it is kept as the single
source of truth for that section rather than introducing a second,
subtly different number.

## 4. Architecture

**Static site on GitHub Pages** — chosen specifically because it is the
only option that gives genuine no-login access. (A GAS web app was
considered and rejected: Curefoods Workspace admin policy has
previously blocked anonymous `/exec` access even with the manifest set
to allow it, which would defeat the "ground team, no login" requirement
outright.)

- New repo `kk-pune-dashboard`, hosted at
  `abhilashbishtwork.github.io/kk-pune-dashboard/` (same convention as
  the Kancha app and the Curefoods website rebuild).
- A local Python build script (same shape as the Bengaluru Order Map's
  `refresh_and_deploy.sh`) runs once daily via `launchd`:
  1. Pulls ClickHouse (revenue, offline/POS, launch dates)
  2. Writes a `data.json`
  3. Commits and pushes to the Pages repo
  - Includes a sanity guard: abort (keep yesterday's `data.json`) if
    the pull returns implausibly few rows, so a bad query can't wipe
    the dashboard.
- The manual-entry Google Sheet is Published to the Web as CSV. The
  static page fetches that CSV directly, client-side, on every load —
  so ops edits to availability/serviceability/KPT/cancellation/ratings
  show up immediately with no rebuild required.
- **Known limitation**: the daily ClickHouse refresh depends on a
  laptop-based `launchd` cron (same as other live dashboards today,
  e.g. the Bengaluru Order Map). Acceptable for a 15-day sprint;
  flaggable later for the same kind of cloud migration already planned
  for the Sharief trackers.

## 5. Dashboard layout

1. **Header** — "Krispy Kreme · Pune", 13 stores, last-refresh
   timestamps for both the revenue build and the ops Sheet.
2. **Revenue** — daily/WTD/MTD trend, split online (by platform) vs.
   offline, and by store category; plus a per-store table.
3. **Ratings grid** — store × platform (Swiggy/Zomato/Google).
4. **Storefront ops grid** — store × platform: availability %,
   serviceability %, KPT, cancellation %.
5. **Alerts / "what's not working"** — auto-flagged list, default
   thresholds (tune after seeing live data):
   - Availability < 90%
   - Serviceability < 90%
   - Cancellation > 5%
   - Rating < 4.0
   - Zero revenue for a store on a date on/after its `launch_date`
   - Manual ops/ratings data stale (no update) for > 3 days
6. **Category filter** — Cfi / Rebel / Offline, applied across all
   sections above.

Light mode only, no dark-mode/theme toggle, per standing preference.

## 6. Path to automation (not built now, designed for)

The manual Sheet is the only piece expected to change. Each metric
column is scoped so a future automated feed (Swiggy/Zomato/Google
partner APIs, if/when available) can replace the manual entries without
changing the dashboard's read side — it reads "current value + last
updated date" per store × platform × metric regardless of how that
value got there.

## 7. Error handling

- Bad/short ClickHouse pull → keep prior `data.json`, don't overwrite.
- Ops Sheet CSV fetch fails client-side → ops/ratings sections show
  "unavailable," revenue section still renders normally.
- Today (partial day) never rendered as a finished trend point.
- Store-level alerts suppressed for any date before that store's
  `launch_date`.

## 8. Testing / verification

- Spot-check ClickHouse revenue totals for a known recent day against
  the existing national KK online dashboard's numbers.
- Confirm all 13 UP store_name values are unique in ClickHouse with no
  store-name/brand collisions before trusting the per-store split.
- Verify the Sheet's Publish-to-Web CSV URL is genuinely fetchable with
  no auth prompt, from an unauthenticated browser session.
- Manual QA of the page on both mobile and desktop widths (ground team
  is likely mobile-first).
- Confirm end-to-end no-login access on the live GitHub Pages URL.

## 9. Open items deferred, not blocking this draft

- Exact alert thresholds — defaults above, to be tuned once real data
  is visible.
- Cloud-hosted (non-laptop-dependent) daily refresh — later migration,
  same as the Sharief trackers.
