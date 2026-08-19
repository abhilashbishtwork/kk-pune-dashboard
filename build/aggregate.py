"""Turn raw ClickHouse rows into the dashboard's per-store JSON payload."""

from datetime import timedelta

from build.stores import STORE_ROSTER, up_name_for_pos_name


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
        # dine_in_rows are keyed by the POS-channel store_name, which differs
        # from the online up_name for the same physical store — map back.
        up_name = up_name_for_pos_name(r["store_name"])
        if up_name is None:
            continue
        key = (up_name, r["order_date"])
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
