# Live Station Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare substring-match search inputs in MyStations and SmartCommute with a shared live-autocomplete component that merges subway station results with Mapbox-geocoded NYC address results.

**Architecture:** A new `useStationSearch` hook debounces the query and fires both `/api/stops/search` and the Mapbox Geocoding REST API in parallel; results merge into a `StationSearchInput` dropdown component that is dropped into MyStations and SmartCommute. When an address is selected, a new `/api/stops/nearest` endpoint resolves it to the closest stop_id before calling `onSelect`. Backend also deduplicates station results by name so each station appears once.

**Tech Stack:** React 19 + TypeScript, Mapbox Geocoding REST API (plain fetch, no SDK), FastAPI, existing MTA GTFS static data already loaded at startup.

---

## File Map

| File | Change |
|------|--------|
| `backend/gtfs/static.py` | Fix `search_stops()` dedup + add lat/lon; new `nearest_stops()` |
| `backend/api/routes.py` | New `GET /api/stops/nearest` endpoint |
| `backend/tests/test_static.py` | New — tests for dedup + nearest_stops |
| `backend/tests/test_api.py` | Add test for `/api/stops/nearest` |
| `frontend/src/hooks/useStationSearch.ts` | New — debounce + parallel search + merge |
| `frontend/src/components/StationSearchInput.tsx` | New — shared autocomplete dropdown |
| `frontend/src/views/MyStations.tsx` | Swap inline search → `<StationSearchInput>` |
| `frontend/src/views/SmartCommute.tsx` | Swap both FROM/TO inputs → `<StationSearchInput>` |
| `frontend/.env.example` | New — documents `VITE_MAPBOX_TOKEN` |

---

## Task 1: Fix `search_stops()` dedup, add lat/lon, add `nearest_stops()`

**Files:**
- Modify: `backend/gtfs/static.py`
- Create: `backend/tests/test_static.py`

**Context:** `backend/gtfs/static.py` has `_stops: dict[str, dict]` keyed by `stop_id`, where each value is `{name, lat, lon}`. Stations like Times Sq-42 St have a parent stop (e.g. `127`) and directional children (`127N`, `127S`) all with the same name — so a query for "times" returns 3 identical-looking results. The fix: group by name and prefer the stop without an `N`/`S` suffix. Also add `import math` at the top (needed by `nearest_stops`).

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_static.py`:

```python
import pytest
from unittest.mock import patch


MOCK_STOPS = {
    '127':  {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229},
    '127N': {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229},
    '127S': {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229},
    '631':  {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848},
    '631N': {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848},
    '631S': {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848},
    '901':  {'name': 'Canal St', 'lat': 40.718092, 'lon': -74.000494},
    '901N': {'name': 'Canal St', 'lat': 40.718092, 'lon': -74.000494},
}


def test_search_stops_deduplicates_by_name():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('42')
        names = [r['name'] for r in results]
        assert names.count('Times Sq-42 St') == 1
        assert names.count('Grand Central-42 St') == 1


def test_search_stops_prefers_parent_stop_id():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('times')
        assert len(results) == 1
        assert results[0]['stop_id'] == '127'  # parent, not 127N or 127S


def test_search_stops_returns_lat_lon():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('canal')
        assert len(results) == 1
        assert results[0]['lat'] == 40.718092
        assert results[0]['lon'] == -74.000494


def test_nearest_stops_returns_closest():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        # Query near Times Sq
        results = nearest_stops(lat=40.756, lon=-73.986, limit=1)
        assert len(results) == 1
        assert results[0]['stop_id'] == '127'
        assert results[0]['distance_mi'] < 0.1


def test_nearest_stops_excludes_directional_stops():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        results = nearest_stops(lat=40.756, lon=-73.986, limit=5)
        stop_ids = [r['stop_id'] for r in results]
        assert '127N' not in stop_ids
        assert '127S' not in stop_ids


def test_nearest_stops_includes_distance_mi():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        results = nearest_stops(lat=40.756, lon=-73.986, limit=1)
        assert 'distance_mi' in results[0]
        assert isinstance(results[0]['distance_mi'], float)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jamest/subway-intel
