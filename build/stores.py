"""Static store roster for the KK Pune dashboard.

Each store is keyed by its UrbanPiper name (the `store_name` value used
in ClickHouse `orders`), mapped to a display name and ownership category.
"""

CATEGORIES = ("Cfi", "Rebel", "Offline")

STORE_ROSTER = [
    {"up_name": "PNQ KK Tribeca", "display_name": "PNQ Tribeca", "category": "Offline"},
    {"up_name": "PNQ KK Amanora", "display_name": "PNQ Amanora Mall", "category": "Offline"},
    {"up_name": "PNQ KK Pimpri", "display_name": "PNQ Pimpri", "category": "Cfi"},
    {"up_name": "PNQ KK Kothrud", "display_name": "PNQ Kothrud", "category": "Cfi"},
    {"up_name": "PNQ KK Viman Nagar", "display_name": "PNQ Viman Nagar", "category": "Cfi"},
    {"up_name": "PNQ KK Wagholi", "display_name": "PNQ Wagholi", "category": "Cfi"},
    {"up_name": "KK Ravet Cloud", "display_name": "PNQ Ravet", "category": "Cfi"},
    {"up_name": "PNQ KK Dhanori", "display_name": "PNQ KK Dhanori", "category": "Rebel"},
    {"up_name": "PNQ KK Hinjewadi", "display_name": "PNQ KK Hinjewadi", "category": "Rebel"},
    {"up_name": "PNQ KK Law College", "display_name": "PNQ KK Law College", "category": "Rebel"},
    {"up_name": "PNQ KK Sangvi", "display_name": "PNQ KK Sangvi", "category": "Rebel"},
    {"up_name": "PNQ KK Niyati Plaza", "display_name": "PNQ KK Niyati Plaza", "category": "Offline"},
    {"up_name": "PNQ KK FB Baner", "display_name": "KK FB Baner", "category": "Offline"},
]


def up_names():
    return [s["up_name"] for s in STORE_ROSTER]


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
