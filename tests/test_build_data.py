import json
from datetime import date

from build.build_data import run, DATA_JSON_PATH


def _fake_runner(online_rows, dine_in_rows, ops_metric_rows, launch_date_rows):
    def runner(sql):
        # Check the most specific marker first: the ops-metrics query also
        # contains "orders_state_transitions" (inside its CTE), so it would
        # otherwise be misrouted to online_rows.
        if "transitions_pivoted" in sql:
            return ops_metric_rows
        if "orders_state_transitions" in sql:
            return online_rows
        if "channel = 'pos'" in sql:
            return dine_in_rows
        return launch_date_rows
    return runner


def test_run_writes_data_json_on_valid_pull(tmp_path, monkeypatch):
    fake_path = tmp_path / "data.json"
    monkeypatch.setattr("build.build_data.DATA_JSON_PATH", str(fake_path))

    online_rows = [{"order_date": "2026-08-17", "store_name": "PNQ KK Pimpri", "channel": "swiggy", "revenue": "100", "order_count": "1"}]
    launch_date_rows = [{"store_name": s, "launch_date": "2025-01-01"} for s in [
        "PNQ KK Tribeca", "PNQ KK Amanora", "PNQ KK Pimpri", "PNQ KK Kothrud",
        "PNQ KK Viman Nagar", "PNQ KK Wagholi", "PNQ KK Ravet", "PNQ KK Dhanori",
        "PNQ KK Hinjewadi", "PNQ KK Law College", "PNQ KK Sangvi",
        "PNQ KK Niyati Plaza", "PNQ KK Baner",
    ]]
    runner = _fake_runner(online_rows, [], [], launch_date_rows)

    result = run(runner, date(2026, 8, 18))

    assert result is True
    written = json.loads(fake_path.read_text())
    assert "generated_at_ist" in written
    assert len(written["stores"]) == 13


def test_run_aborts_and_keeps_existing_file_on_bad_pull(tmp_path, monkeypatch):
    fake_path = tmp_path / "data.json"
    fake_path.write_text('{"stores": [], "note": "yesterday"}')
    monkeypatch.setattr("build.build_data.DATA_JSON_PATH", str(fake_path))

    runner = _fake_runner([], [], [], [])  # empty online + too few launch-date rows

    result = run(runner, date(2026, 8, 18))

    assert result is False
    assert json.loads(fake_path.read_text())["note"] == "yesterday"
