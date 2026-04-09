import pytest
from datetime import datetime, timezone
from google.transit import gtfs_realtime_pb2


@pytest.fixture
def sample_feed_bytes() -> bytes:
    """Minimal GTFS-RT FeedMessage with one TripUpdate."""
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = '2.0'
    feed.header.timestamp = int(datetime(2026, 4, 9, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    entity = feed.entity.add()
    entity.id = 'trip-1'
    entity.trip_update.trip.route_id = '6'
    entity.trip_update.trip.trip_id = 'trip-1'

    stu = entity.trip_update.stop_time_update.add()
    stu.stop_id = '631N'
    stu.arrival.time = int(datetime(2026, 4, 9, 12, 2, 0, tzinfo=timezone.utc).timestamp())
    stu.arrival.delay = 120  # 2 min late

    return feed.SerializeToString()
