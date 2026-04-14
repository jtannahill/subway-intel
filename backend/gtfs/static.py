from __future__ import annotations
import csv
import io
import logging
import math
import statistics
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
# (route_id, direction_id) -> ordered [{stop_id, name}] from canonical trip
_route_stops: dict[tuple[str, int], list[dict]] = {}
# origin_stop_id -> {dest_stop_id: travel_sec}  (fast reachability lookup)
_forward_index: dict[str, dict[str, int]] = {}
# shape_id -> ordered [[lon, lat], ...]  (GeoJSON coord order)
_shapes: dict[str, list[list[float]]] = {}
# shape_id -> route_id
_shape_to_route: dict[str, str] = {}
# parent stop_id -> sorted [route_ids]
_stop_routes: dict[str, list[str]] = {}
# (route_id, stop_id) -> prev stop_id in canonical sequence (for interpolation)
_stop_prev_in_route: dict[tuple[str, str], str] = {}
# route_id -> median scheduled headway in seconds (peak approximation from GTFS)
_scheduled_headways: dict[str, float] = {}
# (route_id, stop_id) -> index in canonical stop sequence
_stop_index_in_route: dict[tuple[str, str], int] = {}
# Internal: (route_id, direction_id) -> sorted list of departure times (seconds) at reference stop
# Populated during _parse_route_stops, consumed by _build_scheduled_headways, then cleared.
_ref_stop_departures: dict[tuple[str, int], list[int]] = {}
# (trip_id, stop_id) -> arrival_seconds_since_service_midnight (may exceed 86400 for next-day service)
_scheduled_arrivals: dict[tuple[str, str], int] = {}
# trip_id -> shape_id  (built during _parse_route_stops from trips.txt)
_trip_shape_id: dict[str, str] = {}
# (shape_id, stop_id) -> index into _shapes[shape_id]  (built by _build_shape_stop_indices)
_shape_stop_idx: dict[tuple[str, str], int] = {}
# Temp: trip_id -> [(stop_sequence, stop_id)] — populated during _parse_route_stops, consumed then cleared
_trip_stop_seqs_temp: dict[str, list[tuple[int, str]]] = {}


def load(data_dir: Optional[Path] = None) -> None:
    """Download and parse static GTFS. Call once at startup."""
    global _stops, _travel_times, _route_stops
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
            _parse_route_stops(zf)
            _parse_shapes(zf)
        _build_forward_index()
        _build_stop_routes()
        _build_stop_prev_in_route()
        _build_scheduled_headways()
        _build_stop_index_in_route()
        _build_shape_stop_indices()
        logger.info('Static GTFS loaded: %d stops, %d travel pairs, %d route-direction sequences, %d shapes',
                    len(_stops), len(_travel_times), len(_route_stops), len(_shapes))
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
    """Build travel time lookup and scheduled arrival index from stop_times.txt."""
    global _travel_times, _scheduled_arrivals
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
            # Store for delay computation: (trip_id, stop_id) -> scheduled arrival sec
            _scheduled_arrivals[(trip_id, stop_id)] = arr

    for stops in trip_stops.values():
        stops.sort(key=lambda x: x[1])
        for i, (orig, t_orig) in enumerate(stops):
            for dest, t_dest in stops[i+1:]:
                key = (orig, dest)
                travel = t_dest - t_orig
                if key not in _travel_times or travel < _travel_times[key]:
                    _travel_times[key] = travel


