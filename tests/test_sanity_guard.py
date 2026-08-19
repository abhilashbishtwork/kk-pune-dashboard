from build.sanity_guard import is_pull_valid


def test_valid_pull_passes():
    online_rows = [{"store_name": "x"}]
    dine_in_rows = [{"store_name": "x"}]
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(13)]
    assert is_pull_valid(online_rows, dine_in_rows, launch_date_rows) is True


def test_too_few_stores_fails():
    online_rows = [{"store_name": "x"}]
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(10)]
    assert is_pull_valid(online_rows, [], launch_date_rows) is False


def test_no_online_rows_fails():
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(13)]
    assert is_pull_valid([], [{"store_name": "x"}], launch_date_rows) is False


def test_empty_dine_in_rows_does_not_fail_the_pull():
    online_rows = [{"store_name": "x"}]
    launch_date_rows = [{"store_name": f"s{i}"} for i in range(13)]
    assert is_pull_valid(online_rows, [], launch_date_rows) is True
