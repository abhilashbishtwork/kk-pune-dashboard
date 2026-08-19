from build.stores import STORE_ROSTER, CATEGORIES, up_names, display_name_for, category_for


def test_thirteen_stores():
    assert len(STORE_ROSTER) == 13


def test_up_names_unique():
    names = up_names()
    assert len(names) == len(set(names))


def test_all_categories_valid():
    assert all(s["category"] in CATEGORIES for s in STORE_ROSTER)


def test_display_name_for_known_store():
    assert display_name_for("KK Ravet Cloud") == "PNQ Ravet"


def test_category_for_ravet_is_cfi():
    assert category_for("KK Ravet Cloud") == "Cfi"


def test_unknown_store_returns_none():
    assert display_name_for("Not A Store") is None
    assert category_for("Not A Store") is None


def test_category_counts_match_spec():
    counts = {}
    for s in STORE_ROSTER:
        counts[s["category"]] = counts.get(s["category"], 0) + 1
    assert counts == {"Offline": 4, "Cfi": 5, "Rebel": 4}