def _parse_route_stops(zf: zipfile.ZipFile) -> None:
    """Build canonical stop sequence per (route_id, direction_id).
    Uses the trip with the longest stop count as the canonical trip.
    Also collects departure times at each route's reference stop for headway computation."""
    global _route_stops, _ref_stop_departures

    # Read trips.txt: trip_id -> (route_id, direction_id) and trip_id -> shape_id
    global _trip_shape_id
    trip_meta: dict[str, tuple[str, int]] = {}
    with zf.open('trips.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            route_id = row.get('route_id', '').strip()
            trip_id = row.get('trip_id', '').strip()
            shape_id = row.get('shape_id', '').strip()
            direction_id = int(row.get('direction_id', '0') or '0')
            if route_id and trip_id:
                trip_meta[trip_id] = (route_id, direction_id)
                if shape_id:
                    _trip_shape_id[trip_id] = shape_id

    # Read stop_times.txt: group by trip_id, ordered by stop_sequence
    # Also capture departure times per (stop_id, trip_id) for headway computation
    trip_stop_seqs: dict[str, list[tuple[int, str]]] = {}
    trip_stop_dep: dict[str, dict[str, int]] = {}  # trip_id -> stop_id -> departure_sec
    with zf.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            trip_id = row.get('trip_id', '').strip()
            stop_id = row.get('stop_id', '').strip()
            seq = int(row.get('stop_sequence', '0') or '0')
            dep_str = row.get('departure_time', '') or row.get('arrival_time', '')
            if trip_id and stop_id:
                if trip_id not in trip_stop_seqs:
                    trip_stop_seqs[trip_id] = []
                    trip_stop_dep[trip_id] = {}
                trip_stop_seqs[trip_id].append((seq, stop_id))
                if dep_str:
                    trip_stop_dep[trip_id][stop_id] = _parse_hhmmss(dep_str)

    # For each (route_id, direction_id), pick the trip with most stops
    best: dict[tuple[str, int], list[tuple[int, str]]] = {}
    for trip_id, (route_id, direction_id) in trip_meta.items():
        stops = trip_stop_seqs.get(trip_id, [])
        key = (route_id, direction_id)
        if key not in best or len(stops) > len(best[key]):
            best[key] = stops

    # Sort by stop_sequence, map stop_id -> name
    _route_stops.clear()
    for (route_id, direction_id), stops in best.items():
        stops.sort(key=lambda x: x[0])
        _route_stops[(route_id, direction_id)] = [
            {'stop_id': sid, 'name': _stops.get(sid, {}).get('name', sid)}
            for _, sid in stops
        ]

    # Collect departure times at the reference stop for each (route_id, direction_id)
    # Reference stop = index len(stops) // 3 in the canonical sequence
    # For each route/direction, gather all trips' departure times at that stop, then sort.
    _ref_stop_departures.clear()
    # Build canonical reference stop per key
    ref_stop_for_key: dict[tuple[str, int], str] = {}
    for key, stops in _route_stops.items():
        if stops:
            ref_idx = len(stops) // 3
            ref_stop_for_key[key] = stops[ref_idx]['stop_id']

    # Accumulate departure times across all trips
    raw_deps: dict[tuple[str, int], list[int]] = {}
    for trip_id, (route_id, direction_id) in trip_meta.items():
        key = (route_id, direction_id)
        ref_stop = ref_stop_for_key.get(key)
        if ref_stop is None:
            continue
        dep_time = trip_stop_dep.get(trip_id, {}).get(ref_stop)
        if dep_time is not None:
            raw_deps.setdefault(key, []).append(dep_time)

    for key, times in raw_deps.items():
        times.sort()
        _ref_stop_departures[key] = times

    # Store trip stop sequences for shape matching (consumed by _build_shape_stop_indices)
    global _trip_stop_seqs_temp
    _trip_stop_seqs_temp = trip_stop_seqs


def _parse_hhmmss(s: str) -> int:
    parts = s.strip().split(':')
    if len(parts) != 3:
        return 0
    h, m, sec = int(parts[0]), int(parts[1]), int(parts[2])
    return h * 3600 + m * 60 + sec


def _parse_shapes(zf: zipfile.ZipFile) -> None:
    global _shapes, _shape_to_route
    names = zf.namelist()
    if 'shapes.txt' not in names:
        logger.warning('shapes.txt not found in GTFS zip — track overlay unavailable')
        return

    raw: dict[str, list[tuple[int, float, float]]] = {}
    with zf.open('shapes.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            sid = row['shape_id']
            lat = float(row['shape_pt_lat'])
            lon = float(row['shape_pt_lon'])
            seq = int(row['shape_pt_sequence'])
            if sid not in raw:
                raw[sid] = []
            raw[sid].append((seq, lat, lon))

    _shapes = {}
    for sid, pts in raw.items():
        pts.sort(key=lambda x: x[0])
        _shapes[sid] = [[p[2], p[1]] for p in pts]  # [lon, lat] for GeoJSON

    # Map shape_id → route_id (first trip that references the shape wins)
    _shape_to_route = {}
    if 'trips.txt' in names:
        with zf.open('trips.txt') as f:
            reader = csv.DictReader(io.TextIOWrapper(f))
            for row in reader:
                sid = row.get('shape_id', '').strip()
                rid = row.get('route_id', '').strip()
                if sid and rid and sid not in _shape_to_route:
                    _shape_to_route[sid] = rid


def _build_stop_routes() -> None:
    global _stop_routes
    index: dict[str, set[str]] = {}
    for (route_id, _), stops in _route_stops.items():
        for stop in stops:
            base = stop['stop_id'].rstrip('NS')
            index.setdefault(base, set()).add(route_id)
    _stop_routes = {k: sorted(v) for k, v in index.items()}


def _build_stop_prev_in_route() -> None:
    global _stop_prev_in_route
    _stop_prev_in_route = {}
    for (route_id, _), stops in _route_stops.items():
        for i in range(1, len(stops)):
            curr = stops[i]['stop_id']
            prev = stops[i - 1]['stop_id']
            # Don't overwrite if already set (first direction wins)
            if (route_id, curr) not in _stop_prev_in_route:
                _stop_prev_in_route[(route_id, curr)] = prev


def _build_scheduled_headways() -> None:
    """Compute median scheduled headway (seconds) per route_id from GTFS departure times.

    For each (route_id, direction_id), uses the departure times collected at the
    canonical reference stop (index len(stops)//3) during _parse_route_stops.
    Computes consecutive gaps, takes the median, and stores the minimum across
    directions under route_id (typically direction 0 and 1 yield similar values;
    taking the min gives the more frequent service figure).
    Clears _ref_stop_departures when done to free memory.
    """
    global _scheduled_headways, _ref_stop_departures
    route_medians: dict[str, list[float]] = {}
    for (route_id, _direction_id), times in _ref_stop_departures.items():
        if len(times) < 2:
            continue
        gaps = [times[i] - times[i - 1] for i in range(1, len(times)) if 0 < times[i] - times[i - 1] < 3600]
        if not gaps:
            continue
        median_gap = statistics.median(gaps)
        route_medians.setdefault(route_id, []).append(median_gap)

    _scheduled_headways = {
        route_id: min(medians)
        for route_id, medians in route_medians.items()
    }
    _ref_stop_departures.clear()


def _build_stop_index_in_route() -> None:
    """Build (route_id, stop_id) -> index mapping from canonical _route_stops sequences."""
    global _stop_index_in_route
    _stop_index_in_route = {}
    for (route_id, _direction_id), stops in _route_stops.items():
        for i, stop in enumerate(stops):
            key = (route_id, stop['stop_id'])
            # First direction that defines the key wins (consistent with _stop_prev_in_route)
            if key not in _stop_index_in_route:
                _stop_index_in_route[key] = i


def _build_shape_stop_indices() -> None:
    """Map (shape_id, stop_id) → index in shape coord list using monotone nearest-point matching.

    For each trip, walks its stop sequence and finds the closest shape point
    at-or-after the previous stop's match, enforcing monotone ordering.
    One representative trip per shape is sufficient; subsequent trips sharing
    the same shape will reuse the entries already written.
    """
    global _shape_stop_idx, _trip_stop_seqs_temp
    if not _trip_stop_seqs_temp or not _shapes:
        return

    # Build shape_id -> representative sorted stop list from one trip per shape
    # Use the trip with the most stops for each shape.
    shape_best_trip: dict[str, tuple[int, list[tuple[int, str]]]] = {}
    for trip_id, shape_id in _trip_shape_id.items():
        seqs = _trip_stop_seqs_temp.get(trip_id)
        if not seqs:
            continue
        count = len(seqs)
        if shape_id not in shape_best_trip or count > shape_best_trip[shape_id][0]:
            shape_best_trip[shape_id] = (count, seqs)

    for shape_id, (_count, seqs) in shape_best_trip.items():
        shape = _shapes.get(shape_id)
        if not shape or len(shape) < 2:
            continue

        # Sort stops by stop_sequence
        sorted_seqs = sorted(seqs, key=lambda x: x[0])
        search_from = 0
        n = len(shape)

        for _seq, stop_id in sorted_seqs:
            stop_info = _stops.get(stop_id)
            if not stop_info:
                continue
            slat = stop_info['lat']
            slon = stop_info['lon']

            # Search for nearest shape point from search_from onward (monotone)
            best_dist = float('inf')
            best_idx = search_from
            # Cap search window to avoid runaway O(n²)
            end = min(search_from + 300, n)
            for i in range(search_from, end):
                lon, lat = shape[i]
                d = (lat - slat) ** 2 + (lon - slon) ** 2
                if d < best_dist:
                    best_dist = d
                    best_idx = i

            key = (shape_id, stop_id)
            if key not in _shape_stop_idx:
                _shape_stop_idx[key] = best_idx
            search_from = best_idx  # monotone: next stop must be at or after this

    _trip_stop_seqs_temp.clear()
    logger.info('Shape stop indices built: %d entries across %d shapes',
                len(_shape_stop_idx), len(shape_best_trip))


def get_prev_stop_id(route_id: str, stop_id: str) -> str | None:
    """Return the stop before stop_id in the route's canonical sequence."""
    return _stop_prev_in_route.get((route_id, stop_id))


def get_scheduled_headway(route_id: str) -> float | None:
    """Return median scheduled headway in seconds for the given route, or None."""
    return _scheduled_headways.get(route_id)


def get_stop_index(route_id: str, stop_id: str) -> int | None:
    """Return the position of stop_id in the canonical sequence for route_id, or None."""
    return _stop_index_in_route.get((route_id, stop_id))


def get_scheduled_arrival_sec(trip_id: str, stop_id: str) -> int | None:
    """Return the GTFS-static scheduled arrival time in seconds since service midnight, or None."""
    return _scheduled_arrivals.get((trip_id, stop_id))


def get_shape_segment(
    trip_id: str,
    from_stop_id: str,
    to_stop_id: str,
) -> list[list[float]] | None:
    """Return the shape polyline [[lon,lat],...] from from_stop to to_stop for this trip.

    Returns None when shape data is unavailable or the stop pair can't be located.
    The returned list is safe to serialize as JSON (plain lists, not tuples).
    """
    shape_id = _trip_shape_id.get(trip_id)
    if not shape_id:
        return None
    shape = _shapes.get(shape_id)
    if not shape or len(shape) < 2:
        return None

    def resolve_idx(stop_id: str) -> int | None:
        idx = _shape_stop_idx.get((shape_id, stop_id))
        if idx is not None:
            return idx
        # Try stripping/swapping N/S suffix
        if stop_id and stop_id[-1] in ('N', 'S'):
            base = stop_id[:-1]
            for s in ('N', 'S'):
                idx = _shape_stop_idx.get((shape_id, base + s))
                if idx is not None:
                    return idx
        return None

    idx_from = resolve_idx(from_stop_id)
    idx_to = resolve_idx(to_stop_id)
    if idx_from is None or idx_to is None:
        return None

    if idx_from == idx_to:
        return None

    if idx_from < idx_to:
        seg = shape[idx_from: idx_to + 1]
    else:
        # Train traversing shape in reverse (e.g. some SI or special services)
        seg = list(reversed(shape[idx_to: idx_from + 1]))

    # Sanity: reject implausibly long segments (> 100 points = miscalibrated match)
    if len(seg) > 100:
        return None

    return seg


def get_tracks_geojson() -> dict:
    """GeoJSON FeatureCollection of all subway track geometries, one Feature per shape."""
    features = []
    for shape_id, coords in _shapes.items():
        route_id = _shape_to_route.get(shape_id)
        if not route_id or len(coords) < 2:
            continue
        features.append({
            'type': 'Feature',
            'properties': {'route_id': route_id},
            'geometry': {'type': 'LineString', 'coordinates': coords},
        })
    return {'type': 'FeatureCollection', 'features': features}


def get_all_parent_stops() -> list[dict]:
    """All parent stops with lat/lon and route_ids — used for map initialisation."""
    return [
        {
            'stop_id': sid,
            'name': info['name'],
            'lat': info['lat'],
            'lon': info['lon'],
            'route_ids': _stop_routes.get(sid, []),
        }
        for sid, info in _stops.items()
        if info['lat'] != 0 and info['lon'] != 0 and not info.get('parent_station')
    ]


def _build_forward_index() -> None:
    global _forward_index
    _forward_index = {}
    for (orig, dest), sec in _travel_times.items():
        if orig not in _forward_index:
            _forward_index[orig] = {}
        _forward_index[orig][dest] = sec


TRANSFER_PENALTY_SEC = 240  # 4-minute platform transfer buffer


def find_transfer_route(
    origin_stops: list[str],
    dest_stops: list[str],
) -> 'Optional[dict]':
    """
    Find the fastest 1-transfer route from any origin stop to any dest stop.
    Returns dict with transfer details, or None if no path exists.
    """
    best: 'Optional[dict]' = None
    best_total: 'Optional[int]' = None

    for o_stop in origin_stops:
        reachable = _forward_index.get(o_stop, {})
        for transfer_arrive, t1 in reachable.items():
            # Strip direction suffix to get the base station, try both directions for leg 2
            transfer_base = transfer_arrive[:-1] if transfer_arrive and transfer_arrive[-1] in ('N', 'S') else transfer_arrive
            for d_dir in ('N', 'S'):
                transfer_depart = transfer_base + d_dir
                leg2_reachable = _forward_index.get(transfer_depart, {})
                for d_stop in dest_stops:
                    t2 = leg2_reachable.get(d_stop)
                    if t2 is None:
                        continue
                    total = t1 + TRANSFER_PENALTY_SEC + t2
                    if best_total is None or total < best_total:
                        best = {
                            'origin_stop': o_stop,
                            'transfer_stop_arrive': transfer_arrive,
                            'transfer_stop_depart': transfer_depart,
                            'dest_stop': d_stop,
                            'leg1_sec': t1,
                            'leg2_sec': t2,
                            'total_sec': total,
                            'transfer_name': get_stop_name(transfer_arrive),
                        }
                        best_total = total

    return best


def get_route_stops(route_id: str, direction_id: int) -> list[dict]:
    """Return canonical ordered stop list for a route+direction.
    Each entry: {stop_id: str, name: str}. Empty list if not found."""
    return _route_stops.get((route_id, direction_id), [])


def get_stop_name(stop_id: str) -> str:
    return _stops.get(stop_id, {}).get('name', stop_id)


def get_travel_sec(origin_stop_id: str, dest_stop_id: str) -> Optional[int]:
    return _travel_times.get((origin_stop_id, dest_stop_id))


def get_parent_stops_by_name(name: str) -> list[str]:
    """Return all parent stop_ids (no N/S suffix) whose name matches exactly.
    Used by the commute endpoint to try all physical stops at a named station
    (e.g. 'Times Sq-42 St' has 4 distinct parent stops for different lines).
    """
    return [
        sid for sid, info in _stops.items()
        if info['name'] == name and not sid.endswith(('N', 'S'))
    ]


def search_stops(query: str, limit: int = 10) -> list[dict]:
    """Search stops by name, deduplicated — one result per station name.
    Prefers the parent stop_id (no N/S suffix) over directional variants.
    Returns: [{stop_id, name, lat, lon}]
    """
    q = query.lower()
    if not q:
        return []
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
    results.sort(key=lambda r: r['name'])
    return results[:limit]


def nearest_stops(lat: float, lon: float, limit: int = 1) -> list[dict]:
    """Return the closest stops to (lat, lon) by approximate distance in miles.
    Only considers parent stops (empty parent_station) to avoid duplicate station names.
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
        if info['lat'] != 0 and info['lon'] != 0 and not info.get('parent_station')
    ]
    candidates.sort(key=lambda x: x['_dist'])
    return [
        {
            'stop_id': c['stop_id'],
            'name': c['name'],
            'lat': c['lat'],
            'lon': c['lon'],
            'distance_mi': round(c['_dist'], 2),
            'route_ids': _stop_routes.get(c['stop_id'], []),
        }
        for c in candidates[:limit]
    ]
