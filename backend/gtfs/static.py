from __future__ import annotations
import csv
import io
import logging
import math
import zipfile
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GTFS_STATIC_URL = 'http://web.mta.info/developers/data/nyct/subway/google_transit.zip'

# load() must be called once at startup (before the async event loop starts).
# Reads are safe after that. Do NOT call load() from a background thread.
# stop_id -> {name: str, routes: list[str]}
_stops: dict[str, dict] = {}
# (origin_stop_id, dest_stop_id) -> travel_sec  (naive: same trip lookup)
_travel_times: dict[tuple[str, str], int] = {}


def load(data_dir: Optional[Path] = None) -> None:
    """Download and parse static GTFS. Call once at startup."""
    global _stops, _travel_times
    try:
        if data_dir and (data_dir / 'google_transit.zip').exists():
            raw = (data_dir / 'google_transit.zip').read_bytes()
        else:
            logger.info('Downloading static GTFS...')
            resp = httpx.get(GTFS_STATIC_URL, timeout=30.0, follow_redirects=True)
            resp.raise_for_status()
            raw = resp.content
            if data_dir:
                data_dir.mkdir(parents=True, exist_ok=True)
                (data_dir / 'google_transit.zip').write_bytes(raw)

        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            _parse_stops(zf)
            _parse_stop_times(zf)
        logger.info('Static GTFS loaded: %d stops, %d travel pairs', len(_stops), len(_travel_times))
    except Exception as e:
        logger.error('Static GTFS load failed: %s', e)


def _parse_stops(zf: zipfile.ZipFile) -> None:
    global _stops
    with zf.open('stops.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            _stops[row['stop_id']] = {
                'name': row['stop_name'],
                'lat': float(row.get('stop_lat') or 0),
                'lon': float(row.get('stop_lon') or 0),
                'parent_station': row.get('parent_station', '').strip(),
            }


def _parse_stop_times(zf: zipfile.ZipFile) -> None:
    """Build travel time lookup from stop_times.txt (same trip = direct travel)."""
    global _travel_times
    # trip_id -> ordered list of (stop_id, arrival_seconds_since_midnight)
    trip_stops: dict[str, list[tuple[str, int]]] = {}
    with zf.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            trip_id = row['trip_id']
            stop_id = row['stop_id']
            arr = _parse_hhmmss(row.get('arrival_time', '0:0:0'))
            if trip_id not in trip_stops:
                trip_stops[trip_id] = []
            trip_stops[trip_id].append((stop_id, arr))

    for stops in trip_stops.values():
        stops.sort(key=lambda x: x[1])
        for i, (orig, t_orig) in enumerate(stops):
            for dest, t_dest in stops[i+1:]:
                key = (orig, dest)
                travel = t_dest - t_orig
                if key not in _travel_times or travel < _travel_times[key]:
                    _travel_times[key] = travel


def _parse_hhmmss(s: str) -> int:
    parts = s.strip().split(':')
    if len(parts) != 3:
        return 0
    h, m, sec = int(parts[0]), int(parts[1]), int(parts[2])
    return h * 3600 + m * 60 + sec


def get_stop_name(stop_id: str) -> str:
    return _stops.get(stop_id, {}).get('name', stop_id)


def get_travel_sec(origin_stop_id: str, dest_stop_id: str) -> Optional[int]:
    return _travel_times.get((origin_stop_id, dest_stop_id))


def search_stops(query: str, limit: int = 10) -> list[dict]:
    """Search stops by name, deduplicated — one result per station name.
    Prefers the parent stop_id (no N/S suffix) over directional variants.
    Returns: [{stop_id, name, lat, lon}]
    """
    q = query.lower()
    # name -> (stop_id, info): accumulate best stop_id per name
    by_name: dict[str, tuple[str, dict]] = {}
    for sid, info in _stops.items():
        name = info['name']
        if q not in name.lower():
            continue
        if name not in by_name:
            by_name[name] = (sid, info)
        else:
            existing_sid, existing_info = by_name[name]
            # Prefer parent stop (empty parent_station) over directional child
            if existing_info.get('parent_station') and not info.get('parent_station'):
                by_name[name] = (sid, info)
    results = [
        {'stop_id': sid, 'name': info['name'], 'lat': info['lat'], 'lon': info['lon']}
        for sid, info in by_name.values()
    ]
    return results[:limit]


def nearest_stops(lat: float, lon: float, limit: int = 1) -> list[dict]:
    """Return the closest stops to (lat, lon) by approximate distance in miles.
    Only considers parent stops (no N/S suffix) to avoid duplicate station names.
    Returns: [{stop_id, name, lat, lon, distance_mi}]
    """
    LAT_MI = 69.0    # miles per degree latitude
    LON_MI = 52.5    # miles per degree longitude at NYC (~40.7° N)

    def dist_mi(info: dict) -> float:
        dlat = (info['lat'] - lat) * LAT_MI
        dlon = (info['lon'] - lon) * LON_MI
        return math.sqrt(dlat ** 2 + dlon ** 2)

    candidates = [
        {
            'stop_id': sid,
            'name': info['name'],
            'lat': info['lat'],
            'lon': info['lon'],
            '_dist': dist_mi(info),
        }
        for sid, info in _stops.items()
        if info['lat'] != 0 and not info.get('parent_station')
    ]
    candidates.sort(key=lambda x: x['_dist'])
    return [
        {
            'stop_id': c['stop_id'],
            'name': c['name'],
            'lat': c['lat'],
            'lon': c['lon'],
            'distance_mi': round(c['_dist'], 2),
        }
        for c in candidates[:limit]
    ]
