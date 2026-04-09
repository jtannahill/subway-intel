import pytest
from backend.gtfs.feed import parse_feed
from backend.gtfs.models import ArrivalRecord


def test_parse_feed_returns_arrival_records(sample_feed_bytes):
    records = parse_feed(sample_feed_bytes)
    assert len(records) == 1
    r = records[0]
    assert isinstance(r, ArrivalRecord)
    assert r.route_id == '6'
    assert r.stop_id == '631N'
    assert r.delay_sec == 120
    assert r.direction == 'N'


def test_parse_feed_empty_bytes():
    records = parse_feed(b'')
    assert records == []
