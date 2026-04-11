# Location-Aware Station Design Spec

**Date:** 2026-04-11
**Status:** Approved

## Goal

Add a NEARBY tab to the dashboard that uses the browser Geolocation API to find the user's nearest subway station and display live arrival countdowns plus a track diagram anchored to their stop — updating automatically as they move.

---

## 1. New Tab: NEARBY

Add `'nearby'` as a fourth tab in `TopBar`. Order: MY STATIONS / NEARBY / NETWORK PULSE / DELAY INTEL.

`App.tsx` type `View` gains `'nearby'`. `TopBar` NAV array gains `{ id: 'nearby', label: 'NEARBY' }`. `App.tsx` renders `<NearbyView liveData={liveData} />` when `activeView === 'nearby'`.

---

## 2. `useNearby` Hook

**File:** `frontend/src/hooks/useNearby.ts`

Manages geolocation state and nearest-station resolution. Returns a typed state union.

### State type

```typescript
export type NearbyStatus =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'tracking'; station: NearbyStation; coords: { lat: number; lon: number } }
  | { status: 'error'; message: string }

export interface NearbyStation {
  stop_id: string
  name: string
  distance_mi: number
}
```

### Behavior

On mount: calls `navigator.geolocation.watchPosition(onSuccess, onError, { enableHighAccuracy: false, maximumAge: 10000 })`. Sets status to `'locating'` immediately.

`onSuccess(pos)`: fetch `/api/stops/nearest?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&limit=1`.
- On success: update state to `{ status: 'tracking', station: result[0], coords: { lat, lon } }`.
- Auto-switch threshold: only call the API if the user has moved more than **150m** since the last fetch (avoids hammering the backend while standing still). Distance computed with the flat-earth approximation already used in `backend/gtfs/static.py`: `sqrt((dlat * 69)^2 + (dlon * 52.5)^2) * 1609` metres.
- If the API returns an empty result (no stops found): set `{ status: 'error', message: 'No stations found nearby.' }`.

`onError(err)`: map `err.code` to a human message:
- `PERMISSION_DENIED` → `'Location access denied. Enable in browser settings.'`
- `POSITION_UNAVAILABLE` → `'Location unavailable. Try again outside.'`
- `TIMEOUT` → `'Location timed out. Try again.'`

Cleanup: `navigator.geolocation.clearWatch(watchId)` on unmount.

### No permission prompt on mount

The hook does NOT call `watchPosition` until the user explicitly triggers it (via a button in `NearbyView`). This avoids the browser permission dialog appearing as soon as the NEARBY tab loads. `status` starts as `'idle'`. The hook exposes a `start()` function that the view calls on button press.

```typescript
export function useNearby(): { state: NearbyStatus; start: () => void }
```

---

## 3. `NearbyView` Component

**File:** `frontend/src/views/NearbyView.tsx`

Props: `{ liveData: LiveData }`

Uses `useNearby()` internally.

### Rendering per state

**idle:**
```
[NEARBY]
Uses your device location to find the closest station.
[⊕ ENABLE LOCATION]   ← button, styled like the green CTA buttons elsewhere
```

**locating:**
```
LOCATING...   ← pulsing dot + text, same style as CONNECTING in TopBar
```

**error:**
```
LOCATION UNAVAILABLE
[error message]
[RE-TRY]   ← calls start() again
```

**tracking** (main view):

```
📍 [station name]   [distance_mi mi]   [● TRACKING]

NEXT ARRIVALS
[route badge] [countdown]  [route badge] [countdown]  ...   ← one row, sorted soonest first

[line selector pills: one per route at this stop]    ← selected pill highlighted green

[TrackDiagram for selected route, myStopId={station.stop_id}]
```

### Arrival countdown

Source: the WebSocket feed keys arrivals by stop_id **including direction suffix** (e.g. `"127N"`, `"127S"`). The nearest-stop API returns the parent stop_id (e.g. `"127"`, no suffix). To collect all arrivals at the station, merge both directional variants:

```typescript
const stopArrivals = [
  ...(liveData.arrivals[station.stop_id + 'N'] ?? []),
  ...(liveData.arrivals[station.stop_id + 'S'] ?? []),
]
```

If both are empty (stop not in feed), show "No live arrivals — feed may not cover this station."

For each `ArrivalEntry`, compute minutes until arrival:
```typescript
const minUntil = Math.round((new Date(entry.arrival_time).getTime() - Date.now()) / 60000)
```
Filter to `minUntil >= 0` (no past trains). Group by `route_id`, take the soonest per route. Sort routes by their soonest `minUntil`.

Display: a flex row of countdown pills. Each pill: `<LineBadge routeId={...} size={16} />` + `{minUntil}m` in large text (or `NOW` if `minUntil === 0`). First (soonest) pill styled green, rest dimmed.

### Line selector

A row of `<LineBadge>` pills for each unique `route_id` in `liveData.arrivals[station.stop_id]`. Clicking one sets `selectedRoute` state. Default: the route with the soonest arrival.

If `arrivals[station.stop_id]` is empty, derive route list from `liveData.lineHealth` as a fallback — show all routes on `lineHealth`, which isn't stop-specific but gives the user something to browse.

### TrackDiagram

```tsx
<TrackDiagram
  routeId={selectedRoute}
  vehiclePositions={liveData.vehiclePositions}
  lineHealth={liveData.lineHealth}
  myStopId={station.stop_id}
/>
```

This is the first real use of `myStopId` — the amber anchor dot now appears at the user's station.

---

## 4. Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/useNearby.ts` | NEW — geolocation state machine + nearest-stop fetch |
| `frontend/src/views/NearbyView.tsx` | NEW — NEARBY tab UI |
| `frontend/src/components/TopBar.tsx` | Add `'nearby'` to `View` type and NAV array |
| `frontend/src/App.tsx` | Add `NearbyView` import + render when `activeView === 'nearby'` |

---

## 5. No Backend Changes

All data sources already exist:
- `/api/stops/nearest` — live since Plan 1
- `liveData.arrivals` — populated by WebSocket feed for any stop
- `liveData.vehiclePositions` — already broadcast
- `TrackDiagram` with `myStopId` — ready since UX Refresh

---

## 6. Out of Scope

- Caching or persisting the last-known location across sessions
- Showing multiple nearby stations
- Requesting location on app load (always opt-in via button)
- Any backend changes
