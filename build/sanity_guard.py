"""Guard against a bad/short ClickHouse pull silently wiping the dashboard.

Dine-in rows are allowed to be empty (a pure-online store like a cloud
kitchen may genuinely have none) so only online rows and the launch-date
row count (one per store) gate validity.
"""


def is_pull_valid(online_rows, dine_in_rows, launch_date_rows, expected_min_stores=13):
    if len(launch_date_rows) < expected_min_stores:
        return False
    if len(online_rows) == 0:
        return False
    return True