python3 -m pytest backend/tests/test_static.py -v
```

Expected: FAIL — `nearest_stops` not defined, `search_stops` returns duplicates.

- [ ] **Step 3: Update `backend/gtfs/static.py`**

Add `import math` at the top (after existing imports), then replace `search_stops` and add `nearest_stops`:

```python
import math
```

Replace the existing `search_stops` function (currently lines 99–106) with:

```python
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
            existing_sid, _ = by_name[name]
            # Upgrade to parent stop if current best is directional
            if existing_sid.endswith(('N', 'S')) and not sid.endswith(('N', 'S')):
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
        if info['lat'] != 0 and not sid.endswith(('N', 'S'))
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest backend/tests/test_static.py -v
```

Expected: 6 PASS.

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
python3 -m pytest backend/tests/ -q
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/gtfs/static.py backend/tests/test_static.py
git commit -m "feat: fix search_stops dedup + add lat/lon + nearest_stops"
```

---

## Task 2: Add `/api/stops/nearest` endpoint

**Files:**
- Modify: `backend/api/routes.py`
- Modify: `backend/tests/test_api.py`

**Context:** `backend/api/routes.py` already has a `GET /api/stops/search` endpoint at line 86. The import at the top reads `from backend.gtfs.static import get_travel_sec, search_stops` — add `nearest_stops` to this import. Add `nearest_stops` to the import line and insert the new route after the existing search route.

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_api.py`:

```python
from unittest.mock import patch

MOCK_STOPS_FOR_NEAREST = {
    '127':  {'name': 'Times Sq-42 St',     'lat': 40.755983, 'lon': -73.986229},
    '631':  {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848},
}


def test_nearest_stops_endpoint_returns_closest():
    from fastapi.testclient import TestClient
    with patch('backend.gtfs.static._stops', MOCK_STOPS_FOR_NEAREST):
        from backend.main import app
        client = TestClient(app)
        # Query very close to Times Sq
        resp = client.get('/api/stops/nearest?lat=40.756&lon=-73.986&limit=1')
        assert resp.status_code == 200
        data = resp.json()
        assert len(data['results']) == 1
        assert data['results'][0]['stop_id'] == '127'
        assert data['results'][0]['distance_mi'] < 0.1


def test_nearest_stops_endpoint_default_limit_is_one():
    from fastapi.testclient import TestClient
    with patch('backend.gtfs.static._stops', MOCK_STOPS_FOR_NEAREST):
        from backend.main import app
        client = TestClient(app)
        resp = client.get('/api/stops/nearest?lat=40.755&lon=-73.986')
        assert resp.status_code == 200
        assert len(resp.json()['results']) == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m pytest backend/tests/test_api.py::test_nearest_stops_endpoint_returns_closest -v
```

Expected: FAIL — 404 (endpoint doesn't exist yet).

- [ ] **Step 3: Update `backend/api/routes.py`**

Change the import line (currently line 9):

```python
from backend.gtfs.static import get_travel_sec, nearest_stops, search_stops
```

Add after the existing `/api/stops/search` route (after line 88):

```python
@router.get('/api/stops/nearest')
async def get_nearest_stops(lat: float, lon: float, limit: int = 1):
    return {'results': nearest_stops(lat, lon, limit)}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest backend/tests/test_api.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routes.py backend/tests/test_api.py
git commit -m "feat: add /api/stops/nearest endpoint"
```

---

## Task 3: `useStationSearch` hook

**Files:**
- Create: `frontend/src/hooks/useStationSearch.ts`
- Create: `frontend/.env.example`

**Context:** New React hook. `VITE_MAPBOX_TOKEN` is read from `import.meta.env`. If the token is empty/missing, the Mapbox fetch is skipped and only station results are returned — the hook degrades gracefully. Both fetches use a shared `AbortController` so in-flight requests are cancelled when the query changes.

- [ ] **Step 1: Create `frontend/.env.example`**

```
# Mapbox public token — required for address geocoding in search
# Get one at https://account.mapbox.com/
VITE_MAPBOX_TOKEN=pk.your_token_here
```

- [ ] **Step 2: Create `frontend/src/hooks/useStationSearch.ts`**

```typescript
import { useState, useEffect, useRef } from 'react'

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) ?? ''
const NYC_BBOX = '-74.26,40.48,-73.70,40.92'

export interface StationResult {
  stop_id: string
  name: string
  lat: number
  lon: number
}

export interface AddressResult {
  place_name: string
  lat: number
  lon: number
}

export interface SearchResults {
  stations: StationResult[]
  addresses: AddressResult[]
  loading: boolean
}

