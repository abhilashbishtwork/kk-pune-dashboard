# KK Pune Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a no-login, Pune-only static dashboard covering revenue (online + dine-in), ratings, and Swiggy/Zomato/Google storefront ops metrics for all 13 live Krispy Kreme Pune stores, refreshed daily, with an auto-generated "what's not working" alerts section.

**Architecture:** A static site on GitHub Pages (`kk-pune-dashboard` repo) whose page fetches two things at load time: a `data.json` built once daily by a local Python script pulling ClickHouse (revenue, dine-in, launch dates), and a live CSV export of a Google Sheet ops maintains (availability/serviceability/KPT/cancellation/ratings). Pure computation (query building, aggregation, sanity checks, alert thresholds) is split into small testable functions; DOM rendering and the ClickHouse network call are thin, manually-verified glue.

**Tech Stack:** Python 3 (build script, pytest), vanilla JS/HTML/CSS (no framework, no build step), ClickHouse over HTTP via `curl`, Google Sheets published-CSV export, GitHub Pages, `launchd` for daily scheduling.

**Spec:** `docs/superpowers/specs/2026-08-19-kk-pune-dashboard-design.md`

## Global Constraints

- Light mode only — no dark mode, no theme toggle, no `prefers-color-scheme` media query.
- The current in-progress day is never shown as a completed point in any revenue trend (full-day-only rule).
- Any ClickHouse date/time logic uses explicit `Asia/Kolkata` — never bare `toDateTime()`/`today()`.
- Any join or lookup against `orders_state_transitions` uses `(brand_id, order_id)` together — never `order_id` alone.
- `brand_id` for Krispy Kreme is `95469015`.
- Store `launch_date` is computed as `MIN(created_at_ist)` per store from ClickHouse — never hardcoded.
- The store's ownership `category` (Cfi / Rebel / Offline) is a separate dimension from the online-vs-dine-in revenue split — a store's `category` never gates which revenue rows it has.
- The GitHub repo backing this dashboard is public (required for free GitHub Pages) — the ClickHouse password must never be committed to it. It lives only in a local, gitignored `.env` file.
- All 13 stores are matched by their exact ClickHouse `store_name` (the "UP Name" in the spec's roster table).

---

### Task 1: Project scaffolding + GitHub repo/Pages

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `build/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `index.html` (placeholder)

**Interfaces:**
- Produces: a `PYTHONPATH`-independent test setup — any file under `tests/` can `import build.<module>` when run via `pytest` from the repo root, because `tests/conftest.py` inserts the repo root onto `sys.path`.

- [ ] **Step 1: Write `.gitignore`**

```
.env
__pycache__/
*.pyc
.DS_Store
node_modules/
logs/
```

- [ ] **Step 2: Write `tests/conftest.py`**

```python
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
```

- [ ] **Step 3: Create empty package markers**

```bash
touch build/__init__.py tests/__init__.py
```

- [ ] **Step 4: Write a placeholder `index.html`**

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Krispy Kreme · Pune</title></head>
<body><p>KK Pune dashboard — under construction.</p></body>
</html>
```

- [ ] **Step 5: Write `README.md`**

```markdown
# KK Pune Dashboard

No-login, Pune-only dashboard for Krispy Kreme's 13 live Pune stores:
revenue (online + dine-in), ratings, and Swiggy/Zomato/Google storefront
ops metrics. Refreshed daily. See `docs/superpowers/specs/` for the
design spec and `docs/superpowers/plans/` for the implementation plan.

Live at: https://abhilashbishtwork.github.io/kk-pune-dashboard/
```

- [ ] **Step 6: Create the GitHub repo and push**

```bash
gh auth status
gh repo create abhilashbishtwork/kk-pune-dashboard --public --source=. --remote=origin
git branch -M main
git add -A
git commit -m "Scaffold KK Pune dashboard project

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -u origin main
```

- [ ] **Step 7: Enable GitHub Pages on the repo (serve from `main` branch root)**

```bash
gh api repos/abhilashbishtwork/kk-pune-dashboard/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

- [ ] **Step 8: Verify Pages is live**

```bash
sleep 30
curl -sI https://abhilashbishtwork.github.io/kk-pune-dashboard/ | head -1
```
Expected: `HTTP/2 200` (Pages can take ~1 minute to first-deploy; retry once if 404).

---

### Task 2: Store roster (`build/stores.py`)

**Files:**
- Create: `build/stores.py`
- Test: `tests/test_stores.py`

**Interfaces:**
- Produces: `STORE_ROSTER: list[dict]` (each dict has `up_name`, `display_name`, `category`), `CATEGORIES: tuple[str, ...]`, `up_names() -> list[str]`, `display_name_for(up_name: str) -> str | None`, `category_for(up_name: str) -> str | None`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_stores.py
from build.stores import STORE_ROSTER, CATEGORIES, up_names, display_name_for, category_for


def test_thirteen_stores():
    assert len(STORE_ROSTER) == 13


def test_up_names_unique():
    names = up_names()
    assert len(names) == len(set(names))


def test_all_categories_valid():
    assert all(s["category"] in CATEGORIES for s in STORE_ROSTER)


def test_display_name_for_known_store():
    assert display_name_for("KK Ravet Cloud") == "PNQ Ravet"


def test_category_for_ravet_is_cfi():
    assert category_for("KK Ravet Cloud") == "Cfi"


def test_unknown_store_returns_none():
    assert display_name_for("Not A Store") is None
    assert category_for("Not A Store") is None


def test_category_counts_match_spec():
    counts = {}
    for s in STORE_ROSTER:
        counts[s["category"]] = counts.get(s["category"], 0) + 1
    assert counts == {"Offline": 4, "Cfi": 5, "Rebel": 4}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_stores.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.stores'`

- [ ] **Step 3: Write the implementation**

```python
# build/stores.py
"""Static store roster for the KK Pune dashboard.

Each store is keyed by its UrbanPiper name (the `store_name` value used
in ClickHouse `orders`), mapped to a display name and ownership category.
"""

CATEGORIES = ("Cfi", "Rebel", "Offline")

STORE_ROSTER = [
    {"up_name": "PNQ KK Tribeca", "display_name": "PNQ Tribeca", "category": "Offline"},
    {"up_name": "PNQ KK Amanora", "display_name": "PNQ Amanora Mall", "category": "Offline"},
    {"up_name": "PNQ KK Pimpri", "display_name": "PNQ Pimpri", "category": "Cfi"},
    {"up_name": "PNQ KK Kothrud", "display_name": "PNQ Kothrud", "category": "Cfi"},
    {"up_name": "PNQ KK Viman Nagar", "display_name": "PNQ Viman Nagar", "category": "Cfi"},
    {"up_name": "PNQ KK Wagholi", "display_name": "PNQ Wagholi", "category": "Cfi"},
    {"up_name": "KK Ravet Cloud", "display_name": "PNQ Ravet", "category": "Cfi"},
    {"up_name": "PNQ KK Dhanori", "display_name": "PNQ KK Dhanori", "category": "Rebel"},
    {"up_name": "PNQ KK Hinjewadi", "display_name": "PNQ KK Hinjewadi", "category": "Rebel"},
    {"up_name": "PNQ KK Law College", "display_name": "PNQ KK Law College", "category": "Rebel"},
    {"up_name": "PNQ KK Sangvi", "display_name": "PNQ KK Sangvi", "category": "Rebel"},
    {"up_name": "PNQ KK Niyati Plaza", "display_name": "PNQ KK Niyati Plaza", "category": "Offline"},
    {"up_name": "PNQ KK FB Baner", "display_name": "KK FB Baner", "category": "Offline"},
]


def up_names():
    return [s["up_name"] for s in STORE_ROSTER]


def display_name_for(up_name):
    for s in STORE_ROSTER:
        if s["up_name"] == up_name:
            return s["display_name"]
    return None


def category_for(up_name):
    for s in STORE_ROSTER:
        if s["up_name"] == up_name:
            return s["category"]
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_stores.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add build/stores.py tests/test_stores.py
git commit -m "Add static KK Pune store roster"
```

---

### Task 3: ClickHouse query builders (`build/queries.py`)

**Files:**
- Create: `build/queries.py`
- Test: `tests/test_queries.py`

**Interfaces:**
- Consumes: nothing (pure string builders; caller supplies `store_names: list[str]`, `start_date`/`end_date` as `date` objects).
- Produces: `BRAND_ID = 95469015`, `build_online_revenue_query(store_names, start_date, end_date) -> str`, `build_dine_in_revenue_query(store_names, start_date, end_date) -> str`, `build_launch_date_query(store_names) -> str`. Each returns a SQL string ending in `FORMAT TabSeparatedWithNames`, whose result columns match what `build/aggregate.py` (Task 5) expects: online → `order_date, store_name, channel, revenue`; dine-in → `order_date, store_name, revenue`; launch dates → `store_name, launch_date`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_queries.py
from datetime import date
from build.queries import (
    BRAND_ID,
    build_online_revenue_query,
    build_dine_in_revenue_query,
    build_launch_date_query,
)

STORES = ["PNQ KK Pimpri", "KK Ravet Cloud"]
START = date(2026, 8, 1)
END = date(2026, 8, 19)


def test_online_query_includes_brand_and_stores():
    sql = build_online_revenue_query(STORES, START, END)
    assert f"brand_id = {BRAND_ID}" in sql
    assert "'PNQ KK Pimpri'" in sql
    assert "'KK Ravet Cloud'" in sql


def test_online_query_filters_online_channels_only():
    sql = build_online_revenue_query(STORES, START, END)
    assert "channel IN ('swiggy', 'zomato', 'ownly')" in sql


def test_online_query_excludes_cancelled_via_state_transitions():
    sql = build_online_revenue_query(STORES, START, END)
    assert "orders_state_transitions" in sql
    assert "'Cancelled', 'customer_cancelled'" in sql
    assert "t.brand_id = " in sql and "t.order_id = o.id" in sql


def test_dine_in_query_filters_pos_channel():
    sql = build_dine_in_revenue_query(STORES, START, END)
    assert "channel = 'pos'" in sql
    assert "orders_state_transitions" not in sql


def test_launch_date_query_has_no_date_filter():
    sql = build_launch_date_query(STORES)
    assert "min(toDate(created_at_ist))" in sql
    assert "start_date" not in sql.lower()


def test_store_name_with_apostrophe_is_escaped():
    sql = build_launch_date_query(["O'Brien's Kitchen"])
    assert "'O''Brien''s Kitchen'" in sql


def test_all_queries_end_with_format_clause():
    assert build_online_revenue_query(STORES, START, END).endswith("FORMAT TabSeparatedWithNames")
    assert build_dine_in_revenue_query(STORES, START, END).endswith("FORMAT TabSeparatedWithNames")
    assert build_launch_date_query(STORES).endswith("FORMAT TabSeparatedWithNames")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_queries.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.queries'`

- [ ] **Step 3: Write the implementation**

```python
# build/queries.py
"""Pure SQL-string builders for the KK Pune ClickHouse pulls.

No network calls here — these functions only build query text so they
can be unit tested without a live database.
"""

BRAND_ID = 95469015


def _store_list_sql(store_names):
    return ", ".join("'" + name.replace("'", "''") + "'" for name in store_names)


def build_online_revenue_query(store_names, start_date, end_date):
    stores_sql = _store_list_sql(store_names)
    return f"""
        SELECT
            toDate(o.created_at_ist) AS order_date,
            o.store_name AS store_name,
            o.channel AS channel,
            sum(o.sub_total_amount - (o.discount - o.aggregator_discount) + o.charges) AS revenue
        FROM orders o
        LEFT JOIN (
            SELECT brand_id, order_id,
                   argMax(to_status, status_changed_at_ist) AS final_status
            FROM orders_state_transitions
            WHERE brand_id = {BRAND_ID}
            GROUP BY brand_id, order_id
        ) t ON t.brand_id = {BRAND_ID} AND t.order_id = o.id
        WHERE o.brand_id = {BRAND_ID}
          AND o.store_name IN ({stores_sql})
          AND o.channel IN ('swiggy', 'zomato', 'ownly')
          AND toDate(o.created_at_ist) >= toDate('{start_date}', 'Asia/Kolkata')
          AND toDate(o.created_at_ist) <= toDate('{end_date}', 'Asia/Kolkata')
          AND (t.final_status IS NULL OR t.final_status NOT IN ('Cancelled', 'customer_cancelled'))
        GROUP BY order_date, store_name, channel
        FORMAT TabSeparatedWithNames
    """.strip()


def build_dine_in_revenue_query(store_names, start_date, end_date):
    stores_sql = _store_list_sql(store_names)
    return f"""
        SELECT
            toDate(o.created_at_ist) AS order_date,
            o.store_name AS store_name,
            sum(o.sub_total_amount - (o.discount - o.aggregator_discount) + o.charges) AS revenue
        FROM orders o
        WHERE o.brand_id = {BRAND_ID}
          AND o.store_name IN ({stores_sql})
          AND o.channel = 'pos'
          AND toDate(o.created_at_ist) >= toDate('{start_date}', 'Asia/Kolkata')
          AND toDate(o.created_at_ist) <= toDate('{end_date}', 'Asia/Kolkata')
        GROUP BY order_date, store_name
        FORMAT TabSeparatedWithNames
    """.strip()


def build_launch_date_query(store_names):
    stores_sql = _store_list_sql(store_names)
    return f"""
        SELECT
            store_name AS store_name,
            min(toDate(created_at_ist)) AS launch_date
        FROM orders
        WHERE brand_id = {BRAND_ID}
          AND store_name IN ({stores_sql})
        GROUP BY store_name
        FORMAT TabSeparatedWithNames
    """.strip()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_queries.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add build/queries.py tests/test_queries.py
git commit -m "Add ClickHouse query builders for KK Pune revenue and launch dates"
```

---

### Task 4: ClickHouse client (`build/clickhouse_client.py`)

**Files:**
- Create: `build/clickhouse_client.py`
- Test: `tests/test_clickhouse_client.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parse_tsv_with_names(text: str) -> list[dict]` (unit tested directly), `run_query(sql: str, password: str) -> list[dict]` (wraps `curl`; not unit tested here — exercised for real in Task 7's manual verification and Task 12's end-to-end check).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_clickhouse_client.py
from build.clickhouse_client import parse_tsv_with_names


def test_parses_header_and_rows():
    text = "order_date\tstore_name\trevenue\n2026-08-18\tPNQ KK Pimpri\t1234.5\n2026-08-18\tPNQ KK Kothrud\t500\n"
    rows = parse_tsv_with_names(text)
    assert rows == [
        {"order_date": "2026-08-18", "store_name": "PNQ KK Pimpri", "revenue": "1234.5"},
        {"order_date": "2026-08-18", "store_name": "PNQ KK Kothrud", "revenue": "500"},
    ]


def test_empty_result_returns_empty_list():
    assert parse_tsv_with_names("") == []
    assert parse_tsv_with_names("order_date\tstore_name\trevenue\n") == []


def test_ignores_trailing_blank_line():
    text = "a\tb\n1\t2\n\n"
    rows = parse_tsv_with_names(text)
    assert rows == [{"a": "1", "b": "2"}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_clickhouse_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.clickhouse_client'`

- [ ] **Step 3: Write the implementation**

```python
# build/clickhouse_client.py
"""Thin ClickHouse HTTP client for the KK Pune build pipeline."""

import subprocess
from urllib.parse import quote

CLICKHOUSE_URL = "https://cfi-data-secure.urbanpiper.com:443/"
CLICKHOUSE_DATABASE = "curefoods_test"
CLICKHOUSE_USER = "curefoods"


def parse_tsv_with_names(text):
    """Parse ClickHouse `FORMAT TabSeparatedWithNames` output into dicts."""
    stripped = text.strip("\n")
    if not stripped:
        return []
    lines = stripped.split("\n")
    header = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        if line == "":
            continue
        values = line.split("\t")
        rows.append(dict(zip(header, values)))
    return rows


def run_query(sql, password):
    encoded_password = quote(password, safe="")
    result = subprocess.run(
        [
            "curl", "-sk", "--max-time", "30",
            f"{CLICKHOUSE_URL}?database={CLICKHOUSE_DATABASE}&user={CLICKHOUSE_USER}&password={encoded_password}",
            "--data", sql,
        ],
        capture_output=True, text=True, check=True,
    )
    return parse_tsv_with_names(result.stdout)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_clickhouse_client.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add build/clickhouse_client.py tests/test_clickhouse_client.py
git commit -m "Add ClickHouse HTTP client with TSV parsing"
```

---

### Task 5: Aggregation (`build/aggregate.py`)

**Files:**
- Create: `build/aggregate.py`
- Test: `tests/test_aggregate.py`

**Interfaces:**
- Consumes: `build.stores.STORE_ROSTER`; raw row lists shaped like the query results from Task 3/4 (`order_date`/`store_name`/`channel`/`revenue` as strings for online rows, `order_date`/`store_name`/`revenue` for dine-in rows, `store_name`/`launch_date` for launch-date rows).
- Produces: `build_dashboard_payload(online_rows, dine_in_rows, launch_date_rows, today_ist) -> dict` shaped as:
  ```
  {"stores": [
    {"up_name": str, "display_name": str, "category": str, "launch_date": str | None,
     "revenue": {
       "daily": [{"date": str, "online": {"swiggy": float, "zomato": float, "ownly": float}, "dine_in": float, "total": float}, ...],
       "wtd": {"online": float, "dine_in": float, "total": float},
       "mtd": {"online": float, "dine_in": float, "total": float}
     }}
  ]}
  ```
  This exact shape is consumed by Task 7 (which adds `generated_at_ist` at the top level before writing `data.json`) and by Task 9/10's JS (`alerts.js` and `dashboard.js`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_aggregate.py
from datetime import date
from build.aggregate import build_dashboard_payload


def test_daily_entry_sums_online_and_dine_in():
    online_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "1000"},
        {"order_date": "2026-08-17", "store_name": "PNQ KK Pimpri", "channel": "zomato", "revenue": "500"},
    ]
    dine_in_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Pimpri", "revenue": "200"},
    ]
    launch_date_rows = [{"store_name": "PNQ KK Pimpri", "launch_date": "2025-03-12"}]

    payload = build_dashboard_payload(online_rows, dine_in_rows, launch_date_rows, date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")

    assert pimpri["launch_date"] == "2025-03-12"
    assert len(pimpri["revenue"]["daily"]) == 1
    day = pimpri["revenue"]["daily"][0]
    assert day["date"] == "2026-08-17"
    assert day["online"] == {"swiggy": 1000.0, "zomato": 500.0, "ownly": 0.0}
    assert day["dine_in"] == 200.0
    assert day["total"] == 1700.0


def test_today_excluded_from_daily_full_day_rule():
    online_rows = [
        {"order_date": "2026-08-18", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "999"},
    ]
    payload = build_dashboard_payload(online_rows, [], [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    assert pimpri["revenue"]["daily"] == []


def test_store_with_no_rows_has_empty_daily_and_zero_totals():
    payload = build_dashboard_payload([], [], [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    assert pimpri["revenue"]["daily"] == []
    assert pimpri["revenue"]["wtd"] == {"online": 0.0, "dine_in": 0.0, "total": 0.0}
    assert pimpri["revenue"]["mtd"] == {"online": 0.0, "dine_in": 0.0, "total": 0.0}
    assert pimpri["launch_date"] is None


def test_mtd_only_sums_current_month():
    online_rows = [
        {"order_date": "2026-07-31", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "5000"},
        {"order_date": "2026-08-01", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "300"},
    ]
    payload = build_dashboard_payload(online_rows, [], [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    assert pimpri["revenue"]["mtd"]["total"] == 300.0


def test_all_thirteen_stores_present():
    payload = build_dashboard_payload([], [], [], date(2026, 8, 18))
    assert len(payload["stores"]) == 13
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_aggregate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.aggregate'`

- [ ] **Step 3: Write the implementation**

```python
# build/aggregate.py
"""Turn raw ClickHouse rows into the dashboard's per-store JSON payload."""

from datetime import timedelta

from build.stores import STORE_ROSTER


def _empty_channel_totals():
    return {"swiggy": 0.0, "zomato": 0.0, "ownly": 0.0}


def _sum_window(daily, start_date_str):
    online = 0.0
    dine_in = 0.0
    for d in daily:
        if d["date"] >= start_date_str:
            online += sum(d["online"].values())
            dine_in += d["dine_in"]
    return {"online": online, "dine_in": dine_in, "total": online + dine_in}


def build_dashboard_payload(online_rows, dine_in_rows, launch_date_rows, today_ist):
    launch_dates = {r["store_name"]: r["launch_date"] for r in launch_date_rows}
    today_str = str(today_ist)

    by_store_date = {}
    for r in online_rows:
        key = (r["store_name"], r["order_date"])
        entry = by_store_date.setdefault(key, {"online": _empty_channel_totals(), "dine_in": 0.0})
        entry["online"][r["channel"]] = entry["online"].get(r["channel"], 0.0) + float(r["revenue"])
    for r in dine_in_rows:
        key = (r["store_name"], r["order_date"])
        entry = by_store_date.setdefault(key, {"online": _empty_channel_totals(), "dine_in": 0.0})
        entry["dine_in"] += float(r["revenue"])

    complete_dates = sorted({d for (_, d) in by_store_date if d != today_str})

    wtd_start = str(today_ist - timedelta(days=today_ist.weekday()))
    mtd_start = str(today_ist.replace(day=1))

    stores_out = []
    for store in STORE_ROSTER:
        up_name = store["up_name"]
        daily = []
        for d in complete_dates:
            entry = by_store_date.get((up_name, d))
            if entry is None:
                continue
            total = sum(entry["online"].values()) + entry["dine_in"]
            daily.append({"date": d, "online": entry["online"], "dine_in": entry["dine_in"], "total": total})

        stores_out.append({
            "up_name": up_name,
            "display_name": store["display_name"],
            "category": store["category"],
            "launch_date": launch_dates.get(up_name),
            "revenue": {
                "daily": daily,
                "wtd": _sum_window(daily, wtd_start),
                "mtd": _sum_window(daily, mtd_start),
            },
        })

    return {"stores": stores_out}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_aggregate.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add build/aggregate.py tests/test_aggregate.py
git commit -m "Add aggregation from raw ClickHouse rows to dashboard payload"
```

---

### Task 6: Sanity guard (`build/sanity_guard.py`)

**Files:**
- Create: `build/sanity_guard.py`
- Test: `tests/test_sanity_guard.py`

**Interfaces:**
- Produces: `is_pull_valid(online_rows, dine_in_rows, launch_date_rows, expected_min_stores=13) -> bool`. Consumed by Task 7 to decide whether to write `data.json` or abort and keep the previous one.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_sanity_guard.py
from build.sanity_guard import is_pull_valid


def test_valid_pull_passes():
    online_rows = [{"store_name": "x"}]
    dine_in_rows = [{"store_name": "x"}]
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(13)]
    assert is_pull_valid(online_rows, dine_in_rows, launch_date_rows) is True


def test_too_few_stores_fails():
    online_rows = [{"store_name": "x"}]
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(10)]
    assert is_pull_valid(online_rows, [], launch_date_rows) is False


def test_no_online_rows_fails():
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(13)]
    assert is_pull_valid([], [{"store_name": "x"}], launch_date_rows) is False


def test_empty_dine_in_rows_does_not_fail_the_pull():
    online_rows = [{"store_name": "x"}]
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(13)]
    assert is_pull_valid(online_rows, [], launch_date_rows) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_sanity_guard.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.sanity_guard'`

- [ ] **Step 3: Write the implementation**

```python
# build/sanity_guard.py
"""Guard against a bad/short ClickHouse pull silently wiping the dashboard.

Dine-in rows are allowed to be empty (a pure-online store like a cloud
kitchen may genuinely have none) so only online rows and the launch-date
row count (one per store) gate validity.
"""


def is_pull_valid(online_rows, dine_in_rows, launch_date_rows, expected_min_stores=13):
    if len(launch_date_rows) < expected_min_stores:
        return False
    if len(online_rows) == 0:
        return False
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_sanity_guard.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add build/sanity_guard.py tests/test_sanity_guard.py
git commit -m "Add sanity guard for ClickHouse pulls"
```

---

### Task 7: Build orchestrator (`build/build_data.py`)

**Files:**
- Create: `build/build_data.py`
- Test: `tests/test_build_data.py`

**Interfaces:**
- Consumes: `build.stores.up_names`, `build.queries.{build_online_revenue_query, build_dine_in_revenue_query, build_launch_date_query}`, `build.clickhouse_client.run_query`, `build.aggregate.build_dashboard_payload`, `build.sanity_guard.is_pull_valid`.
- Produces: `run(query_runner: Callable[[str], list[dict]], today: date) -> bool` (returns `True` and writes `data.json` on success, `False` and leaves `data.json` untouched on a failed sanity check) — this indirection (`query_runner` as a parameter) is what makes the orchestrator testable without a live database. `main()` is the real entry point, reading `CLICKHOUSE_PASSWORD` from the environment and calling `run()` with the real `run_query`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_build_data.py
import json
from datetime import date

from build.build_data import run, DATA_JSON_PATH


def _fake_runner(online_rows, dine_in_rows, launch_date_rows):
    def runner(sql):
        if "orders_state_transitions" in sql:
            return online_rows
        if "channel = 'pos'" in sql:
            return dine_in_rows
        return launch_date_rows
    return runner


def test_run_writes_data_json_on_valid_pull(tmp_path, monkeypatch):
    fake_path = tmp_path / "data.json"
    monkeypatch.setattr("build.build_data.DATA_JSON_PATH", str(fake_path))

    online_rows = [{"order_date": "2026-08-17", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "100"}]
    launch_date_rows = [{"store_name": s, "launch_date": "2025-01-01"} for s in [
        "PNQ KK Tribeca", "PNQ KK Amanora", "PNQ KK Pimpri", "PNQ KK Kothrud",
        "PNQ KK Viman Nagar", "PNQ KK Wagholi", "KK Ravet Cloud", "PNQ KK Dhanori",
        "PNQ KK Hinjewadi", "PNQ KK Law College", "PNQ KK Sangvi",
        "PNQ KK Niyati Plaza", "PNQ KK FB Baner",
    ]]
    runner = _fake_runner(online_rows, [], launch_date_rows)

    result = run(runner, date(2026, 8, 18))

    assert result is True
    written = json.loads(fake_path.read_text())
    assert "generated_at_ist" in written
    assert len(written["stores"]) == 13


def test_run_aborts_and_keeps_existing_file_on_bad_pull(tmp_path, monkeypatch):
    fake_path = tmp_path / "data.json"
    fake_path.write_text('{"stores": [], "note": "yesterday"}')
    monkeypatch.setattr("build.build_data.DATA_JSON_PATH", str(fake_path))

    runner = _fake_runner([], [], [])  # empty online + too few launch-date rows

    result = run(runner, date(2026, 8, 18))

    assert result is False
    assert json.loads(fake_path.read_text())["note"] == "yesterday"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_build_data.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.build_data'`

- [ ] **Step 3: Write the implementation**

```python
# build/build_data.py
"""Orchestrates a KK Pune ClickHouse pull into data.json.

`run()` takes a `query_runner` callable so it can be unit tested without
a live database; `main()` wires up the real ClickHouse client and is
what the daily cron script actually invokes.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

from build.stores import up_names
from build.queries import build_online_revenue_query, build_dine_in_revenue_query, build_launch_date_query
from build.clickhouse_client import run_query
from build.aggregate import build_dashboard_payload
from build.sanity_guard import is_pull_valid

IST = timezone(timedelta(hours=5, minutes=30))
DATA_JSON_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.json")


def today_ist():
    return datetime.now(IST).date()


def run(query_runner, today):
    stores = up_names()
    start_date = today - timedelta(days=120)

    online_rows = query_runner(build_online_revenue_query(stores, start_date, today))
    dine_in_rows = query_runner(build_dine_in_revenue_query(stores, start_date, today))
    launch_date_rows = query_runner(build_launch_date_query(stores))

    # 11, not 13: as of Aug 2026, Ravet and FB Baner are newly launched and
    # genuinely have zero orders yet in ClickHouse. Raise back to 13 (the
    # sanity_guard default) once both have their first recorded order.
    if not is_pull_valid(online_rows, dine_in_rows, launch_date_rows, expected_min_stores=11):
        print("ClickHouse pull failed sanity check — keeping existing data.json", file=sys.stderr)
        return False

    payload = build_dashboard_payload(online_rows, dine_in_rows, launch_date_rows, today)
    payload["generated_at_ist"] = datetime.now(IST).isoformat()

    with open(DATA_JSON_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Wrote {DATA_JSON_PATH}")
    return True


def main():
    password = os.environ["CLICKHOUSE_PASSWORD"]

    def query_runner(sql):
        return run_query(sql, password)

    ok = run(query_runner, today_ist())
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_build_data.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full Python test suite**

Run: `python3 -m pytest tests/ -v`
Expected: PASS (all tests across Tasks 2–7)

- [ ] **Step 6: Commit**

```bash
git add build/build_data.py tests/test_build_data.py
git commit -m "Add build orchestrator wiring ClickHouse pull to data.json"
```

---

### Task 8: Ops metrics data file

**Amendment (2026-08-19, during implementation):** the original version of
this task published a Google Sheet as CSV. That's blocked — Curefoods'
Workspace policy disables "Anyone with the link" sharing domain-wide,
confirmed by reproducing the "Sorry, sharing is unavailable" error twice
from a file sitting in My Drive (not a Shared Drive, so it's a real policy
block, not a location quirk). A file committed to the repo replaces it with
no loss of capability.

**Files:**
- Create: `ops_metrics.csv`

**Interfaces:**
- Produces: `ops_metrics.csv`, fetchable via a same-origin relative fetch from `index.html` (no CORS, no auth). Consumed by Task 10's `dashboard.js`.
- Columns (consumed by Task 10's CSV parser): `Date, Store, Platform, Availability%, Serviceability%, KPT, Cancellation%, Rating`. `Store` values must match the roster's `display_name` values from Task 2 exactly.

- [ ] **Step 1: Write `ops_metrics.csv`**

```
Date,Store,Platform,Availability%,Serviceability%,KPT,Cancellation%,Rating
2026-08-18,PNQ Pimpri,Swiggy,95,97,18,2.1,4.3
2026-08-18,PNQ Pimpri,Zomato,93,96,20,3.0,4.2
2026-08-18,PNQ Pimpri,Google,,,,,4.5
```

- [ ] **Step 2: Commit it**

```bash
git add ops_metrics.csv
git commit -m "Add ops metrics data file (replaces blocked Google Sheet approach)"
```

- [ ] **Step 3: Note how this gets updated going forward**

Ops (or Abhilash, on their behalf) edits `ops_metrics.csv` directly — via the GitHub web editor, or by sending updated numbers to be committed — and pushes. GitHub Pages redeploys automatically; the dashboard picks up the new numbers on next page load, no rebuild step needed.

---

### Task 9: Alert logic (`assets/alerts.js`)

**Files:**
- Create: `assets/alerts.js`
- Test: `assets/tests/alerts.test.js`

**Interfaces:**
- Consumes: the `stores` array shape produced by Task 5/7 (`display_name`, `category`, `launch_date`, `revenue.daily`), and an `opsRows` array shaped like the parsed CSV from Task 8 (`store`, `platform`, `date`, `availability`, `serviceability`, `cancellation`, `rating` — nullable numbers).
- Produces (attached to both `module.exports` for Node tests and `window.Alerts` for the browser): `computeAlerts(stores, opsRows, thresholds, todayStr) -> Array<{store, type, detail}>`, `isStale(lastUpdatedStr, todayStr, staleDays) -> bool`, `filterByCategory(stores, category) -> Array`.

- [ ] **Step 1: Write the failing tests**

```javascript
// assets/tests/alerts.test.js
const test = require('node:test');
const assert = require('node:assert');
const { computeAlerts, isStale, filterByCategory } = require('../alerts');

const THRESHOLDS = { availability_pct: 90, serviceability_pct: 90, cancellation_pct: 5, rating_min: 4.0, stale_days: 3 };

test('isStale returns true when older than threshold', () => {
  assert.strictEqual(isStale('2026-08-10', '2026-08-19', 3), true);
});

test('isStale returns false when within threshold', () => {
  assert.strictEqual(isStale('2026-08-18', '2026-08-19', 3), false);
});

test('computeAlerts flags low availability', () => {
  const stores = [{ display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Pimpri', platform: 'Swiggy', date: '2026-08-19', availability: 80, serviceability: null, cancellation: null, rating: null }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'availability'));
});

test('computeAlerts flags low rating', () => {
  const stores = [{ display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Pimpri', platform: 'Google', date: '2026-08-19', availability: null, serviceability: null, cancellation: null, rating: 3.5 }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'rating'));
});

test('computeAlerts flags stale ops data', () => {
  const stores = [{ display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Pimpri', platform: 'Swiggy', date: '2026-08-10', availability: 95, serviceability: 95, cancellation: 2, rating: 4.5 }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'stale'));
});

test('computeAlerts suppresses zero-revenue alert before launch_date', () => {
  const stores = [{ display_name: 'PNQ Ravet', category: 'Cfi', launch_date: '2026-08-15', revenue: { daily: [] } }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-12');
  assert.strictEqual(alerts.some(a => a.type === 'zero_revenue'), false);
});

test('computeAlerts flags zero revenue after launch when history exists but today is missing', () => {
  const stores = [{
    display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01',
    revenue: { daily: [{ date: '2026-08-18', online: { swiggy: 100, zomato: 0, ownly: 0 }, dine_in: 0, total: 100 }] },
  }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'zero_revenue'));
});

test('filterByCategory returns only matching stores', () => {
  const stores = [{ category: 'Cfi' }, { category: 'Rebel' }];
  assert.strictEqual(filterByCategory(stores, 'Rebel').length, 1);
});

test('filterByCategory returns all stores for "All"', () => {
  const stores = [{ category: 'Cfi' }, { category: 'Rebel' }];
  assert.strictEqual(filterByCategory(stores, 'All').length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test assets/tests/alerts.test.js`
Expected: FAIL with `Cannot find module '../alerts'`

- [ ] **Step 3: Write the implementation**

```javascript
// assets/alerts.js
'use strict';

function isStale(lastUpdatedStr, todayStr, staleDays) {
  const last = new Date(lastUpdatedStr + 'T00:00:00Z');
  const today = new Date(todayStr + 'T00:00:00Z');
  const diffDays = Math.round((today - last) / (1000 * 60 * 60 * 24));
  return diffDays > staleDays;
}

function computeAlerts(stores, opsRows, thresholds, todayStr) {
  const alerts = [];

  for (const store of stores) {
    if (store.launch_date && store.launch_date <= todayStr) {
      const todayEntry = store.revenue.daily.find(d => d.date === todayStr);
      const hasAnyHistory = store.revenue.daily.some(d => d.date < todayStr);
      if (hasAnyHistory && (!todayEntry || todayEntry.total === 0)) {
        alerts.push({ store: store.display_name, type: 'zero_revenue', detail: `No revenue recorded for ${todayStr}` });
      }
    }

    const storeOps = opsRows.filter(r => r.store === store.display_name);
    for (const row of storeOps) {
      if (row.availability !== null && row.availability < thresholds.availability_pct) {
        alerts.push({ store: store.display_name, type: 'availability', detail: `${row.platform} availability ${row.availability}% < ${thresholds.availability_pct}%` });
      }
      if (row.serviceability !== null && row.serviceability < thresholds.serviceability_pct) {
        alerts.push({ store: store.display_name, type: 'serviceability', detail: `${row.platform} serviceability ${row.serviceability}% < ${thresholds.serviceability_pct}%` });
      }
      if (row.cancellation !== null && row.cancellation > thresholds.cancellation_pct) {
        alerts.push({ store: store.display_name, type: 'cancellation', detail: `${row.platform} cancellation ${row.cancellation}% > ${thresholds.cancellation_pct}%` });
      }
      if (row.rating !== null && row.rating < thresholds.rating_min) {
        alerts.push({ store: store.display_name, type: 'rating', detail: `${row.platform} rating ${row.rating} < ${thresholds.rating_min}` });
      }
      if (isStale(row.date, todayStr, thresholds.stale_days)) {
        alerts.push({ store: store.display_name, type: 'stale', detail: `${row.platform} data last updated ${row.date}` });
      }
    }
  }

  return alerts;
}

function filterByCategory(stores, category) {
  if (!category || category === 'All') return stores;
  return stores.filter(s => s.category === category);
}

const AlertsModule = { computeAlerts, isStale, filterByCategory };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AlertsModule;
}
if (typeof window !== 'undefined') {
  window.Alerts = AlertsModule;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test assets/tests/alerts.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add assets/alerts.js assets/tests/alerts.test.js
git commit -m "Add pure alert-threshold and category-filter logic"
```

---

### Task 10: Dashboard page (`index.html`, `assets/dashboard.css`, `assets/dashboard.js`)

**Files:**
- Modify: `index.html` (replace Task 1's placeholder)
- Create: `assets/dashboard.css`
- Create: `assets/dashboard.js`

**Interfaces:**
- Consumes: `data.json` (Task 7's shape, fetched relative to the page), `ops_metrics.csv` (Task 8, fetched relative to the page — same-origin, no external URL needed), `window.Alerts` (Task 9, loaded via `<script src="assets/alerts.js">` before `dashboard.js`).
- Produces: the rendered page — no further tasks consume this module programmatically.

- [ ] **Step 1: Write `assets/dashboard.css`**

```css
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
  --muted: #6b6b6b;
  --border: #e2e2e2;
  --accent: #b8860b;
  --alert-bg: #fff3f3;
  --alert-border: #d33;
  --ok-bg: #f0fbf3;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  margin: 0;
  padding: 24px;
}

header h1 { margin: 0 0 4px; }
#generated-at { color: var(--muted); font-size: 0.9em; margin: 0 0 20px; }

.category-filter button {
  margin-right: 8px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 999px;
  cursor: pointer;
}
.category-filter button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

section { max-width: 1000px; margin: 0 auto 32px; }

table { width: 100%; border-collapse: collapse; margin: 12px 0; overflow-x: auto; display: block; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }

#alerts-list { list-style: none; padding: 0; }
#alerts-list li { padding: 10px 14px; margin-bottom: 6px; border-radius: 6px; background: var(--alert-bg); border-left: 4px solid var(--alert-border); }
#alerts-list li.ok { background: var(--ok-bg); border-left-color: #2a7a3f; }
```

- [ ] **Step 2: Write `assets/dashboard.js`**

```javascript
// assets/dashboard.js
'use strict';

const CSV_URL = 'ops_metrics.csv';

const THRESHOLDS = {
  availability_pct: 90,
  serviceability_pct: 90,
  cancellation_pct: 5,
  rating_min: 4.0,
  stale_days: 3,
};

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { current += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      values.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  values.push(current);
  return values;
}

function parseOpsCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = values[i] !== undefined ? values[i].trim() : ''; });
    return {
      date: row['Date'],
      store: row['Store'],
      platform: row['Platform'],
      availability: row['Availability%'] === '' ? null : parseFloat(row['Availability%']),
      serviceability: row['Serviceability%'] === '' ? null : parseFloat(row['Serviceability%']),
      kpt: row['KPT'] === '' ? null : row['KPT'],
      cancellation: row['Cancellation%'] === '' ? null : parseFloat(row['Cancellation%']),
      rating: row['Rating'] === '' ? null : parseFloat(row['Rating']),
    };
  });
}

function latestOpsByStorePlatform(opsRows) {
  const latest = {};
  for (const row of opsRows) {
    const key = row.store + '|' + row.platform;
    if (!latest[key] || row.date > latest[key].date) latest[key] = row;
  }
  return Object.values(latest);
}

function fmtMoney(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function latestCompleteDate(stores) {
  let max = null;
  for (const s of stores) {
    const last = s.revenue.daily.length ? s.revenue.daily[s.revenue.daily.length - 1].date : null;
    if (last && (!max || last > max)) max = last;
  }
  return max;
}

function renderHeader(dashboard) {
  document.getElementById('generated-at').textContent = 'Data as of ' + dashboard.generated_at_ist;
}

function renderAlerts(alerts) {
  const el = document.getElementById('alerts-list');
  el.innerHTML = '';
  if (alerts.length === 0) {
    el.innerHTML = '<li class="ok">No issues flagged.</li>';
    return;
  }
  for (const a of alerts) {
    const li = document.createElement('li');
    li.className = 'alert-' + a.type;
    li.textContent = `${a.store}: ${a.detail}`;
    el.appendChild(li);
  }
}

function renderRevenue(stores) {
  const tbody = document.getElementById('revenue-body');
  tbody.innerHTML = '';
  for (const s of stores) {
    const last = s.revenue.daily.length ? s.revenue.daily[s.revenue.daily.length - 1] : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.display_name}</td>
      <td>${s.category}</td>
      <td>${last ? fmtMoney(last.total) : '—'}</td>
      <td>${fmtMoney(s.revenue.wtd.total)}</td>
      <td>${fmtMoney(s.revenue.mtd.total)}</td>
      <td>${s.launch_date || '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderOpsGrid(latestOps) {
  const tbody = document.getElementById('ops-body');
  tbody.innerHTML = '';
  for (const row of latestOps) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.store}</td>
      <td>${row.platform}</td>
      <td>${row.availability ?? '—'}</td>
      <td>${row.serviceability ?? '—'}</td>
      <td>${row.kpt ?? '—'}</td>
      <td>${row.cancellation ?? '—'}</td>
      <td>${row.rating ?? '—'}</td>
      <td>${row.date}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadData() {
  const [dashboard, csvText] = await Promise.all([
    fetch('data.json').then(r => r.json()),
    fetch(CSV_URL).then(r => r.text()).catch(() => ''),
  ]);
  const opsRows = csvText ? parseOpsCsv(csvText) : [];
  return { dashboard, opsRows };
}

function renderAll({ dashboard, opsRows }) {
  const today = latestCompleteDate(dashboard.stores) || dashboard.generated_at_ist.slice(0, 10);
  const latestOps = latestOpsByStorePlatform(opsRows);
  const alerts = window.Alerts.computeAlerts(dashboard.stores, latestOps, THRESHOLDS, today);

  renderHeader(dashboard);
  renderAlerts(alerts);
  renderRevenue(dashboard.stores);
  renderOpsGrid(latestOps);

  document.querySelectorAll('.category-filter button').forEach(btn => {
    btn.addEventListener('click', () => {
      renderRevenue(window.Alerts.filterByCategory(dashboard.stores, btn.dataset.category));
      document.querySelectorAll('.category-filter button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

loadData().then(renderAll).catch(err => {
  document.getElementById('alerts-list').innerHTML = `<li class="alert-error">Failed to load dashboard data: ${err.message}</li>`;
});
```

- [ ] **Step 3: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Krispy Kreme · Pune</title>
  <link rel="stylesheet" href="assets/dashboard.css">
</head>
<body>
  <header>
    <h1>Krispy Kreme · Pune</h1>
    <p id="generated-at"></p>
  </header>

  <section class="category-filter">
    <button data-category="All" class="active">All (13)</button>
    <button data-category="Cfi">Cfi (5)</button>
    <button data-category="Rebel">Rebel (4)</button>
    <button data-category="Offline">Offline (4)</button>
  </section>

  <section id="alerts">
    <h2>What's not working</h2>
    <ul id="alerts-list"></ul>
  </section>

  <section id="revenue">
    <h2>Revenue</h2>
    <table>
      <thead><tr><th>Store</th><th>Category</th><th>Latest day</th><th>WTD</th><th>MTD</th><th>Launch date</th></tr></thead>
      <tbody id="revenue-body"></tbody>
    </table>
  </section>

  <section id="ops">
    <h2>Storefront ops &amp; ratings</h2>
    <table>
      <thead><tr><th>Store</th><th>Platform</th><th>Availability %</th><th>Serviceability %</th><th>KPT</th><th>Cancellation %</th><th>Rating</th><th>Last updated</th></tr></thead>
      <tbody id="ops-body"></tbody>
    </table>
  </section>

  <script src="assets/alerts.js"></script>
  <script src="assets/dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 4: Syntax-check and manually verify locally**

```bash
node --check assets/dashboard.js
node --check assets/alerts.js
python3 -m http.server 8000
```
Open `http://localhost:8000/` in a browser. Expected: header shows a "Data as of ..." timestamp (or a clear fetch-failure message if `data.json` doesn't exist yet — that's fine before Task 7's first real run), category filter buttons toggle the revenue table, no console errors other than an expected 404 on `data.json` before it exists.

- [ ] **Step 6: Commit**

```bash
git add index.html assets/dashboard.css assets/dashboard.js
git commit -m "Build KK Pune dashboard page: revenue, ops grid, alerts"
```

---

### Task 11: Local secrets + daily cron

**Files:**
- Create: `.env.example`
- Create: `scripts/refresh_and_deploy.sh`
- Create: `~/Library/LaunchAgents/com.abhilash.kkpune.refresh.plist` (outside the repo)

**Interfaces:**
- Consumes: `build/build_data.py`'s `main()` (Task 7), reading `CLICKHOUSE_PASSWORD` from the environment.
- Produces: a daily 7:00am IST run that regenerates `data.json` and pushes it if changed.

- [ ] **Step 1: Write `.env.example` (committed, no real secret)**

```
CLICKHOUSE_PASSWORD=
```

- [ ] **Step 2: Create the real local `.env` (not committed — already in `.gitignore` from Task 1)**

```bash
echo 'CLICKHOUSE_PASSWORD=3ThALz89**HmKn^jUC^%' > /Users/SushmaS/kk-pune-dashboard/.env
chmod 600 /Users/SushmaS/kk-pune-dashboard/.env
```

- [ ] **Step 3: Write `scripts/refresh_and_deploy.sh`**

```bash
#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/SushmaS/kk-pune-dashboard"
cd "$REPO_DIR"

set -a
source "$REPO_DIR/.env"
set +a

python3 build/build_data.py

if git diff --quiet -- data.json; then
  echo "No data changes, skipping commit."
  exit 0
fi

git add data.json
git commit -m "Daily data refresh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push origin main
```

```bash
chmod +x scripts/refresh_and_deploy.sh
mkdir -p logs
```

- [ ] **Step 4: Do a manual run to prove the pipeline works end to end against the real database**

```bash
./scripts/refresh_and_deploy.sh
cat data.json | python3 -m json.tool | head -30
```
Expected: `data.json` written with 13 stores, each with a non-null `launch_date`, and a git commit created (or "No data changes" if run twice in a row).

- [ ] **Step 5: Write the launchd plist directly to its target location**

```bash
cat > ~/Library/LaunchAgents/com.abhilash.kkpune.refresh.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.abhilash.kkpune.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/SushmaS/kk-pune-dashboard/scripts/refresh_and_deploy.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/SushmaS/kk-pune-dashboard/logs/refresh.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/SushmaS/kk-pune-dashboard/logs/refresh.err.log</string>
</dict>
</plist>
EOF
```

- [ ] **Step 6: Load the job**

```bash
launchctl load ~/Library/LaunchAgents/com.abhilash.kkpune.refresh.plist
launchctl list | grep kkpune
```
Expected: the job appears in `launchctl list` output.

- [ ] **Step 7: Commit the repo-side files**

```bash
git add .env.example scripts/refresh_and_deploy.sh
git commit -m "Add daily ClickHouse refresh script and cron setup"
git push origin main
```

---

### Task 12: End-to-end verification & go-live

**Files:** none (verification only).

- [ ] **Step 1: Confirm the live page loads with real data**

```bash
curl -sI https://abhilashbishtwork.github.io/kk-pune-dashboard/ | head -1
curl -s https://abhilashbishtwork.github.io/kk-pune-dashboard/data.json | python3 -m json.tool | head -5
```
Expected: `200 OK`; `data.json` contains 13 stores.

- [ ] **Step 2: Confirm true no-login access**

From a private/incognito browser window (no Google account signed in), open `https://abhilashbishtwork.github.io/kk-pune-dashboard/`. Expected: dashboard renders fully, with no sign-in prompt at any point.

- [ ] **Step 3: Confirm the ops CSV is still anonymously fetchable**

```bash
curl -s "<CSV_URL from Task 8>" | head -3
```
Expected: CSV text, not an `accounts.google.com` redirect.

- [ ] **Step 4: Confirm no store_name collisions among the 13 Pune stores**

```bash
python3 -c "
import os
from build.stores import up_names
from build.clickhouse_client import run_query
from build.queries import BRAND_ID, _store_list_sql
password = os.environ['CLICKHOUSE_PASSWORD']
stores_sql = _store_list_sql(up_names())
sql = f'''
    SELECT store_name, count(DISTINCT store_ref_id) AS distinct_refs
    FROM orders
    WHERE brand_id = {BRAND_ID} AND store_name IN ({stores_sql})
    GROUP BY store_name
    FORMAT TabSeparatedWithNames
'''
for row in run_query(sql, password):
    print(row, 'COLLISION' if int(row['distinct_refs']) > 1 else 'ok')
"
```
Expected: every store prints `ok` (`distinct_refs == 1`). A `COLLISION` means one `store_name` string maps to more than one physical outlet in ClickHouse — this must be resolved (likely by switching the affected store to a `store_ref_id` filter instead of `store_name`) before trusting that store's numbers.

- [ ] **Step 5: Spot-check revenue against the existing national KK dashboard**

Pick one recent full day and one Pune store; compare that store's total in the new dashboard's `data.json` against the equivalent figure in `krispy-kreme-online-dashboard`. Expected: figures match within the online-only portion (the new dashboard additionally includes dine-in revenue, so totals may legitimately be higher).

- [ ] **Step 6: Confirm alerts render sensibly**

With real (likely still-sparse) ops-sheet data, open the live page and check the "What's not working" section shows either specific flags or "No issues flagged" — not an error message.

- [ ] **Step 7: Mobile-width check**

Resize the browser to ~375px wide (or use device emulation). Expected: tables scroll horizontally within their own container rather than the whole page scrolling sideways; category filter buttons wrap cleanly.

- [ ] **Step 8: Share the live URL**

Confirm with the user that `https://abhilashbishtwork.github.io/kk-pune-dashboard/` is ready to share with the Pune ground team.
