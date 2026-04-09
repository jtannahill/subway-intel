from __future__ import annotations
from collections import defaultdict
from statistics import mean

from backend.gtfs.models import ArrivalRecord, LineHealth, LineStatus


def compute_delay_signals(records: list[ArrivalRecord]) -> dict[str, dict]:
    """
    Given a list of ArrivalRecords, compute per-route delay signals.
    Returns dict: route_id -> {status, avg_delay_sec, trend}
    """
    by_route: dict[str, list[int]] = defaultdict(list)
    for r in records:
        by_route[r.route_id].append(r.delay_sec)

    signals = {}
    for route_id, delays in by_route.items():
        avg = mean(delays) if delays else 0.0
        status = LineHealth.status_from_delay(avg)
        signals[route_id] = {
            'route_id': route_id,
            'status': status.value,
            'avg_delay_sec': round(avg, 1),
        }
    return signals
