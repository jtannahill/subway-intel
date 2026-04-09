from datetime import datetime, timezone
from backend.gtfs.models import ArrivalRecord, ServiceAlert, LineHealth, LineStatus


def test_arrival_record_delay_minutes():
    r = ArrivalRecord(
        route_id='6',
        trip_id='trip-1',
        stop_id='631N',
        arrival_time=datetime(2026, 4, 9, 12, 0, 0, tzinfo=timezone.utc),
        delay_sec=180,
        direction='N',
    )
    assert r.delay_minutes == 3.0


def test_line_status_from_delay():
    assert LineHealth.status_from_delay(0) == LineStatus.NOMINAL
    assert LineHealth.status_from_delay(120) == LineStatus.DELAYED
    assert LineHealth.status_from_delay(600) == LineStatus.DISRUPTED
