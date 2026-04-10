# Real-Time Track Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse MTA GTFS-RT VehiclePosition entities (already in the feeds, currently discarded) and display them as a schematic per-line track diagram that expands inside the Network Pulse line accordion.

**Architecture:** `parse_vehicle_positions()` extracts train positions from the GTFS-RT protobuf feeds; `LiveState` stores them and includes them in the WebSocket snapshot; the frontend `TrackDiagram` component fetches the canonical stop sequence from a new REST endpoint and renders glowing dots for each train position. The diagram expands inline when a line group is toggled open in `NetworkPulse`.

**Tech Stack:** Python dataclasses, google-transit protobuf, FastAPI, React 19 + TypeScript, existing CSS variables + `pulse-glow` keyframe already in `index.css`.

---

## File Map

| File | Change |
|------|--------|
| `backend/gtfs/models.py` | Add `VehiclePosition` dataclass |
| `backend/gtfs/feed.py` | Add `parse_vehicle_positions()` |
| `backend/gtfs/state.py` | Add `_vehicle_positions` dict; update `ingest()` + `snapshot()` |
| `backend/gtfs/static.py` | Parse `_route_stops` at startup; add `get_route_stops()` |
| `backend/api/routes.py` | Add `GET /api/routes/{route_id}/stops` |
| `backend/main.py` | Wire `parse_vehicle_positions()` into poll loop; update `ingest()` call |
| `backend/tests/test_feed.py` | Tests for `parse_vehicle_positions()` |
| `backend/tests/test_static.py` | Tests for `get_route_stops()` (add to existing file) |
| `backend/tests/test_api.py` | Test for `/api/routes/{route_id}/stops` |
| `frontend/src/hooks/useLiveData.ts` | Add `VehiclePositionEntry` type + parse `vehiclePositions` from WS |
| `frontend/src/components/TrackDiagram.tsx` | New — schematic track + direction toggle |
| `frontend/src/views/NetworkPulse.tsx` | Render `<TrackDiagram>` inside expanded accordion |

---

## Task 1: `VehiclePosition` model + `parse_vehicle_positions()`

**Files:**
- Modify: `backend/gtfs/models.py`
- Modify: `backend/gtfs/feed.py`
- Modify: `backend/tests/test_feed.py`

**Context:** `backend/gtfs/models.py` currently has `ArrivalRecord`, `ServiceAlert`, and `LineHealth`. `backend/gtfs/feed.py` has `parse_feed()` (TripUpdate) and `parse_alerts()` (Alert). The GTFS-RT `VehiclePosition` entity has the same structure as TripUpdate but uses `entity.vehicle` instead of `entity.trip_update`. The `current_status` field is an enum — use `.Name()` to get the string (`'STOPPED_AT'`, `'IN_TRANSIT_TO'`, `'INCOMING_AT'`).

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_feed.py`:

```python
from backend.gtfs.feed import parse_vehicle_positions
from backend.gtfs.models import VehiclePosition


