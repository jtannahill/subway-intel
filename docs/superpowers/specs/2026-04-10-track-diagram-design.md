# Real-Time Track Diagram — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

## Overview

Add real-time train position display to the Network Pulse view as an expandable schematic track diagram per line. When a user expands a line group in the Network Pulse accordion, a horizontal stop-sequence diagram appears below the line header showing live train positions sourced from MTA GTFS-RT `VehiclePosition` entities — already present in the feeds we poll every 30 seconds, currently discarded.

---

## Architecture

### Data flow

```
GTFS-RT feeds (every 30s)
  → parse_vehicle_positions()         # new, in feed.py
  → LiveState._vehicle_positions      # new dict, keyed by trip_id
  → snapshot()                        # adds vehiclePositions[] to WS payload
  → WebSocket broadcast
  → useLiveData (frontend)            # vehiclePositions added to LiveData type
  → TrackDiagram component            # renders dots on stop sequence

Static GTFS (startup, one-time)
  → get_route_stops(route_id, dir)    # new, in static.py — reads trips.txt + stop_times.txt
  → GET /api/routes/{route_id}/stops  # new endpoint, called on first accordion expand
  → TrackDiagram (cached in state)    # cached after first fetch, not re-fetched
```

---

## Backend Changes

### `backend/gtfs/models.py`

New dataclass:

```python
@dataclass
class VehiclePosition:
    trip_id: str
    route_id: str
    stop_id: str          # current or next stop
    current_status: str   # 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT'
    timestamp: datetime
```

### `backend/gtfs/feed.py`

New function:

```python
def parse_vehicle_positions(data: bytes) -> list[VehiclePosition]:
    """Parse GTFS-RT VehiclePosition entities from a feed.
    Returns empty list on parse failure or if feed has no vehicle positions."""
```

- Iterates `feed.entity`, checks `entity.HasField('vehicle')`
- Extracts `vehicle.trip.trip_id`, `vehicle.trip.route_id`, `vehicle.stop_id`,
  `vehicle.current_status` (name string via `.Name()`), `vehicle.timestamp`
- Skips entities with no `stop_id` or no `route_id`

### `backend/gtfs/state.py`

Add to `LiveState`:

```python
_vehicle_positions: dict[str, VehiclePosition]  # keyed by trip_id
```

Update `ingest(records, alerts, vehicle_positions)` — third param added:

```python
def ingest(
    self,
    records: list[ArrivalRecord],
    alerts: list[ServiceAlert],
    vehicle_positions: list[VehiclePosition],
) -> None:
```

Resets `_vehicle_positions` and re-ingests on each call (same pattern as alerts).

Update `snapshot()` — add to returned dict:

```python
'vehiclePositions': [
    {
        'trip_id': vp.trip_id,
        'route_id': vp.route_id,
        'stop_id': vp.stop_id,
        'status': vp.current_status,
    }
    for vp in self._vehicle_positions.values()
]
```

### `backend/gtfs/static.py`

At startup, parse two new structures from `trips.txt` + `stop_times.txt`:

```python
# route_id + direction_id -> ordered list of {stop_id, name}
_route_stops: dict[tuple[str, int], list[dict]] = {}
```

New function:

```python
def get_route_stops(route_id: str, direction_id: int) -> list[dict]:
    """Return canonical ordered stop list for a route+direction.
    Each entry: { stop_id: str, name: str }
    Returns empty list if route/direction not found."""
```

Implementation: for each `(route_id, direction_id)` pair, collect all trips, take the trip with the longest stop sequence as the canonical sequence. Store once at startup.

### `backend/api/routes.py`

New endpoint:

```python
@router.get('/api/routes/{route_id}/stops')
async def get_route_stops_api(route_id: str, direction: int = 1):
    stops = get_route_stops(route_id, direction)
    if not stops:
        raise HTTPException(404, f'No stop sequence for route {route_id} direction {direction}')
    return {'route_id': route_id, 'direction': direction, 'stops': stops}
```

### `backend/main.py`

In `poll_loop()`, alongside existing parsers:

```python
all_vehicle_positions = []
for feed_id, url in MTA_FEED_URLS.items():
    data = await fetch_feed(url, client)
    all_records.extend(parse_feed(data))
    all_alerts.extend(parse_alerts(data))
    all_vehicle_positions.extend(parse_vehicle_positions(data))

_live_state.ingest(all_records, all_alerts, all_vehicle_positions)
```

---

## Frontend Changes

### `frontend/src/hooks/useLiveData.ts`

Add to `LiveData` type:

```ts
export interface VehiclePositionEntry {
  trip_id: string
  route_id: string
  stop_id: string
  status: 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT'
}

// in LiveData:
vehiclePositions: VehiclePositionEntry[]
```

