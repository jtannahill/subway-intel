import json
import pytest
from datetime import datetime, timezone
from google.transit import gtfs_realtime_pb2
from backend.gtfs.feed import parse_alerts_json, parse_feed, parse_vehicle_positions
from backend.gtfs.models import ArrivalRecord, ServiceAlert, VehiclePosition


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


@pytest.fixture
def sample_vehicle_feed_bytes() -> bytes:
    """Minimal GTFS-RT FeedMessage with one VehiclePosition."""
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = '2.0'
    feed.header.timestamp = int(datetime(2026, 4, 10, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    entity = feed.entity.add()
    entity.id = 'vehicle-1'
    entity.vehicle.trip.route_id = '6'
    entity.vehicle.trip.trip_id = 'trip-v1'
    entity.vehicle.stop_id = '631N'
    entity.vehicle.current_status = gtfs_realtime_pb2.VehiclePosition.STOPPED_AT
    entity.vehicle.timestamp = int(datetime(2026, 4, 10, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    return feed.SerializeToString()


def test_parse_vehicle_positions_returns_vehicle_position(sample_vehicle_feed_bytes):
    positions = parse_vehicle_positions(sample_vehicle_feed_bytes)
    assert len(positions) == 1
    p = positions[0]
    assert isinstance(p, VehiclePosition)
    assert p.route_id == '6'
    assert p.trip_id == 'trip-v1'
    assert p.stop_id == '631N'
    assert p.current_status == 'STOPPED_AT'


def test_parse_vehicle_positions_empty_bytes():
    assert parse_vehicle_positions(b'') == []


def test_parse_vehicle_positions_skips_entities_without_stop_id():
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = '2.0'
    feed.header.timestamp = 0
    entity = feed.entity.add()
    entity.id = 'vehicle-2'
    entity.vehicle.trip.route_id = '6'
    entity.vehicle.trip.trip_id = 'trip-v2'
    # no stop_id set
    entity.vehicle.current_status = gtfs_realtime_pb2.VehiclePosition.IN_TRANSIT_TO
    data = feed.SerializeToString()
    assert parse_vehicle_positions(data) == []
