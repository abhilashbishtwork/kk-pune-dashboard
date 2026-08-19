"""Turn raw ClickHouse rows into the dashboard's per-store JSON payload."""

from datetime import timedelta

from build.stores import STORE_ROSTER, up_name_for_pos_name


def _empty_channel_totals():
    return {"swiggy": 0.0, "zomato": 0.0, "ownly": 0.0}


def _sum_window(daily, start_date_str):
    online = 0.0
    dine_in = 0.0
    online_orders = 0
    dine_in_orders = 0
    for d in daily:
        if d["date"] >= start_date_str:
            online += sum(d["online"].values())
            dine_in += d["dine_in"]
            online_orders += d["online_orders"]
            dine_in_orders += d["dine_in_orders"]
    return {
        "online": online,
        "dine_in": dine_in,
        "total": online + dine_in,
        "online_orders": online_orders,
        "dine_in_orders": dine_in_orders,
    }


def build_dashboard_payload(online_rows, dine_in_rows, ops_metric_rows, launch_date_rows, today_ist):
    launch_dates = {r["store_name"]: r["launch_date"] for r in launch_date_rows}
    today_str = str(today_ist)

    by_store_date = {}
    for r in online_rows:
        key = (r["store_name"], r["order_date"])
        entry = by_store_date.setdefault(key, {
            "online": _empty_channel_totals(), "dine_in": 0.0, "online_orders": 0, "dine_in_orders": 0,
        })
        entry["online"][r["channel"]] = entry["online"].get(r["channel"], 0.0) + float(r["revenue"])
        entry["online_orders"] += int(r["order_count"])
    for r in dine_in_rows:
        # dine_in_rows are keyed by the POS-channel store_name, which differs
        # from the online up_name for the same physical store — map back.
        up_name = up_name_for_pos_name(r["store_name"])
        if up_name is None:
            continue
        key = (up_name, r["order_date"])
        entry = by_store_date.setdefault(key, {
            "online": _empty_channel_totals(), "dine_in": 0.0, "online_orders": 0, "dine_in_orders": 0,
        })
        entry["dine_in"] += float(r["revenue"])
        entry["dine_in_orders"] += int(r["order_count"])

    by_store_ops = {}
    for r in ops_metric_rows:
        key = r["store_name"]
        total = int(r["total_orders"])
        cancelled = int(r["cancelled_orders"])
        kpt_raw = r.get("kpt_p80_minutes", "")
        by_store_ops.setdefault(key, []).append({
            "date": r["order_date"],
            "platform": r["channel"].capitalize(),
            "order_count": total,
            "cancelled_orders": cancelled,
            # Raw counts (not a pre-computed %) so a UI can correctly
            # aggregate cancellation over any date range without
            # double-rounding. kpt_p80_minutes is the P80 for that single
            # day — combining across a multi-day range (an order-count
            # weighted mean of daily P80s) is an approximation, not a true
            # range-level P80, since percentiles don't average validly.
            "kpt_p80_minutes": round(float(kpt_raw), 1) if kpt_raw not in ("", None, "nan", "\\N") else None,
        })

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
            daily.append({
                "date": d,
                "online": entry["online"],
                "dine_in": entry["dine_in"],
                "total": total,
                "online_orders": entry["online_orders"],
                "dine_in_orders": entry["dine_in_orders"],
            })

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
            "ops_computed": {
                "daily": [d for d in by_store_ops.get(up_name, []) if d["date"] != today_str],
            },
        })

    return {"stores": stores_out}