export function useStationSearch(query: string): SearchResults {
  const [results, setResults] = useState<SearchResults>({ stations: [], addresses: [], loading: false })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (query.length < 2) {
      setResults({ stations: [], addresses: [], loading: false })
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setResults(prev => ({ ...prev, loading: true }))

      const stationFetch = fetch(
        `/api/stops/search?q=${encodeURIComponent(query)}&limit=6`,
        { signal: controller.signal }
      )

      const mapboxFetch = MAPBOX_TOKEN
        ? fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
            `?country=US&bbox=${NYC_BBOX}&types=address,poi,place&limit=4&access_token=${MAPBOX_TOKEN}`,
            { signal: controller.signal }
          )
        : Promise.resolve(null)

      try {
        const [stationRes, mapboxRes] = await Promise.all([stationFetch, mapboxFetch])
        const stationData = await stationRes.json()
        const stations: StationResult[] = stationData.results ?? []

        let addresses: AddressResult[] = []
        if (mapboxRes?.ok) {
          const mapboxData = await mapboxRes.json()
          addresses = (mapboxData.features ?? []).map((f: { place_name: string; center: [number, number] }) => ({
            place_name: f.place_name,
            lat: f.center[1],
            lon: f.center[0],
          }))
        }

        setResults({ stations, addresses, loading: false })
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          setResults({ stations: [], addresses: [], loading: false })
        }
      }
    }, 200)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  return results
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm --prefix frontend run build 2>&1 | tail -8
```

Expected: `✓ built in` — no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useStationSearch.ts frontend/.env.example
git commit -m "feat: add useStationSearch hook with Mapbox geocoding + debounce"
```

---

## Task 4: `StationSearchInput` component

**Files:**
- Create: `frontend/src/components/StationSearchInput.tsx`

**Context:** Shared dropdown component used by both MyStations and SmartCommute. Uses `onMouseDown` + `e.preventDefault()` on result buttons (not `onClick`) so the input doesn't lose focus and close the dropdown before the selection registers. Keyboard nav: `↑`/`↓` moves highlight, `Enter` selects, `Escape` closes. Address selection calls `/api/stops/nearest` to resolve to a `stop_id` before calling `onSelect`.

- [ ] **Step 1: Create `frontend/src/components/StationSearchInput.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react'
import { useStationSearch } from '../hooks/useStationSearch'
import type { StationResult, AddressResult } from '../hooks/useStationSearch'

interface Props {
  placeholder?: string
  onSelect: (stop_id: string, name: string) => void
  defaultValue?: string
}

type Item =
  | { type: 'station'; data: StationResult }
  | { type: 'address'; data: AddressResult }

export function StationSearchInput({
  placeholder = 'Search station or address...',
  onSelect,
  defaultValue = '',
}: Props) {
  const [query, setQuery] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const { stations, addresses } = useStationSearch(query)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const items: Item[] = [
    ...stations.map(s => ({ type: 'station' as const, data: s })),
    ...addresses.map(a => ({ type: 'address' as const, data: a })),
  ]
  const hasResults = items.length > 0
  const showDropdown = open && query.length >= 2

  function selectStation(s: StationResult) {
    setQuery(s.name)
    onSelect(s.stop_id, s.name)
    setOpen(false)
    setHighlighted(-1)
  }

  async function selectAddress(a: AddressResult) {
    try {
      const res = await fetch(`/api/stops/nearest?lat=${a.lat}&lon=${a.lon}&limit=1`)
      const data = await res.json()
      const nearest = data.results?.[0]
      if (nearest) {
        setQuery(nearest.name)
        onSelect(nearest.stop_id, nearest.name)
        setOpen(false)
        setHighlighted(-1)
      }
    } catch { /* ignore network errors */ }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!showDropdown || items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlighted(-1)
    } else if (e.key === 'Enter' && highlighted >= 0) {
      const item = items[highlighted]
      if (item.type === 'station') selectStation(item.data)
      else selectAddress(item.data)
    }
  }

  function highlightMatch(text: string): React.ReactNode {
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1 || query.length === 0) return text
    return (
      <>
        {text.slice(0, idx)}
        <span style={{ color: 'var(--green)' }}>{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    )
  }

  const inputStyle: React.CSSProperties = {
    all: 'unset', display: 'block', width: '100%',
    background: 'var(--bg-surface)',
    border: `1px solid ${showDropdown && hasResults ? 'var(--green-border)' : 'var(--border)'}`,
    borderRadius: showDropdown && hasResults ? '3px 3px 0 0' : 3,
    padding: '8px 12px',
    color: 'var(--text-primary)', fontSize: 12,
    transition: 'border-color 0.1s',
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 8, letterSpacing: '0.14em', color: 'var(--text-faint)',
    padding: '5px 12px 3px',
    background: 'var(--bg)', borderBottom: '1px solid var(--border)',
  }

  let itemIdx = -1

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={inputStyle}
      />

      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg-surface)',
          border: '1px solid var(--green-border)', borderTop: 'none',
          borderRadius: '0 0 3px 3px',
          maxHeight: 280, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {stations.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>STATIONS</div>
              {stations.map(s => {
                itemIdx++
                const idx = itemIdx
                return (
                  <button
                    key={s.stop_id}
                    onMouseDown={e => { e.preventDefault(); selectStation(s) }}
                    style={{
                      all: 'unset', display: 'block', width: '100%',
                      padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                      color: 'var(--text-primary)',
                      background: highlighted === idx ? 'var(--bg-elevated)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                      boxSizing: 'border-box',
                    }}
                  >
                    {highlightMatch(s.name)}
                  </button>
                )
              })}
            </>
          )}

          {addresses.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>ADDRESSES</div>
              {addresses.map((a, i) => {
                itemIdx++
                const idx = itemIdx
                return (
                  <button
                    key={i}
                    onMouseDown={e => { e.preventDefault(); selectAddress(a) }}
                    style={{
                      all: 'unset', display: 'block', width: '100%',
                      padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                      color: 'var(--text-muted)',
                      background: highlighted === idx ? 'var(--bg-elevated)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                      boxSizing: 'border-box',
                    }}
                  >
                    📍 {a.place_name}
                  </button>
                )
              })}
            </>
          )}

          {!hasResults && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-faint)' }}>
              No results for "{query}"
            </div>
          )}
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
git add frontend/src/components/StationSearchInput.tsx
git commit -m "feat: add StationSearchInput autocomplete dropdown component"
```

