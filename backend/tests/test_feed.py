import json
import pytest
from backend.gtfs.feed import parse_alerts_json, parse_feed
from backend.gtfs.models import ArrivalRecord, ServiceAlert


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


def _make_alerts_json(route_id: str, effect: int | str, header: str) -> bytes:
    payload = {
        'entity': [{
            'id': 'test-1',
            'alert': {
                'informed_entity': [{'route_id': route_id}],
                'header_text': {'translation': [{'text': header, 'language': 'en'}]},
                'effect': effect,
            },
        }]
    }
    return json.dumps(payload).encode()


def test_parse_alerts_json_integer_effect():
    data = _make_alerts_json('A', 1, 'No A train service')  # 1 = NO_SERVICE
    alerts = parse_alerts_json(data)
    assert len(alerts) == 1
    a = alerts[0]
    assert isinstance(a, ServiceAlert)
    assert a.route_id == 'A'
    assert a.effect == 'NO_SERVICE'
    assert a.severity == 'HIGH'
    assert a.header == 'No A train service'


def test_parse_alerts_json_string_effect():
    data = _make_alerts_json('6', 'SIGNIFICANT_DELAYS', 'Delays on 6 train')
    alerts = parse_alerts_json(data)
    assert len(alerts) == 1
    assert alerts[0].effect == 'SIGNIFICANT_DELAYS'
    assert alerts[0].severity == 'LOW'


def test_parse_alerts_json_empty_bytes():
    assert parse_alerts_json(b'') == []


def test_parse_alerts_json_invalid_json():
    assert parse_alerts_json(b'not json') == []


def test_parse_alerts_json_no_route_falls_back_to_all():
    payload = {
        'entity': [{
            'id': 'test-2',
            'alert': {
                'informed_entity': [],
                'header_text': {'translation': [{'text': 'System-wide delay', 'language': 'en'}]},
                'effect': 3,
            },
        }]
    }
    alerts = parse_alerts_json(json.dumps(payload).encode())
    assert len(alerts) == 1
    assert alerts[0].route_id == 'ALL'
