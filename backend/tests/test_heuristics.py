from datetime import datetime, timezone, timedelta
from backend.heuristics.delay import compute_delay_signals
from backend.heuristics.commute import compute_departure
from backend.gtfs.models import ArrivalRecord, LineStatus


def _arrival(stop_id, route_id, delay_sec, minutes_from_now):
    return ArrivalRecord(
        route_id=route_id, trip_id=f't-{minutes_from_now}', stop_id=stop_id,
        arrival_time=datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now),
        delay_sec=delay_sec, direction='N',
    )


def test_delay_signals_nominal():
    records = [_arrival('631N', '6', 0, i) for i in range(2, 20, 3)]
    signals = compute_delay_signals(records)
    assert signals['6']['status'] == LineStatus.NOMINAL.value
    assert signals['6']['avg_delay_sec'] == 0.0


def test_delay_signals_delayed():
    records = [_arrival('631N', '6', 180, i) for i in range(2, 20, 3)]
    signals = compute_delay_signals(records)
    assert signals['6']['status'] == LineStatus.DELAYED.value


def test_compute_departure_returns_dict():
    now = datetime.now(timezone.utc)
    origin_arrival = ArrivalRecord(
        route_id='6', trip_id='t1', stop_id='631N',
        arrival_time=now + timedelta(minutes=3),
        delay_sec=0, direction='N',
    )
    result = compute_departure(
        next_arrival=origin_arrival,
        travel_sec=420,  # 7 min travel
    )
    assert 'leave_in_sec' in result
    assert 'arrive_at' in result
    assert result['leave_in_sec'] >= 0
