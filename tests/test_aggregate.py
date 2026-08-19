from datetime import date
from build.aggregate import build_dashboard_payload


def test_daily_entry_sums_online_and_dine_in():
    # Tribeca has a pos_name ("PNQ KK Tribeca Pos") distinct from its
    # up_name ("PNQ KK Tribeca") — dine_in_rows arrive keyed by pos_name and
    # must be mapped back to up_name.
    online_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Tribeca", "channel": "swiggy", "revenue": "1000"},
        {"order_date": "2026-08-17", "store_name": "PNQ KK Tribeca", "channel": "zomato", "revenue": "500"},
    ]
    dine_in_rows = [
        {"order_date": "2026-08-17", "store_name": "PNQ KK Tribeca Pos", "revenue": "200"},
    ]
    launch_date_rows = [{"store_name": "PNQ KK Tribeca", "launch_date": "2025-03-12"}]

    payload = build_dashboard_payload(online_rows, dine_in_rows, launch_date_rows, date(2026, 8, 18))
    tribeca = next(s for s in payload["stores"] if s["up_name"] == "PNQ KK Tribeca")

    assert tribeca["launch_date"] == "2025-03-12"
    assert len(tribeca["revenue"]["daily"]) == 1
    day = tribeca["revenue"]["daily"][0]
    assert day["date"] == "2026-08-17"
    assert day["online"] == {"swiggy": 1000.0, "zomato": 500.0, "ownly": 0.0}
    assert day["dine_in"] == 200.0
    assert day["total"] == 1700.0


def test_dine_in_row_for_unknown_pos_name_is_ignored():
    dine_in_rows = [{"order_date": "2026-08-17", "store_name": "Some Unmapped Pos Name", "revenue": "999"}]
    payload = build_dashboard_payload([], dine_in_rows, [], date(2026, 8, 18))
    # Should not raise, and should not attach revenue to any store.
    assert all(s["revenue"]["daily"] == [] for s in payload["stores"])


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
