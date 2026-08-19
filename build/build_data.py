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