Parse from WebSocket message alongside existing fields. Default to `[]`.

### `frontend/src/components/TrackDiagram.tsx` (new)

```ts
interface Props {
  routeId: string
  vehiclePositions: VehiclePositionEntry[]
  lineHealth: LineHealthEntry[]   // for delay cross-reference
}
```

**Internal state:**
- `direction: 0 | 1` — defaults to `1` (uptown/inbound)
- `stops: { stop_id: string; name: string }[]` — fetched from `/api/routes/{routeId}/stops?direction=`
- `stopCache: Record<string, { stop_id: string; name: string }[]>` — cached by `"${routeId}-${direction}"` key so switching direction doesn't re-fetch

**Stop fetch:** `useEffect` on `[routeId, direction]` — checks cache first, fetches if miss.

**Rendering the track:**

```
[UPTOWN] [DOWNTOWN]              ← direction toggle, left-aligned

●────●────●────●────●────●      ← track row
14St  23St  28St  33St  GCT     ← labels (every 3rd if >10 stops)
```

Stop dot variants (CSS classes):
- `.stop-dot` — default: small circle, dark green fill, dim border
- `.stop-dot.train-here` — `STOPPED_AT`: bright green fill + `box-shadow: 0 0 6px #22c55e88`
- `.stop-dot.train-approaching` — `IN_TRANSIT_TO` / `INCOMING_AT`: same green but `animation: pulse-glow 1.2s ease-out infinite` (reuses existing keyframe)
- `.stop-dot.train-delayed` — amber: `box-shadow: 0 0 6px #f59e0b88`; applied when train is at stop AND route avg_delay_sec > 60 in `lineHealth`

Train count badge: if `>1` vehicle at the same `stop_id`, render `▲N` above the dot in green text (font-size: 8px).

**Stop labels:** `title={stop.name}` on every dot (full name on hover). Visible text: abbreviated — show label on every dot if ≤8 stops, every 2nd if 9–14, every 3rd if ≥15.

**Scroll:** track row wrapped in `overflow-x: auto` container.

**Empty state:** if `stops.length === 0` after fetch: `NO ROUTE DATA`. If stops loaded but no vehicle positions match this route: `NO POSITION DATA` in `var(--text-faint)`.

### `frontend/src/views/NetworkPulse.tsx`

The existing accordion renders line groups; when `expanded` is true for a route group, add below the existing header row:

```tsx
{expanded && (
  <TrackDiagram
    routeId={primaryRouteId}
    vehiclePositions={vehiclePositions}
    lineHealth={liveData.lineHealth}
  />
)}
```

`primaryRouteId`: the first route_id in the group (e.g. for "A/C/E" group, use `'A'`). The stop sequence will be the same for all routes in a group since they share trunk stops.

`vehiclePositions`: filter from `liveData.vehiclePositions` where `route_id` is in the group's route list — pass the full list and let `TrackDiagram` filter by routeId.

---

## Files Changed

| File | Action |
|------|--------|
| `backend/gtfs/models.py` | Add `VehiclePosition` dataclass |
| `backend/gtfs/feed.py` | Add `parse_vehicle_positions()` |
| `backend/gtfs/state.py` | Add `_vehicle_positions`; update `ingest()` + `snapshot()` |
| `backend/gtfs/static.py` | Parse `_route_stops` at startup; add `get_route_stops()` |
| `backend/api/routes.py` | Add `GET /api/routes/{route_id}/stops` |
| `backend/main.py` | Wire `parse_vehicle_positions()` into poll loop; update `ingest()` call |
| `backend/tests/test_feed.py` | Tests for `parse_vehicle_positions()` |
| `backend/tests/test_static.py` | New file — tests for `get_route_stops()` |
| `backend/tests/test_api.py` | Test for `/api/routes/{route_id}/stops` |
| `frontend/src/hooks/useLiveData.ts` | Add `VehiclePositionEntry` type + `vehiclePositions` to `LiveData` |
| `frontend/src/components/TrackDiagram.tsx` | New — schematic track diagram |
| `frontend/src/views/NetworkPulse.tsx` | Render `TrackDiagram` inside expanded accordion |

## Non-Goals

- Animated train movement between stops (positions are discrete — stop-level only, no interpolation)
- All directions simultaneously (one direction at a time, toggled)
- LIRR or Metro-North vehicle positions (subway only)
- Train identification (trip_id not displayed)
- Multi-route vehicle display within a group: for A/C/E, `TrackDiagram` is given `routeId='A'` and only shows A trains. C and E vehicles are filtered out. Full group display is a future enhancement.
