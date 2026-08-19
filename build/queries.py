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
