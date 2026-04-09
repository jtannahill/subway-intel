from datetime import datetime, timezone
from backend.gtfs.models import ArrivalRecord, ServiceAlert, LineStatus
from backend.gtfs.state import LiveState


def _make_record(stop_id='631N', route_id='6', delay_sec=0, minutes_from_now=2):
    now = datetime.now(timezone.utc)
    from datetime import timedelta
    return ArrivalRecord(
        route_id=route_id,
        trip_id=f'trip-{stop_id}-{minutes_from_now}',
        stop_id=stop_id,
        arrival_time=now + timedelta(minutes=minutes_from_now),
        delay_sec=delay_sec,
        direction=stop_id[-1] if stop_id[-1] in ('N', 'S') else 'N',
    )


def test_ingest_updates_arrivals():
    state = LiveState()
    records = [_make_record('631N', '6', 0, 2), _make_record('631N', '6', 0, 5)]
    state.ingest(records, alerts=[])
    arrivals = state.get_arrivals('631N')
    assert len(arrivals) == 2
    assert arrivals[0].stop_id == '631N'


def test_get_arrivals_sorted_by_time():
    state = LiveState()
    records = [_make_record('631N', '6', 0, 8), _make_record('631N', '6', 0, 2)]
    state.ingest(records, alerts=[])
    arrivals = state.get_arrivals('631N')
    assert arrivals[0].arrival_time < arrivals[1].arrival_time


def test_line_health_snapshot():
    state = LiveState()
    records = [_make_record('631N', '6', delay_sec=200, minutes_from_now=3)]
    state.ingest(records, alerts=[])
    health = state.get_line_health()
    route_health = next(h for h in health if h.route_id == '6')
    assert route_health.status == LineStatus.DELAYED


def test_ingest_prunes_past_arrivals():
    state = LiveState()
    from datetime import timedelta
    past = ArrivalRecord(
        route_id='6', trip_id='old', stop_id='631N',
        arrival_time=datetime.now(timezone.utc) - timedelta(minutes=5),
        delay_sec=0, direction='N',
    )
    state.ingest([past], alerts=[])
    arrivals = state.get_arrivals('631N')
    assert len(arrivals) == 0
