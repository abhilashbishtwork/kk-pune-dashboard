from build.clickhouse_client import parse_tsv_with_names


def test_parses_header_and_rows():
    text = "order_date\tstore_name\trevenue\n2026-08-18\tPNQ KK Pimpri\t1234.5\n2026-08-18\tPNQ KK Kothrud\t500\n"
    rows = parse_tsv_with_names(text)
    assert rows == [
        {"order_date": "2026-08-18", "store_name": "PNQ KK Pimpri", "revenue": "1234.5"},
        {"order_date": "2026-08-18", "store_name": "PNQ KK Kothrud", "revenue": "500"},
    ]


def test_empty_result_returns_empty_list():
    assert parse_tsv_with_names("") == []
    assert parse_tsv_with_names("order_date\tstore_name\trevenue\n") == []


def test_ignores_trailing_blank_line():
    text = "a\tb\n1\t2\n\n"
    rows = parse_tsv_with_names(text)
    assert rows == [{"a": "1", "b": "2"}]
