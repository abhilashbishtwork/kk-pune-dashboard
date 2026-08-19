"""Static store roster for the KK Pune dashboard.

Each store is keyed by its UrbanPiper name (the `store_name` value used
for online orders in ClickHouse `orders`), mapped to a display name and
ownership category.

`pos_name` is a SEPARATE field, not derived from `up_name` — ClickHouse
tags dine-in/POS orders under a different exact `store_name` string than
online orders for the same physical store (confirmed by a full ILIKE scan
of the `orders` table on 2026-08-19, see the design spec's amendment
log). Only the four "Offline" (dine-in-format) stores have a `pos_name`;
the rest are pure delivery/cloud kitchens with no dine-in counter, so
`pos_name` is None for them.
"""

CATEGORIES = ("Cfi", "Rebel", "Offline")

STORE_ROSTER = [
    {"up_name": "PNQ KK Tribeca", "pos_name": "PNQ KK Tribeca Pos", "display_name": "PNQ Tribeca", "category": "Offline"},
    {"up_name": "PNQ KK Amanora", "pos_name": "PNQ KK Amanora Pos", "display_name": "PNQ Amanora Mall", "category": "Offline"},
    {"up_name": "PNQ KK Pimpri", "pos_name": None, "display_name": "PNQ Pimpri", "category": "Cfi"},
    {"up_name": "PNQ KK Kothrud", "pos_name": None, "display_name": "PNQ Kothrud", "category": "Cfi"},
    {"up_name": "PNQ KK Viman Nagar", "pos_name": None, "display_name": "PNQ Viman Nagar", "category": "Cfi"},
    {"up_name": "PNQ KK Wagholi", "pos_name": None, "display_name": "PNQ Wagholi", "category": "Cfi"},
    {"up_name": "PNQ KK Ravet", "pos_name": None, "display_name": "PNQ Ravet", "category": "Cfi"},
    {"up_name": "PNQ KK Dhanori", "pos_name": None, "display_name": "PNQ KK Dhanori", "category": "Rebel"},
    {"up_name": "PNQ KK Hinjewadi", "pos_name": None, "display_name": "PNQ KK Hinjewadi", "category": "Rebel"},
    {"up_name": "PNQ KK Law College", "pos_name": None, "display_name": "PNQ KK Law College", "category": "Rebel"},
    {"up_name": "PNQ KK Sangvi", "pos_name": None, "display_name": "PNQ KK Sangvi", "category": "Rebel"},
    {"up_name": "PNQ KK Niyati Plaza", "pos_name": "PNQ KK Niyati Plaza Pos", "display_name": "PNQ KK Niyati Plaza", "category": "Offline"},
    {"up_name": "PNQ KK Baner", "pos_name": "PNQ KK FB Baner Pos", "display_name": "KK FB Baner", "category": "Offline"},
]


def up_names():
    return [s["up_name"] for s in STORE_ROSTER]


def pos_names():
    return [s["pos_name"] for s in STORE_ROSTER if s["pos_name"]]


def up_name_for_pos_name(pos_name):
    for s in STORE_ROSTER:
        if s["pos_name"] == pos_name:
            return s["up_name"]
    return None


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
