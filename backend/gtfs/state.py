from __future__ import annotations
import threading
from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean, variance

from backend.gtfs.models import ArrivalRecord, LineHealth, LineStatus, ServiceAlert


class LiveState:
    """Thread-safe in-memory store for live subway state."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # stop_id → list of upcoming ArrivalRecords
        self._arrivals: dict[str, list[ArrivalRecord]] = defaultdict(list)
        # route_id → list of recent delay_sec values (capped at 100)
        self._delay_history: dict[str, list[int]] = defaultdict(list)
        # route_id → list of recent headways (seconds between consecutive trains)
        self._headways: dict[str, list[float]] = defaultdict(list)
        # route_id → list of active alert headers
        self._alerts: dict[str, list[str]] = defaultdict(list)

    def ingest(self, records: list[ArrivalRecord], alerts: list[ServiceAlert]) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            # Reset arrivals; only keep future ones
            self._arrivals.clear()
            for r in records:
                if r.arrival_time > now:
                    self._arrivals[r.stop_id].append(r)

            # Update delay history per route (cap at 100 samples)
            for r in records:
                history = self._delay_history[r.route_id]
                history.append(r.delay_sec)
                if len(history) > 100:
                    history.pop(0)

            # Compute headways: sort arrivals per route, measure gaps
            route_arrivals: dict[str, list[ArrivalRecord]] = defaultdict(list)
            for r in records:
                route_arrivals[r.route_id].append(r)
            for route_id, rarrivals in route_arrivals.items():
                sorted_arr = sorted(rarrivals, key=lambda x: x.arrival_time)
                gaps: list[float] = []
                for i in range(1, len(sorted_arr)):
                    gap = (
                        sorted_arr[i].arrival_time - sorted_arr[i - 1].arrival_time
                    ).total_seconds()
                    if 0 < gap < 1800:  # ignore gaps > 30 min (end of service)
                        gaps.append(gap)
                if gaps:
                    hw = self._headways[route_id]
                    hw.extend(gaps)
                    if len(hw) > 50:
                        self._headways[route_id] = hw[-50:]

            # Reset alerts
            self._alerts.clear()
            for alert in alerts:
                self._alerts[alert.route_id].append(alert.header)

    def get_arrivals(self, stop_id: str, limit: int = 3) -> list[ArrivalRecord]:
        with self._lock:
            records = sorted(
                self._arrivals.get(stop_id, []), key=lambda r: r.arrival_time
            )
            return records[:limit]

    def get_line_health(self) -> list[LineHealth]:
        with self._lock:
            return self._compute_line_health()

    def snapshot(self) -> dict:
        """Return full state as a serializable dict for WebSocket broadcast."""
        now = datetime.now(timezone.utc)
        with self._lock:
            arrivals_out: dict[str, list[dict]] = {}
            for stop_id, records in self._arrivals.items():
                upcoming = [r for r in records if r.arrival_time > now]
                if upcoming:
                    arrivals_out[stop_id] = [
                        {
                            'route_id': r.route_id,
                            'trip_id': r.trip_id,
                            'arrival_time': r.arrival_time.isoformat(),
                            'delay_sec': r.delay_sec,
                            'direction': r.direction,
                        }
                        for r in sorted(upcoming, key=lambda x: x.arrival_time)[:3]
                    ]

            # Inline health computation — avoids re-acquiring the lock
            health = self._compute_line_health()

            return {
                'type': 'snapshot',
                'arrivals': arrivals_out,
                'line_health': [
                    {
                        'route_id': h.route_id,
                        'status': h.status.value,
                        'avg_delay_sec': round(h.avg_delay_sec, 1),
                        'headway_variance': round(h.headway_variance, 1),
                        'alerts': h.alerts,
                    }
                    for h in health
                ],
            }

    # ------------------------------------------------------------------
    # Private helpers (must only be called while self._lock is held)
    # ------------------------------------------------------------------

    def _compute_line_health(self) -> list[LineHealth]:
        """Build LineHealth list from current state. Caller must hold self._lock."""
        all_routes = set(self._delay_history.keys()) | set(self._alerts.keys())
        result: list[LineHealth] = []
        for route_id in all_routes:
            history = self._delay_history.get(route_id, [0])
            avg_delay = mean(history) if history else 0.0
            hw = self._headways.get(route_id, [])
            hw_variance = variance(hw) if len(hw) >= 2 else 0.0
            status = LineHealth.status_from_delay(avg_delay)
            result.append(
                LineHealth(
                    route_id=route_id,
                    status=status,
                    avg_delay_sec=avg_delay,
                    headway_variance=hw_variance,
                    alerts=list(self._alerts.get(route_id, [])),
                )
            )
        return sorted(result, key=lambda h: h.route_id)