---

## Task 5: Wire `StationSearchInput` into MyStations

**Files:**
- Modify: `frontend/src/views/MyStations.tsx`

**Context:** `MyStations.tsx` currently has inline state (`searchQ`, `searchResults`, `showSearch`), a `handleSearch` function, and a manual results list. Replace all of that with `<StationSearchInput>`. The `+ ADD STATION` button and `showSearch` toggle remain — `StationSearchInput` renders inside the same conditional block. The `addStop` function signature changes: it now receives `(stop_id: string, name: string)` directly from `onSelect` instead of a `{ stop_id, name }` object.

The full updated file:

```typescript
import { useState } from 'react'
import { ArrivalCard } from '../components/ArrivalCard'
import { SignalStrip } from '../components/SignalStrip'
import { SmartCommute } from './SmartCommute'
import { StationSearchInput } from '../components/StationSearchInput'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[]; addStation: (s: SavedStation) => void; removeStation: (id: string, dir: string) => void }
}

export function MyStations({ liveData, stationsCtx }: Props) {
  const { stations, addStation, removeStation } = stationsCtx
  const [showSearch, setShowSearch] = useState(false)

  function addStop(stop_id: string, name: string) {
    addStation({ stop_id: stop_id + 'N', name, direction: 'N', route_ids: [] })
    setShowSearch(false)
  }

  return (
    <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

      {/* LEFT: Station list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>MY STATIONS</span>
          {stations.length < 5 && (
            <button onClick={() => setShowSearch(v => !v)} style={{
              all: 'unset', cursor: 'pointer', marginLeft: 'auto',
              color: 'var(--green)', fontSize: 10, letterSpacing: '0.05em',
            }}>
              + ADD STATION
            </button>
          )}
        </div>

        {showSearch && (
          <div style={{ marginBottom: 16 }}>
            <StationSearchInput
              placeholder="Search station or NYC address..."
              onSelect={(stop_id, name) => addStop(stop_id, name)}
            />
          </div>
        )}

        {stations.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 40, textAlign: 'center' }}>
            No stations saved. Click + ADD STATION to get started.
          </div>
        ) : (
          stations.map(s => (
            <ArrivalCard
              key={`${s.stop_id}-${s.direction}`}
              station={s}
              arrivals={liveData.arrivals[s.stop_id] ?? []}
              onRemove={() => removeStation(s.stop_id, s.direction)}
              lastUpdate={liveData.lastUpdate}
            />
          ))
        )}

        {liveData.lineHealth.length > 0 && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div className="label" style={{ marginBottom: 8 }}>LIVE SIGNALS</div>
            <SignalStrip health={liveData.lineHealth} />
          </div>
        )}
      </div>

      {/* RIGHT: Smart Commute */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>SMART COMMUTE</span>
        </div>
        <SmartCommute liveData={liveData} stationsCtx={stationsCtx} />
      </div>

    </div>
  )
}
```

- [ ] **Step 1: Replace `frontend/src/views/MyStations.tsx` with the above**

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm --prefix frontend run build 2>&1 | tail -8
```

Expected: `✓ built in` — zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/MyStations.tsx
git commit -m "feat: wire StationSearchInput into MyStations"
```

