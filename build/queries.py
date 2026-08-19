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
            sum(o.sub_total_amount - (o.discount - o.aggregator_discount) + o.charges) AS revenue,
            count(*) AS order_count
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


def build_dine_in_revenue_query(pos_store_names, start_date, end_date):
    """`pos_store_names` are the dine-in-channel store_name strings (see
    `build.stores.pos_names()`) — NOT the online `up_name` strings. ClickHouse
    tags the same physical store differently across channels, confirmed by a
    full scan on 2026-08-19."""
    stores_sql = _store_list_sql(pos_store_names)
    return f"""
        SELECT
            toDate(o.created_at_ist) AS order_date,
            o.store_name AS store_name,
            sum(o.sub_total_amount - (o.discount - o.aggregator_discount) + o.charges) AS revenue,
            count(*) AS order_count
        FROM orders o
        WHERE o.brand_id = {BRAND_ID}
          AND o.store_name IN ({stores_sql})
          AND o.channel = 'pos'
          AND toDate(o.created_at_ist) >= toDate('{start_date}', 'Asia/Kolkata')
          AND toDate(o.created_at_ist) <= toDate('{end_date}', 'Asia/Kolkata')
        GROUP BY order_date, store_name
        FORMAT TabSeparatedWithNames
    """.strip()


def build_ops_metrics_query(store_names, start_date, end_date):
    """Cancellation % and KPT computed live from ClickHouse, per (store,
    channel, date) — no manual entry needed for these two. KPT is the P80
    (80th percentile) of Acknowledged -> Food Ready minutes, not the mean —
    a percentile better reflects the tail the ops team actually cares about,
    matching the P80 convention already used elsewhere (KPT/O2D definitions).
    Scoped to swiggy/zomato only, matching the platforms tracked in
    ops_metrics.csv (Google has no order-level KPT/cancellation concept)."""
    stores_sql = _store_list_sql(store_names)
    return f"""
        WITH transitions_pivoted AS (
            SELECT
                brand_id,
                order_id,
                minIf(status_changed_at_ist, to_status = 'Acknowledged') AS ack_at,
                minIf(status_changed_at_ist, to_status = 'Food Ready') AS ready_at,
                argMax(to_status, status_changed_at_ist) AS final_status
            FROM orders_state_transitions
            WHERE brand_id = {BRAND_ID}
            GROUP BY brand_id, order_id
        ),
        per_order AS (
            SELECT
                toDate(o.created_at_ist) AS order_date,
                o.store_name AS store_name,
                o.channel AS channel,
                t.final_status AS final_status,
                if(t.ready_at > t.ack_at, dateDiff('minute', t.ack_at, t.ready_at), NULL) AS kpt_minutes
            FROM orders o
            LEFT JOIN transitions_pivoted t ON t.brand_id = {BRAND_ID} AND t.order_id = o.id
            WHERE o.brand_id = {BRAND_ID}
              AND o.store_name IN ({stores_sql})
              AND o.channel IN ('swiggy', 'zomato')
              AND toDate(o.created_at_ist) >= toDate('{start_date}', 'Asia/Kolkata')
              AND toDate(o.created_at_ist) <= toDate('{end_date}', 'Asia/Kolkata')
        )
        SELECT
            order_date,
            store_name,
            channel,
            count(*) AS total_orders,
            countIf(final_status IN ('Cancelled', 'customer_cancelled')) AS cancelled_orders,
            quantileIf(0.8)(kpt_minutes, kpt_minutes IS NOT NULL) AS kpt_p80_minutes
        FROM per_order
        GROUP BY order_date, store_name, channel
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
