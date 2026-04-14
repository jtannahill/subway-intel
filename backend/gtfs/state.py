from __future__ import annotations
import threading
from collections import defaultdict, deque
from datetime import datetime, timezone
from statistics import mean, variance
from typing import Any

from datetime import timedelta

from backend.gtfs.models import ArrivalRecord, LineHealth, LineStatus, ServiceAlert, VehiclePosition
from backend.gtfs.static import get_prev_stop_id, get_travel_sec, get_scheduled_headway, get_stop_index, get_shape_segment


class LiveState:
    """Thread-safe in-memory store for live subway state."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # stop_id → list of upcoming ArrivalRecords
        self._arrivals: dict[str, list[ArrivalRecord]] = defaultdict(list)
        # route_id → deque of recent delay_sec values (capped at 100)
        self._delay_history: dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
        # route_id → deque of recent headways (seconds between consecutive trains)
        self._headways: dict[str, deque] = defaultdict(lambda: deque(maxlen=50))
        # route_id → list of active alert headers
        self._alerts: dict[str, list[str]] = defaultdict(list)
        # route_id → list of alert effects (e.g. 'SIGNIFICANT_DELAYS', 'NO_SERVICE')
        self._alert_effects: dict[str, list[str]] = defaultdict(list)
        # trip_id → VehiclePosition (last position per trip)
        self._vehicle_positions: dict[str, VehiclePosition] = {}
        # trip_id → sorted list of upcoming ArrivalRecords (built during ingest)
        self._trip_arrivals: dict[str, list[ArrivalRecord]] = {}

    def ingest(
        self,
        records: list[ArrivalRecord],
        alerts: list[ServiceAlert],
        vehicle_positions: list[VehiclePosition] | None = None,
    ) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            # Only keep future arrivals
            future = [r for r in records if r.arrival_time > now]

            # Reset arrivals with future records only
            self._arrivals.clear()
            for r in future:
                self._arrivals[r.stop_id].append(r)

            # Update delay history from future records only
            for r in future:
                self._delay_history[r.route_id].append(r.delay_sec)

            # Update headways from future records only
            route_arrivals: dict[str, list[ArrivalRecord]] = defaultdict(list)
            for r in future:
                route_arrivals[r.route_id].append(r)
            for route_id, rarrivals in route_arrivals.items():
                sorted_arr = sorted(rarrivals, key=lambda x: x.arrival_time)
                gaps = []
                for i in range(1, len(sorted_arr)):
                    gap = (sorted_arr[i].arrival_time - sorted_arr[i-1].arrival_time).total_seconds()
                    if 0 < gap < 1800:
                        gaps.append(gap)
                if gaps:
                    self._headways[route_id].extend(gaps)

            # Reset alerts
            self._alerts.clear()
            self._alert_effects.clear()
            for alert in alerts:
                self._alerts[alert.route_id].append(alert.header)
                self._alert_effects[alert.route_id].append(alert.effect)

            # Reset and store vehicle positions (last write per trip_id wins)
            self._vehicle_positions.clear()
            for vp in (vehicle_positions or []):
                self._vehicle_positions[vp.trip_id] = vp

            # Build trip → sorted arrivals index for movement interpolation
            trip_idx: dict[str, list[ArrivalRecord]] = {}
            for r in future:
                trip_idx.setdefault(r.trip_id, []).append(r)
            for lst in trip_idx.values():
                lst.sort(key=lambda r: r.arrival_time)
            self._trip_arrivals = trip_idx

    def get_arrivals(self, stop_id: str, limit: int = 3) -> list[ArrivalRecord]:
        with self._lock:
            records = sorted(
                self._arrivals.get(stop_id, []), key=lambda r: r.arrival_time
            )
            return records[:limit]

    def get_line_health(self) -> list[LineHealth]:
        with self._lock:
            return self._compute_line_health()

    def snapshot(self) -> dict[str, Any]:
        """Return full state as a serializable dict for WebSocket broadcast."""
        with self._lock:
            arrivals_out: dict[str, list[dict]] = {}
            for stop_id, records in self._arrivals.items():
                if records:
                    arrivals_out[stop_id] = [
                        {
                            'route_id': r.route_id,
                            'trip_id': r.trip_id,
                            'arrival_time': r.arrival_time.isoformat(),
                            'delay_sec': r.delay_sec,
                            'direction': r.direction,
                        }
                        for r in sorted(records, key=lambda x: x.arrival_time)[:3]
                    ]

            # Inline health computation — avoids re-acquiring the lock
            health = self._compute_line_health()

            hw_deques = self._headways
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
                        'current_headway_sec': (
                            round(mean(hw_deques[h.route_id]), 1)
                            if hw_deques.get(h.route_id)
                            else None
                        ),
                        'scheduled_headway_sec': get_scheduled_headway(h.route_id),
                    }
                    for h in health
                ],
                'vehicle_positions': [
                    self._serialize_vehicle(vp)
                    for vp in self._vehicle_positions.values()
                ],
                'bunches': self._detect_bunches(),
            }

    # ------------------------------------------------------------------
    # Private helpers (must only be called while self._lock is held)
    # ------------------------------------------------------------------

    def _serialize_vehicle(self, vp: VehiclePosition) -> dict:
        """Serialize a VehiclePosition including interpolation hints."""
        base: dict = {
            'trip_id': vp.trip_id,
            'route_id': vp.route_id,
            'stop_id': vp.stop_id,
            'status': vp.current_status,
            'prev_stop_id': None,
            'next_arrival_iso': None,
            'prev_arrival_iso': None,
        }

        # Only interpolate when the train is actually moving
        if vp.current_status == 'STOPPED_AT':
            return base

        prev_stop_id = get_prev_stop_id(vp.route_id, vp.stop_id)
        if not prev_stop_id:
            return base

        base['prev_stop_id'] = prev_stop_id

        # Look up next arrival time from trip updates
        trip_stops = self._trip_arrivals.get(vp.trip_id, [])
        next_rec = next((r for r in trip_stops if r.stop_id == vp.stop_id), None)
        if next_rec:
            base['next_arrival_iso'] = next_rec.arrival_time.isoformat()

        # Look up prev arrival; fall back to travel-time estimate if not in feed
        prev_rec = next((r for r in trip_stops if r.stop_id == prev_stop_id), None)
        if prev_rec:
            base['prev_arrival_iso'] = prev_rec.arrival_time.isoformat()
        elif next_rec:
            travel = get_travel_sec(prev_stop_id, vp.stop_id)
            if travel:
                base['prev_arrival_iso'] = (next_rec.arrival_time - timedelta(seconds=travel)).isoformat()

        # Shape segment for path-following interpolation in the frontend
        seg = get_shape_segment(vp.trip_id, prev_stop_id, vp.stop_id)
        if seg:
            base['segment_coords'] = seg

        return base

    def _compute_line_health(self) -> list[LineHealth]:
        """Build LineHealth list from current state. Caller must hold self._lock."""
        all_routes = set(self._delay_history.keys()) | set(self._alerts.keys())
        result: list[LineHealth] = []
        for route_id in all_routes:
            history = self._delay_history.get(route_id, deque())
            avg_delay = mean(history) if history else 0.0
            hw = self._headways.get(route_id, [])
            hw_variance = variance(hw) if len(hw) >= 2 else 0.0

            # Primary signal: delay from GTFS-RT vs scheduled times
            status = LineHealth.status_from_delay(avg_delay)

            # Secondary signal: active Mercury alert effects
            # These override NOMINAL when the delay signal is absent or weak
            effects = set(self._alert_effects.get(route_id, []))
            if status == LineStatus.NOMINAL:
                if effects & {'NO_SERVICE', 'REDUCED_SERVICE'}:
                    status = LineStatus.DISRUPTED
                elif effects & {'SIGNIFICANT_DELAYS', 'MODIFIED_SERVICE'}:
                    status = LineStatus.DELAYED
            elif status == LineStatus.DELAYED:
                if effects & {'NO_SERVICE', 'REDUCED_SERVICE'}:
                    status = LineStatus.DISRUPTED

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

    def _detect_bunches(self) -> list[dict]:
        """Detect bunched trains: two vehicles on the same route within 1 stop of each other.

        Must only be called while self._lock is held (called from snapshot()).
        Returns a deduplicated list of bunch events:
          {'route_id': str, 'trip_ids': [str, str], 'stop_ids': [str, str]}
        """
        # Group vehicle positions by route_id
        by_route: dict[str, list[VehiclePosition]] = {}
        for vp in self._vehicle_positions.values():
            by_route.setdefault(vp.route_id, []).append(vp)

        bunches: list[dict] = []
        seen: set[frozenset[str]] = set()  # frozenset of trip_id pairs already recorded

        for route_id, vehicles in by_route.items():
            if len(vehicles) < 2:
                continue
            for i in range(len(vehicles)):
                for j in range(i + 1, len(vehicles)):
                    vp_a = vehicles[i]
                    vp_b = vehicles[j]

                    pair_key = frozenset({vp_a.trip_id, vp_b.trip_id})
                    if pair_key in seen:
                        continue

                    idx_a = self._stop_index_for(route_id, vp_a.stop_id)
                    idx_b = self._stop_index_for(route_id, vp_b.stop_id)

                    if idx_a is None or idx_b is None:
                        continue

                    if abs(idx_a - idx_b) <= 1:
                        seen.add(pair_key)
                        bunches.append({
                            'route_id': route_id,
                            'trip_ids': [vp_a.trip_id, vp_b.trip_id],
                            'stop_ids': [vp_a.stop_id, vp_b.stop_id],
                        })

        return bunches

    def _stop_index_for(self, route_id: str, stop_id: str) -> int | None:
        """Try to resolve stop index with and without N/S directional suffix."""
        idx = get_stop_index(route_id, stop_id)
        if idx is not None:
            return idx
        # Try stripping the directional suffix and appending the other
        if stop_id and stop_id[-1] in ('N', 'S'):
            base = stop_id[:-1]
            for suffix in ('N', 'S'):
                idx = get_stop_index(route_id, base + suffix)
                if idx is not None:
                    return idx
        return None