---

## Task 6: Wire `StationSearchInput` into SmartCommute + env.example

**Files:**
- Modify: `frontend/src/views/SmartCommute.tsx`

**Context:** SmartCommute currently has `originResults`, `destResults`, `originName`, `destName`, `searchStops()`, and manual result button lists for both FROM and TO. Replace both with `<StationSearchInput>`. The `origin` and `dest` state (stop_ids) remain; `originName` and `destName` are replaced by the controlled `defaultValue` prop on `StationSearchInput`. Note: `SmartCommute` renders its own "SMART COMMUTE" label — that label is also in the parent (`MyStations.tsx`). Remove the duplicate from `SmartCommute` since `MyStations` provides the header.

Full updated `frontend/src/views/SmartCommute.tsx`:

```typescript
import { useState } from 'react'
import { StationSearchInput } from '../components/StationSearchInput'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[] }
}

interface CommuteOption {
  leave_in_sec: number
  board_at: string
  arrive_at: string
  route_id: string
  trip_id: string
  delay_sec: number
}

function fmt(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function SmartCommute({ liveData, stationsCtx }: Props) {
  const [origin, setOrigin] = useState('')
  const [dest, setDest] = useState('')
  const [options, setOptions] = useState<CommuteOption[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  void liveData
  void stationsCtx

  async function calculate() {
    if (!origin || !dest) { setError('Select both origin and destination.'); return }
    setLoading(true); setError(''); setOptions([])
    try {
      const res = await fetch(`/api/commute?origin=${origin}&destination=${dest}`)
      if (!res.ok) { setError('No route found between these stops.'); return }
      const data = await res.json()
      setOptions(data.options ?? [])
    } catch { setError('Network error — is the backend running?') }
    finally { setLoading(false) }
  }

  return (
    <div>
      {/* Origin */}
      <div style={{ marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 6 }}>FROM</div>
        <StationSearchInput
          placeholder="Search origin station or address..."
          onSelect={(stop_id) => setOrigin(stop_id + 'N')}
        />
      </div>

      {/* Destination */}
      <div style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>TO</div>
        <StationSearchInput
          placeholder="Search destination station or address..."
          onSelect={(stop_id) => setDest(stop_id + 'N')}
        />
      </div>

      <button onClick={calculate} disabled={loading} style={{
        all: 'unset', cursor: loading ? 'default' : 'pointer',
        background: 'var(--green-dim)', border: '1px solid var(--green-border)',
        borderRadius: 3, padding: '10px 20px', color: 'var(--green)',
        fontSize: 13, letterSpacing: '0.05em',
      }}>
        {loading ? 'CALCULATING...' : 'CALCULATE'}
      </button>

      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

      {options.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="label" style={{ marginBottom: 12 }}>DEPARTURES</div>
          {options.map((opt, i) => {
            const leaveInMin = Math.round(opt.leave_in_sec / 60)
            const isNow = leaveInMin === 0
            const isFirst = i === 0
            return (
              <div key={opt.trip_id} className="card" style={{
                marginBottom: 8,
                borderColor: isFirst ? (isNow ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)',
                opacity: isFirst ? 1 : 0.7,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ minWidth: 80, textAlign: 'center' }}>
                    {isNow ? (
                      <div style={{ color: 'var(--amber)', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}>
                        LEAVE NOW
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: isFirst ? 40 : 28, fontWeight: 700, color: isFirst ? 'var(--green)' : 'var(--text-muted)', lineHeight: 1 }}>
                          {leaveInMin}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>min to leave</div>
                      </>
                    )}
                  </div>
                  <div style={{ width: 1, height: 40, background: 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700 }}>{opt.route_id}</span>
                      {' train · board '}<span style={{ color: 'var(--green)' }}>{fmt(opt.board_at)}</span>
                      {opt.delay_sec > 30 && (
                        <span style={{ color: 'var(--amber)', fontSize: 12 }}> +{Math.round(opt.delay_sec / 60)}m delay</span>
                      )}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      Arrives {fmt(opt.arrive_at)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 1: Replace `frontend/src/views/SmartCommute.tsx` with the above**

- [ ] **Step 2: Verify TypeScript compiles and build passes**

```bash
npm --prefix frontend run build 2>&1 | tail -8
```

Expected: `✓ built in` — zero errors.

- [ ] **Step 3: Run full backend test suite one final time**

```bash
python3 -m pytest backend/tests/ -q
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/SmartCommute.tsx
git commit -m "feat: wire StationSearchInput into SmartCommute FROM/TO fields"
```
