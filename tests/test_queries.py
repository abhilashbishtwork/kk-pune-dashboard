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
    assert "t.brand_id = " in sql and "t.order_id = o.order_id" in sql


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