@pytest.fixture
def sample_vehicle_feed_bytes() -> bytes:
    """Minimal GTFS-RT FeedMessage with one VehiclePosition."""
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = '2.0'
    feed.header.timestamp = int(datetime(2026, 4, 10, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    entity = feed.entity.add()
    entity.id = 'vehicle-1'
    entity.vehicle.trip.route_id = '6'
    entity.vehicle.trip.trip_id = 'trip-v1'
    entity.vehicle.stop_id = '631N'
    entity.vehicle.current_status = gtfs_realtime_pb2.VehiclePosition.STOPPED_AT
    entity.vehicle.timestamp = int(datetime(2026, 4, 10, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    return feed.SerializeToString()


def test_parse_vehicle_positions_returns_vehicle_position(sample_vehicle_feed_bytes):
    positions = parse_vehicle_positions(sample_vehicle_feed_bytes)
    assert len(positions) == 1
    p = positions[0]
    assert isinstance(p, VehiclePosition)
    assert p.route_id == '6'
    assert p.trip_id == 'trip-v1'
    assert p.stop_id == '631N'
    assert p.current_status == 'STOPPED_AT'


def test_parse_vehicle_positions_empty_bytes():
    assert parse_vehicle_positions(b'') == []


def test_parse_vehicle_positions_skips_entities_without_stop_id():
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = '2.0'
    feed.header.timestamp = 0
    entity = feed.entity.add()
    entity.id = 'vehicle-2'
    entity.vehicle.trip.route_id = '6'
    entity.vehicle.trip.trip_id = 'trip-v2'
    # no stop_id set
    entity.vehicle.current_status = gtfs_realtime_pb2.VehiclePosition.IN_TRANSIT_TO
    data = feed.SerializeToString()
    assert parse_vehicle_positions(data) == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m pytest backend/tests/test_feed.py::test_parse_vehicle_positions_returns_vehicle_position -v
```

Expected: FAIL — `VehiclePosition` not importable, `parse_vehicle_positions` not defined.

- [ ] **Step 3: Add `VehiclePosition` to `backend/gtfs/models.py`**

Add after the `ServiceAlert` dataclass (after line 38):

```python
@dataclass
class VehiclePosition:
    trip_id: str
    route_id: str
    stop_id: str
    current_status: str   # 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT'
    timestamp: datetime
```

- [ ] **Step 4: Add `parse_vehicle_positions()` to `backend/gtfs/feed.py`**

Update the import from `backend.gtfs.models` (top of feed.py) to include `VehiclePosition`:

```python
from backend.gtfs.models import ArrivalRecord, ServiceAlert, VehiclePosition
```

Add after `parse_alerts_json()` and before `fetch_feed()`:

```python
def parse_vehicle_positions(data: bytes) -> list[VehiclePosition]:
    """Parse GTFS-RT VehiclePosition entities. Returns empty list on failure."""
    if not data:
        return []
    try:
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(data)
    except Exception as e:
        logger.warning('Failed to parse GTFS-RT vehicle positions: %s', e)
        return []

    positions: list[VehiclePosition] = []
    for entity in feed.entity:
        if not entity.HasField('vehicle'):
            continue
        v = entity.vehicle
        stop_id = v.stop_id
        route_id = v.trip.route_id
        if not stop_id or not route_id:
            continue
        status = gtfs_realtime_pb2.VehiclePosition.VehicleStopStatus.Name(v.current_status)
        ts = datetime.fromtimestamp(v.timestamp, tz=timezone.utc) if v.timestamp else datetime.now(timezone.utc)
        positions.append(VehiclePosition(
            trip_id=v.trip.trip_id,
            route_id=route_id,
            stop_id=stop_id,
            current_status=status,
            timestamp=ts,
        ))
    return positions
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python3 -m pytest backend/tests/test_feed.py -v
```

Expected: all PASS (including the 7 existing tests).

- [ ] **Step 6: Commit**

```bash
git add backend/gtfs/models.py backend/gtfs/feed.py backend/tests/test_feed.py
git commit -m "feat: add VehiclePosition model + parse_vehicle_positions"
```

---

## Task 2: Update `LiveState` to store vehicle positions + include in snapshot

**Files:**
- Modify: `backend/gtfs/state.py`
- Modify: `backend/tests/test_state.py`

**Context:** `LiveState.ingest()` currently takes `(records, alerts)`. Add a third param `vehicle_positions: list[VehiclePosition]`. Store as `_vehicle_positions: dict[str, VehiclePosition]` keyed by `trip_id` (last write wins for any trip). Include in `snapshot()` as `'vehicle_positions': [...]`. The `main.py` call to `ingest()` will be updated in Task 5.

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_state.py` (the file uses `LiveState()` directly — no fixture needed):

```python
from backend.gtfs.models import VehiclePosition


def test_ingest_stores_vehicle_positions():
    state = LiveState()
    vp = VehiclePosition(
        trip_id='trip-v1', route_id='6', stop_id='631N',
        current_status='STOPPED_AT',
        timestamp=datetime(2026, 4, 10, 12, 0, tzinfo=timezone.utc),
    )
    state.ingest([], [], [vp])
    snap = state.snapshot()
    assert len(snap['vehicle_positions']) == 1
    assert snap['vehicle_positions'][0]['route_id'] == '6'
    assert snap['vehicle_positions'][0]['stop_id'] == '631N'
    assert snap['vehicle_positions'][0]['status'] == 'STOPPED_AT'


def test_ingest_vehicle_positions_keyed_by_trip_id():
    state = LiveState()
    vp1 = VehiclePosition('trip-1', '6', '631N', 'STOPPED_AT', datetime.now(timezone.utc))
    vp2 = VehiclePosition('trip-1', '6', '632N', 'IN_TRANSIT_TO', datetime.now(timezone.utc))
    state.ingest([], [], [vp1, vp2])
    snap = state.snapshot()
    # trip-1 appears only once — last write wins
    positions = snap['vehicle_positions']
    assert len(positions) == 1
    assert positions[0]['stop_id'] == '632N'


def test_ingest_vehicle_positions_defaults_to_empty():
    state = LiveState()
    state.ingest([], [])  # no third arg — backward-compatible
    snap = state.snapshot()
    assert snap['vehicle_positions'] == []
```

- [ ] **Step 3: Run test to verify it fails**

```bash
python3 -m pytest backend/tests/test_state.py::test_ingest_stores_vehicle_positions -v
```

Expected: FAIL — `ingest()` doesn't accept third arg yet.

- [ ] **Step 4: Update `backend/gtfs/state.py`**

Add `VehiclePosition` to the import at the top:

```python
from backend.gtfs.models import ArrivalRecord, LineHealth, LineStatus, ServiceAlert, VehiclePosition
```

Add `_vehicle_positions` dict to `__init__`:

```python
# trip_id → VehiclePosition (last position per trip)
self._vehicle_positions: dict[str, VehiclePosition] = {}
```

Update `ingest()` signature and body — add the third parameter and reset/populate `_vehicle_positions`:

```python
def ingest(
    self,
    records: list[ArrivalRecord],
    alerts: list[ServiceAlert],
    vehicle_positions: list[VehiclePosition] | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    with self._lock:
        # ... existing records/alerts logic unchanged ...

        # Reset and store vehicle positions (last write per trip_id wins)
        self._vehicle_positions.clear()
        for vp in (vehicle_positions or []):
            self._vehicle_positions[vp.trip_id] = vp
```

The `vehicle_positions` parameter is `| None = None` so existing calls without the third arg (tests, main.py before Task 5) continue to work.

Update `snapshot()` — add `'vehicle_positions'` to the returned dict (inside the `with self._lock:` block, after the line_health list):

```python
'vehicle_positions': [
    {
        'trip_id': vp.trip_id,
        'route_id': vp.route_id,
        'stop_id': vp.stop_id,
        'status': vp.current_status,
    }
    for vp in self._vehicle_positions.values()
],
```

- [ ] **Step 5: Run tests**

```bash
python3 -m pytest backend/tests/test_state.py -v
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/gtfs/state.py backend/tests/test_state.py
git commit -m "feat: add vehicle_positions to LiveState ingest + snapshot"
```

---

## Task 3: `get_route_stops()` in `static.py`

**Files:**
- Modify: `backend/gtfs/static.py`
- Modify: `backend/tests/test_static.py`

**Context:** At startup, `load()` calls `_parse_stops()` and `_parse_stop_times()`. Add a third parse call `_parse_route_stops()` that reads `trips.txt` + `stop_times.txt` and builds `_route_stops: dict[tuple[str, int], list[dict]]` mapping `(route_id, direction_id)` → ordered `[{stop_id, name}]`. For each `(route_id, direction_id)`, pick the trip with the **longest** stop sequence as the canonical one. `trips.txt` columns include `route_id`, `trip_id`, `direction_id`. `stop_times.txt` has `trip_id`, `stop_id`, `stop_sequence`.

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_static.py`:

```python
def test_get_route_stops_returns_ordered_list():
    """get_route_stops returns stops in stop_sequence order."""
    mock_route_stops = {
        ('6', 1): [
            {'stop_id': '640', 'name': 'Pelham Bay Park'},
            {'stop_id': '639', 'name': 'Buhre Av'},
            {'stop_id': '631', 'name': 'Grand Central-42 St'},
        ]
    }
    with patch('backend.gtfs.static._route_stops', mock_route_stops):
        from backend.gtfs.static import get_route_stops
        stops = get_route_stops('6', 1)
        assert len(stops) == 3
        assert stops[0]['stop_id'] == '640'
        assert stops[2]['stop_id'] == '631'


def test_get_route_stops_returns_empty_for_unknown_route():
    with patch('backend.gtfs.static._route_stops', {}):
        from backend.gtfs.static import get_route_stops
        assert get_route_stops('Z99', 0) == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m pytest backend/tests/test_static.py::test_get_route_stops_returns_ordered_list -v
```

Expected: FAIL — `_route_stops` not defined, `get_route_stops` not defined.

- [ ] **Step 3: Add `_route_stops` dict and `_parse_route_stops()` to `backend/gtfs/static.py`**

Add module-level dict (after `_travel_times`):

```python
# (route_id, direction_id) -> ordered [{stop_id, name}] from canonical trip
_route_stops: dict[tuple[str, int], list[dict]] = {}
```

Add parse function:

```python
def _parse_route_stops(zf: zipfile.ZipFile) -> None:
    """Build canonical stop sequence per (route_id, direction_id).
    Uses the trip with the longest stop count as the canonical trip."""
    global _route_stops

    # Read trips.txt: trip_id -> (route_id, direction_id)
    trip_meta: dict[str, tuple[str, int]] = {}
    with zf.open('trips.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            route_id = row.get('route_id', '').strip()
            trip_id = row.get('trip_id', '').strip()
            direction_id = int(row.get('direction_id', '0') or '0')
            if route_id and trip_id:
                trip_meta[trip_id] = (route_id, direction_id)

    # Read stop_times.txt: group by trip_id, ordered by stop_sequence
    trip_stop_seqs: dict[str, list[tuple[int, str]]] = {}
    with zf.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            trip_id = row.get('trip_id', '').strip()
            stop_id = row.get('stop_id', '').strip()
            seq = int(row.get('stop_sequence', '0') or '0')
            if trip_id and stop_id:
                if trip_id not in trip_stop_seqs:
                    trip_stop_seqs[trip_id] = []
                trip_stop_seqs[trip_id].append((seq, stop_id))

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
```

Add `get_route_stops()` function:

```python
def get_route_stops(route_id: str, direction_id: int) -> list[dict]:
    """Return canonical ordered stop list for a route+direction.
    Each entry: {stop_id: str, name: str}. Empty list if not found."""
    return _route_stops.get((route_id, direction_id), [])
```

Update `load()` to call `_parse_route_stops` (add inside the `with zipfile.ZipFile(...) as zf:` block, after `_parse_stop_times`):

```python
_parse_route_stops(zf)
```

Update the log line:

```python
logger.info('Static GTFS loaded: %d stops, %d travel pairs, %d route-direction sequences',
            len(_stops), len(_travel_times), len(_route_stops))
```

- [ ] **Step 4: Run tests**

```bash
python3 -m pytest backend/tests/test_static.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/gtfs/static.py backend/tests/test_static.py
git commit -m "feat: parse route stop sequences at startup + get_route_stops()"
```

---

## Task 4: Add `/api/routes/{route_id}/stops` endpoint

**Files:**
- Modify: `backend/api/routes.py`
- Modify: `backend/tests/test_api.py`

**Context:** Add `get_route_stops` to the static import and add one new route. The endpoint is called by the frontend when a line accordion is first expanded.

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_api.py`:

```python
def test_route_stops_endpoint_returns_stop_list():
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    mock_route_stops = {
        ('6', 1): [
            {'stop_id': '640', 'name': 'Pelham Bay Park'},
            {'stop_id': '631', 'name': 'Grand Central-42 St'},
        ]
    }
    with patch('backend.gtfs.static._route_stops', mock_route_stops):
        from backend.main import app
        client = TestClient(app)
        resp = client.get('/api/routes/6/stops?direction=1')
        assert resp.status_code == 200
        data = resp.json()
        assert data['route_id'] == '6'
        assert data['direction'] == 1
        assert len(data['stops']) == 2
        assert data['stops'][0]['stop_id'] == '640'


def test_route_stops_endpoint_404_for_unknown_route():
    from fastapi.testclient import TestClient
    with patch('backend.gtfs.static._route_stops', {}):
        from backend.main import app
        client = TestClient(app)
        resp = client.get('/api/routes/Z99/stops?direction=0')
        assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m pytest backend/tests/test_api.py::test_route_stops_endpoint_returns_stop_list -v
```

Expected: FAIL — 404 (endpoint not defined).

- [ ] **Step 3: Update `backend/api/routes.py`**

Update the static import line:

```python
from backend.gtfs.static import get_route_stops, get_travel_sec, nearest_stops, search_stops
```

Add after the `/api/stops/nearest` route:

```python
@router.get('/api/routes/{route_id}/stops')
async def get_route_stops_endpoint(route_id: str, direction: int = 1):
    stops = get_route_stops(route_id, direction)
    if not stops:
        raise HTTPException(404, f'No stop sequence for route {route_id} direction {direction}')
    return {'route_id': route_id, 'direction': direction, 'stops': stops}
```

- [ ] **Step 4: Run tests**

```bash
python3 -m pytest backend/tests/test_api.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routes.py backend/tests/test_api.py
git commit -m "feat: add GET /api/routes/{route_id}/stops endpoint"
```

---

## Task 5: Wire `parse_vehicle_positions()` into poll loop

**Files:**
- Modify: `backend/main.py`

**Context:** `main.py` imports from `backend.gtfs.feed`. The poll loop calls `parse_feed(data)` and `parse_alerts(data)` for each URL. Add `parse_vehicle_positions(data)`. Also update the `_live_state.ingest()` call to pass the third argument.

- [ ] **Step 1: Update imports in `backend/main.py`**

Change the feed import line (currently):
```python
from backend.gtfs.feed import (
    MTA_ALERTS_JSON_URL,
    MTA_FEED_URLS,
    fetch_feed,
    parse_alerts,
    parse_alerts_json,
    parse_feed,
)
```

To:
```python
from backend.gtfs.feed import (
    MTA_ALERTS_JSON_URL,
    MTA_FEED_URLS,
    fetch_feed,
    parse_alerts,
    parse_alerts_json,
    parse_feed,
    parse_vehicle_positions,
)
```

- [ ] **Step 2: Update poll loop body**

Replace the existing loop body in `poll_loop()`:

```python
all_records = []
all_alerts = []
all_vehicle_positions = []
for feed_id, url in MTA_FEED_URLS.items():
    data = await fetch_feed(url, client)
    all_records.extend(parse_feed(data))
    all_alerts.extend(parse_alerts(data))
    all_vehicle_positions.extend(parse_vehicle_positions(data))

# Customer-facing alerts (JSON format — separate from GTFS-RT protobuf)
alerts_json_data = await fetch_feed(MTA_ALERTS_JSON_URL, client)
all_alerts.extend(parse_alerts_json(alerts_json_data))

_live_state.ingest(all_records, all_alerts, all_vehicle_positions)
```

- [ ] **Step 3: Run full test suite**

```bash
python3 -m pytest backend/tests/ -q
```

Expected: all tests pass.

- [ ] **Step 4: Verify frontend build still passes**

```bash
npm --prefix frontend run build 2>&1 | tail -6
```

Expected: `✓ built in`.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat: wire parse_vehicle_positions into poll loop"
```

---

## Task 6: Add `vehiclePositions` to `useLiveData`

**Files:**
- Modify: `frontend/src/hooks/useLiveData.ts`

**Context:** `useLiveData.ts` currently parses `arrivals` and `line_health` from the WebSocket snapshot. Add `vehicle_positions` parsing. The WebSocket message now includes `vehicle_positions: [{trip_id, route_id, stop_id, status}]`. Add `VehiclePositionEntry` interface and `vehiclePositions` to `LiveData`. Default to `[]`.

Full updated `frontend/src/hooks/useLiveData.ts`:

```typescript
import { useState, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'

export interface ArrivalEntry {
  route_id: string
  arrival_time: string
  delay_sec: number
  direction: string
}

export interface LineHealthEntry {
  route_id: string
  status: 'NOMINAL' | 'DELAYED' | 'DISRUPTED'
  avg_delay_sec: number
  headway_variance: number
  alerts: string[]
}

export interface VehiclePositionEntry {
  trip_id: string
  route_id: string
  stop_id: string
  status: 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT'
}

export interface LiveData {
  arrivals: Record<string, ArrivalEntry[]>
  lineHealth: LineHealthEntry[]
  vehiclePositions: VehiclePositionEntry[]
  connected: boolean
  lastUpdate: Date | null
}

const INITIAL: LiveData = {
  arrivals: {},
  lineHealth: [],
  vehiclePositions: [],
  connected: false,
  lastUpdate: null,
}

export function useLiveData(): LiveData {
  const [data, setData] = useState<LiveData>(INITIAL)

  const onMessage = useCallback((msg: unknown) => {
    const m = msg as {
      type: string
      arrivals?: Record<string, ArrivalEntry[]>
      line_health?: LineHealthEntry[]
      vehicle_positions?: VehiclePositionEntry[]
    }
    if (m.type === 'snapshot') {
      setData({
        arrivals: m.arrivals ?? {},
        lineHealth: m.line_health ?? [],
        vehiclePositions: m.vehicle_positions ?? [],
        connected: true,
        lastUpdate: new Date(),
      })
    }
  }, [])

  useWebSocket(onMessage)
  return data
}
```

- [ ] **Step 1: Replace `frontend/src/hooks/useLiveData.ts` with the above**

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm --prefix frontend run build 2>&1 | tail -8
```

Expected: `✓ built in` — zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useLiveData.ts
git commit -m "feat: add vehiclePositions to LiveData + useLiveData"
```

---

## Task 7: `TrackDiagram` component

**Files:**
- Create: `frontend/src/components/TrackDiagram.tsx`

**Context:** Renders a horizontal stop-sequence diagram for one route + direction. Fetches stop list from `/api/routes/{routeId}/stops?direction=` on first expand; caches by `${routeId}-${direction}` key. Renders a dot for each stop; dots glow based on vehicle position status. Uses `pulse-glow` keyframe already defined in `frontend/src/index.css`. Stop labels abbreviated if many stops.

- [ ] **Step 1: Create `frontend/src/components/TrackDiagram.tsx`**

```typescript
import { useState, useEffect, useRef } from 'react'
import type { VehiclePositionEntry, LineHealthEntry } from '../hooks/useLiveData'

interface Stop {
  stop_id: string
  name: string
}

interface Props {
  routeId: string
  vehiclePositions: VehiclePositionEntry[]
  lineHealth: LineHealthEntry[]
}

export function TrackDiagram({ routeId, vehiclePositions, lineHealth }: Props) {
  const [direction, setDirection] = useState<0 | 1>(1)
  const [stops, setStops] = useState<Stop[]>([])
  const [error, setError] = useState('')
  const cacheRef = useRef<Record<string, Stop[]>>({})

  useEffect(() => {
    const key = `${routeId}-${direction}`
    if (cacheRef.current[key]) {
      setStops(cacheRef.current[key])
      return
    }
    setError('')
    fetch(`/api/routes/${routeId}/stops?direction=${direction}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const s: Stop[] = data.stops ?? []
        cacheRef.current[key] = s
        setStops(s)
      })
      .catch(() => setError('NO ROUTE DATA'))
  }, [routeId, direction])

  // Trains at each stop for this route
  const routePositions = vehiclePositions.filter(vp => vp.route_id === routeId)

  // Map stop_id → list of statuses (multiple trains can be at same stop)
  const trainsByStop: Record<string, string[]> = {}
  for (const vp of routePositions) {
    const base = vp.stop_id.replace(/[NS]$/, '')  // strip N/S suffix for matching
    if (!trainsByStop[base]) trainsByStop[base] = []
    trainsByStop[base].push(vp.status)
  }

  // Is route delayed per lineHealth?
  const health = lineHealth.find(h => h.route_id === routeId)
  const isDelayed = (health?.avg_delay_sec ?? 0) > 60

  // Show every Nth label to avoid crowding
  function showLabel(i: number, total: number): boolean {
    if (total <= 8) return true
    if (total <= 14) return i % 2 === 0
    return i % 3 === 0
  }

  function dotStyle(stopId: string): React.CSSProperties {
    const base = stopId.replace(/[NS]$/, '')
    const statuses = trainsByStop[base] ?? []
    const hasTrain = statuses.length > 0
    const isStopped = statuses.some(s => s === 'STOPPED_AT')
    const isApproaching = statuses.some(s => s === 'IN_TRANSIT_TO' || s === 'INCOMING_AT')

    if (hasTrain && isDelayed) {
      return {
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: 'var(--amber)', border: '1px solid var(--amber)',
        boxShadow: '0 0 6px #f59e0b88', zIndex: 2, position: 'relative',
      }
    }
    if (isStopped) {
      return {
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: 'var(--green)', border: '1px solid var(--green)',
        boxShadow: '0 0 6px #22c55e88', zIndex: 2, position: 'relative',
      }
    }
    if (isApproaching) {
      return {
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: 'var(--green)', border: '1px solid var(--green)',
        boxShadow: '0 0 6px #22c55e88', zIndex: 2, position: 'relative',
        animation: 'pulse-glow 1.2s ease-out infinite',
      }
    }
    return {
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: '#1e3a1e', border: '1px solid #2a5a2a', zIndex: 2, position: 'relative',
    }
  }

  if (error) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.08em' }}>
        {error}
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 10 }}>
      {/* Direction toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([1, 0] as const).map(d => (
          <button key={d} onClick={() => setDirection(d)} style={{
            all: 'unset', cursor: 'pointer',
            fontSize: 8, letterSpacing: '0.1em', padding: '3px 8px',
            borderRadius: 2,
            background: direction === d ? 'var(--green-dim)' : 'transparent',
            border: `1px solid ${direction === d ? 'var(--green-border)' : 'var(--border)'}`,
            color: direction === d ? 'var(--green)' : 'var(--text-faint)',
          }}>
            {d === 1 ? 'UPTOWN' : 'DOWNTOWN'}
          </button>
        ))}
      </div>

      {/* Track row */}
      {stops.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>NO POSITION DATA</div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 'max-content', padding: '16px 4px 28px' }}>
            {stops.map((stop, i) => {
              const base = stop.stop_id.replace(/[NS]$/, '')
              const count = trainsByStop[base]?.length ?? 0
              const label = showLabel(i, stops.length)

              return (
                <div key={stop.stop_id} style={{ display: 'flex', alignItems: 'center' }}>
                  {/* Stop dot + label */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                    {/* Train count badge */}
                    {count > 1 && (
                      <div style={{
                        position: 'absolute', top: -14,
                        fontSize: 8, color: 'var(--green)', fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                        ▲{count}
                      </div>
                    )}
                    {count === 1 && (
                      <div style={{
                        position: 'absolute', top: -14,
                        fontSize: 8, color: 'var(--green)', fontWeight: 700,
                      }}>
                        ▲
                      </div>
                    )}

                    {/* Dot */}
                    <div title={stop.name} style={dotStyle(stop.stop_id)} />

                    {/* Label */}
                    {label && (
                      <div style={{
                        position: 'absolute', top: 14,
                        fontSize: 7, color: 'var(--text-faint)', whiteSpace: 'nowrap',
                        transform: 'translateX(-50%)', left: '50%',
                        maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {stop.name.split('–')[0].split('-')[0].trim()}
                      </div>
                    )}
                  </div>

                  {/* Connector segment (not after last stop) */}
                  {i < stops.length - 1 && (
                    <div style={{ width: 28, height: 2, background: '#1e3a1e', flexShrink: 0 }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm --prefix frontend run build 2>&1 | tail -8
```

Expected: `✓ built in` — zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TrackDiagram.tsx
git commit -m "feat: add TrackDiagram schematic track component"
```

---

## Task 8: Wire `TrackDiagram` into `NetworkPulse` accordion

**Files:**
- Modify: `frontend/src/views/NetworkPulse.tsx`

**Context:** `NetworkPulse` currently renders the line accordion in the right column. When `isExpanded`, it shows alert text + avg delay stats. Add `<TrackDiagram>` below that content. Import `TrackDiagram` and `VehiclePositionEntry`. Pass `liveData.vehiclePositions` and `liveData.lineHealth` through. The `primaryRouteId` for each group is `routes[0]`.

Changes needed:
1. Add `TrackDiagram` import
2. Add `VehiclePositionEntry` to the `useLiveData` import
3. Inside the expanded accordion `div`, add `<TrackDiagram>` below the existing content

- [ ] **Step 1: Update imports at top of `frontend/src/views/NetworkPulse.tsx`**

Change:
```typescript
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
```

To:
```typescript
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { TrackDiagram } from '../components/TrackDiagram'
```

- [ ] **Step 2: Add `<TrackDiagram>` inside the expanded accordion panel**

Find the `isExpanded && h &&` block (currently lines 142–157). Replace the entire expanded panel `div` with:

```tsx
{isExpanded && (
  <div style={{
    background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none',
    borderRadius: '0 0 3px 3px', padding: 12,
  }}>
    {h ? (
      <>
        {h.alerts.length === 0
          ? <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No active alerts.</div>
          : h.alerts.map((a, i) => (
              <div key={i} style={{ color: 'var(--amber)', fontSize: 11, marginBottom: 4 }}>⚠ {a}</div>
            ))
        }
        <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 8 }}>
          Avg delay: {Math.round(h.avg_delay_sec)}s · HW variance: {Math.round(h.headway_variance)}s
        </div>
      </>
    ) : (
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No data.</div>
    )}
    <TrackDiagram
      routeId={routes[0]}
      vehiclePositions={liveData.vehiclePositions}
      lineHealth={liveData.lineHealth}
    />
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm --prefix frontend run build 2>&1 | tail -8
```

Expected: `✓ built in` — zero errors.

- [ ] **Step 4: Run full backend test suite**

```bash
python3 -m pytest backend/tests/ -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/NetworkPulse.tsx
git commit -m "feat: add TrackDiagram to NetworkPulse line accordion"
```
