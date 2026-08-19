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
