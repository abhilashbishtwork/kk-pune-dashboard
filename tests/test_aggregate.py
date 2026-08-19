from datetime import date
from build.aggregate import build_dashboard_payload


def test_daily_entry_sums_online_and_dine_in_with_order_counts():
    # Tribeca has a pos_name ("PNQ KK Tribeca Pos") distinct from its
    # up_name ("PNQ KK Tribeca") — dine_in_rows arrive keyed by pos_name and
    # must be mapped back to up_name.
    online_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Tribeca", "channel": "swiggy", "revenue": "1000", "order_count": "10"},
        {"order_date": "2026-08-17", "store_name": "PNQ KK Tribeca", "channel": "zomato", "revenue": "500", "order_count": "5"},
    ]
    dine_in_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Tribeca Pos", "revenue": "200", "order_count": "4"},
    ]
    launch_date_rows = [{"store_name": "PNQ KK Tribeca", "launch_date": "2025-03-12"}]

    payload = build_dashboard_payload(online_rows, dine_in_rows, [], launch_date_rows, date(2026, 8, 18))
    tribeca = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Tribeca")

    assert tribeca["launch_date"] == "2025-03-12"
    assert len(tribeca["revenue"]["daily"]) == 1
    day = tribeca["revenue"]["daily"][0]
    assert day["date"] == "2026-08-17"
    assert day["online"] == {"swiggy": 1000.0, "zomato": 500.0, "ownly": 0.0}
    assert day["dine_in"] == 200.0
    assert day["total"] == 1700.0
    assert day["online_orders"] == 15
    assert day["dine_in_orders"] == 4


def test_dine_in_row_for_unknown_pos_name_is_ignored():
    dine_in_rows = [{"order_date": "2026-08-17", "store_name": "Some Unmapped Pos Name", "revenue": "999", "order_count": "1"}]
    payload = build_dashboard_payload([], dine_in_rows, [], [], date(2026, 8, 18))
    # Should not raise, and should not attach revenue to any store.
    assert all(s["revenue"]["daily"] == [] for s in payload["stores"])


def test_today_excluded_from_daily_full_day_rule():
    online_rows = [
        {"order_date": "2026-08-18", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "999", "order_count": "3"},
    ]
    payload = build_dashboard_payload(online_rows, [], [], [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    assert pimpri["revenue"]["daily"] == []


def test_store_with_no_rows_has_empty_daily_and_zero_totals():
    payload = build_dashboard_payload([], [], [], [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    assert pimpri["revenue"]["daily"] == []
    assert pimpri["revenue"]["wtd"] == {"online": 0.0, "dine_in": 0.0, "total": 0.0, "online_orders": 0, "dine_in_orders": 0}
    assert pimpri["revenue"]["mtd"] == {"online": 0.0, "dine_in": 0.0, "total": 0.0, "online_orders": 0, "dine_in_orders": 0}
    assert pimpri["launch_date"] is None
    assert pimpri["ops_computed"]["daily"] == []


def test_mtd_only_sums_current_month():
    online_rows = [
        {"order_date": "2026-07-31", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "5000", "order_count": "20"},
        {"order_date": "2026-08-01", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "300", "order_count": "2"},
    ]
    payload = build_dashboard_payload(online_rows, [], [], [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    assert pimpri["revenue"]["mtd"]["total"] == 300.0
    assert pimpri["revenue"]["mtd"]["online_orders"] == 2


def test_all_thirteen_stores_present():
    payload = build_dashboard_payload([], [], [], [], date(2026, 8, 18))
    assert len(payload["stores"]) == 13


def test_ops_computed_cancellation_and_kpt():
    ops_metric_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Pimpri", "channel": "swiggy",
         "total_orders": "20", "cancelled_orders": "2", "kpt_p80_minutes": "3.4"},
        {"order_date": "2026-08-18", "store_name": "PNQ KK Pimpri", "channel": "swiggy",
         "total_orders": "5", "cancelled_orders": "0", "kpt_p80_minutes": "1.1"},
    ]
    payload = build_dashboard_payload([], [], ops_metric_rows, [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    ops_daily = pimpri["ops_computed"]["daily"]
    # Today (2026-08-18) is excluded, same full-day-only rule as revenue.
    assert len(ops_daily) == 1
    assert ops_daily[0]["date"] == "2026-08-17"
    assert ops_daily[0]["platform"] == "Swiggy"
    assert ops_daily[0]["order_count"] == 20
    assert ops_daily[0]["cancelled_orders"] == 2
    assert ops_daily[0]["kpt_p80_minutes"] == 3.4


def test_ops_computed_missing_kpt_pairs_gives_null():
    ops_metric_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Pimpri", "channel": "zomato",
         "total_orders": "0", "cancelled_orders": "0", "kpt_p80_minutes": ""},
        {"order_date": "2026-08-16", "store_name": "PNQ KK Pimpri", "channel": "swiggy",
         # ClickHouse's quantileIf returns the literal TSV null marker, not "nan",
         # when a group has zero rows matching the condition.
         "total_orders": "0", "cancelled_orders": "0", "kpt_p80_minutes": "\\N"},
    ]
    payload = build_dashboard_payload([], [], ops_metric_rows, [], date(2026, 8, 18))
    pimpri = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Pimpri")
    ops_daily = pimpri["ops_computed"]["daily"]
    assert len(ops_daily) == 2
    for entry in ops_daily:
        assert entry["order_count"] == 0
        assert entry["cancelled_orders"] == 0
        assert entry["kpt_p80_minutes"] is None
