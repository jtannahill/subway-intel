# Live Station Search — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

## Overview

Replace the two existing bare search inputs (MyStations "Add Station", SmartCommute FROM/TO) with a shared `StationSearchInput` component that provides live autocomplete: subway station name matches from the GTFS static index, and NYC address/POI matches from the Mapbox Geocoding REST API. Results merge into a single dropdown, deduplicated, with line badges on station results and a nearest-station chip on address results.

---

## Architecture

### Data sources

| Source | Query | Result type |
|--------|-------|-------------|
| `/api/stops/search?q=&limit=` | Station name substring match | `{ stop_id, name, lat, lon }` |
| Mapbox Geocoding REST API | Address / POI / place | `{ place_name, lat, lon }` |
| `/api/stops/nearest?lat=&lon=&limit=1` | Lat/lon → closest stop | `{ stop_id, name, distance_mi }` |

Mapbox token: `VITE_MAPBOX_TOKEN` in `frontend/.env`. Geocoding query scoped to NYC bounding box (`bbox=-74.26,40.48,-73.70,40.92`), `country=US`, `types=address,poi,place`. Plain `fetch` — no SDK.

### Flow

1. User types → 200ms debounce fires  
2. Both searches run in parallel (`/api/stops/search` + Mapbox)  
3. Dropdown renders: STATIONS section (station matches), ADDRESSES section (Mapbox matches with nearest-stop chip)  
4. User selects a station result → `onSelect(stop_id, name)` called immediately  
5. User selects an address result → `fetch /api/stops/nearest` → resolves stop_id → `onSelect(stop_id, name)` called transparently  

Caller only ever receives `onSelect(stop_id: string, name: string)` — same interface regardless of whether user typed a station name or an address.

---

## Backend Changes

### `backend/gtfs/static.py`

#### Fix: deduplicate `search_stops()`

Currently returns one row per stop ID — stations with N/S directional variants appear multiple times under the same name. Fix: group by `stop_name`, prefer the stop_id that has no `N`/`S` suffix (the parent stop), fall back to the first occurrence.

Updated signature (return lat/lon too):
```python
def search_stops(query: str, limit: int = 10) -> list[dict]:
    # Returns: [{ stop_id, name, lat, lon }, ...]
    # Deduplicated by name; parent stop_id preferred over directional variants
```

#### New: `nearest_stops()`

```python
def nearest_stops(lat: float, lon: float, limit: int = 1) -> list[dict]:
    # Returns up to `limit` stops sorted by Euclidean distance from (lat, lon)
    # Each entry: { stop_id, name, lat, lon, distance_mi }
    # Uses _stops dict already loaded at startup — no external call
```

### `backend/api/routes.py`

New endpoint:

```python
@router.get('/api/stops/nearest')
async def get_nearest_stops(lat: float, lon: float, limit: int = 1):
    # Returns { results: [{ stop_id, name, lat, lon, distance_mi }] }
```

---

## Frontend Changes

### `frontend/src/hooks/useStationSearch.ts` (new)

```ts
interface StationResult {
  stop_id: string
  name: string
  lat: number
  lon: number
}

interface AddressResult {
  place_name: string
  lat: number
  lon: number
}

interface SearchResults {
  stations: StationResult[]
  addresses: AddressResult[]
  loading: boolean
}

export function useStationSearch(query: string): SearchResults
```

- Debounces query by 200ms
- Returns `{ stations: [], addresses: [], loading: false }` immediately for `query.length < 2`
- Fires both fetches in parallel when debounce fires
- Cancels in-flight requests via `AbortController` when query changes

### `frontend/src/components/StationSearchInput.tsx` (new)

```ts
interface Props {
  placeholder?: string
  onSelect: (stop_id: string, name: string) => void
  defaultValue?: string   // pre-fills the input (display name)
}
```

**Dropdown structure:**

```
┌────────────────────────────────┐
│  <input value={query} />       │
├────────────────────────────────┤
│  STATIONS                      │  ← section header, hidden if 0 results
│  ● Times Sq–42 St              │  ← matched text highlighted in green
│  ● 42 St–Port Authority        │
├────────────────────────────────┤
│  ADDRESSES                     │  ← section header, hidden if 0 results
│  📍 350 5th Ave, New York      │
│     → 34 St–Herald Sq · 0.2mi │  ← nearest stop chip (loaded async)
└────────────────────────────────┘
```

**Keyboard navigation:** `↑`/`↓` moves highlight, `Enter` selects highlighted, `Escape` closes.

**Address selection flow:** on click/Enter, fetch `/api/stops/nearest?lat=&lon=` → call `onSelect(stop_id, nearestName)`.

**Empty states:**
- `query.length < 2`: no dropdown
- No results from either source: single row "No results for '{query}'"
- Station section hidden if 0 station matches (not shown as empty)
- Address section hidden if 0 address matches

### `frontend/src/views/MyStations.tsx`

Replace the inline search state (`searchQ`, `searchResults`, `showSearch`) and `handleSearch` / `addStop` functions with `<StationSearchInput onSelect={addStop} />`. The `showSearch` toggle and `+ ADD STATION` button remain — `StationSearchInput` renders inside the existing conditional block.

### `frontend/src/views/SmartCommute.tsx`

Replace the two manual input + dropdown patterns (FROM and TO) with two `<StationSearchInput>` instances:

```tsx
<StationSearchInput
  placeholder="Search origin station or address..."
  onSelect={(stop_id, name) => { setOrigin(stop_id); setOriginName(name) }}
  defaultValue={originName}
/>
<StationSearchInput
  placeholder="Search destination station or address..."
  onSelect={(stop_id, name) => { setDest(stop_id); setDestName(name) }}
  defaultValue={destName}
/>
```

Remove `originResults`, `destResults`, `searchStops()` function, and the manual result button lists.

### `frontend/.env.example` (new)

```
VITE_MAPBOX_TOKEN=pk.your_token_here
```

---

## Files Changed

| File | Action |
|------|--------|
| `backend/gtfs/static.py` | Fix dedup in `search_stops()`; add `nearest_stops()`; return lat/lon |
| `backend/api/routes.py` | Add `/api/stops/nearest` endpoint |
| `backend/tests/test_api.py` | Tests for `/api/stops/nearest` |
| `backend/tests/test_feed.py` or new `test_static.py` | Tests for deduped `search_stops()` |
| `frontend/src/hooks/useStationSearch.ts` | New — debounce + parallel fetch + merge |
| `frontend/src/components/StationSearchInput.tsx` | New — shared autocomplete dropdown |
| `frontend/src/views/MyStations.tsx` | Replace inline search with `StationSearchInput` |
| `frontend/src/views/SmartCommute.tsx` | Replace both FROM/TO with `StationSearchInput` |
| `frontend/.env.example` | New — documents `VITE_MAPBOX_TOKEN` |

## Non-Goals

- Route_id badges on station results (stop→route mapping not in current GTFS index)
- Caching Mapbox responses
- Mobile keyboard handling beyond standard browser behavior
- Backend-side Mapbox proxy (key lives in frontend env var)
