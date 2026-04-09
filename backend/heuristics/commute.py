from __future__ import annotations
from datetime import datetime, timezone, timedelta

from backend.gtfs.models import ArrivalRecord

WALK_BUFFER_SEC = 90  # 90s buffer built into every commute recommendation


def compute_departure(
    next_arrival: ArrivalRecord,
    travel_sec: int,
) -> dict:
    """
    Given the next arriving train and travel time to destination,
    return when to leave and when you'd arrive.

    leave_in_sec: seconds from now until you should leave
    arrive_at:    ISO datetime when you'd reach the destination
    """
    now = datetime.now(timezone.utc)
    board_at = next_arrival.arrival_time
    arrive_at = board_at + timedelta(seconds=travel_sec)
    leave_at = board_at - timedelta(seconds=WALK_BUFFER_SEC)
    leave_in_sec = max(0, int((leave_at - now).total_seconds()))

    return {
        'leave_in_sec': leave_in_sec,
        'board_at': board_at.isoformat(),
        'arrive_at': arrive_at.isoformat(),
        'route_id': next_arrival.route_id,
        'trip_id': next_arrival.trip_id,
        'delay_sec': next_arrival.delay_sec,
    }
