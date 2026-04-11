# Location-Aware Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a NEARBY tab that uses the browser Geolocation API to locate the user's nearest subway station and show live arrival countdowns + a TrackDiagram anchored to their stop.

**Architecture:** A `useNearby` hook encapsulates the geolocation state machine (idle → locating → tracking/error). `NearbyView` renders per-state UI, merges N/S directional arrivals from `liveData`, and delegates the track diagram to the existing `TrackDiagram` component with `myStopId` wired. TopBar and App.tsx gain the `'nearby'` view slot.

**Tech Stack:** React 19, TypeScript, browser Geolocation API (`watchPosition`), existing `/api/stops/nearest` endpoint, `liveData` WebSocket feed, `TrackDiagram` + `LineBadge` components.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/hooks/useNearby.ts` | CREATE | Geolocation state machine, watchPosition, 150m threshold, nearest-stop fetch |
| `frontend/src/views/NearbyView.tsx` | CREATE | Per-state rendering, arrival countdown, line selector, TrackDiagram wiring |
| `frontend/src/components/TopBar.tsx` | MODIFY | Add `'nearby'` to `View` type, insert NEARBY into NAV array |
| `frontend/src/App.tsx` | MODIFY | Add `'nearby'` to `View` type, import + render `NearbyView` |

---

## Task 1: `useNearby` Hook

**Files:**
- Create: `frontend/src/hooks/useNearby.ts`
- Test: manual browser test (no unit test for native geo API; tested via NearbyView)

- [ ] **Step 1: Write the hook file**

```typescript
// frontend/src/hooks/useNearby.ts
import { useState, useRef, useCallback } from 'react'

export interface NearbyStation {
  stop_id: string
  name: string
  distance_mi: number
}

export type NearbyStatus =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'tracking'; station: NearbyStation; coords: { lat: number; lon: number } }
  | { status: 'error'; message: string }

function distanceMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dlat = lat2 - lat1
  const dlon = lon2 - lon1
  return Math.sqrt((dlat * 69) ** 2 + (dlon * 52.5) ** 2) * 1609
}

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:   return 'Location access denied. Enable in browser settings.'
    case err.POSITION_UNAVAILABLE: return 'Location unavailable. Try again outside.'
    case err.TIMEOUT:             return 'Location timed out. Try again.'
    default:                      return 'Unknown location error.'
  }
}

export function useNearby(): { state: NearbyStatus; start: () => void } {
  const [state, setState] = useState<NearbyStatus>({ status: 'idle' })
  const watchIdRef = useRef<number | null>(null)
  const lastFetchCoordsRef = useRef<{ lat: number; lon: number } | null>(null)

  const onSuccess = useCallback(async (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude

    // 150m threshold — skip API call if user hasn't moved enough
    if (lastFetchCoordsRef.current) {
      const dist = distanceMetres(
        lastFetchCoordsRef.current.lat,
        lastFetchCoordsRef.current.lon,
        lat,
        lon,
      )
      if (dist < 150) return
    }

    lastFetchCoordsRef.current = { lat, lon }

    try {
      const res = await fetch(`/api/stops/nearest?lat=${lat}&lon=${lon}&limit=1`)
      const results: NearbyStation[] = await res.json()
      if (results.length === 0) {
        setState({ status: 'error', message: 'No stations found nearby.' })
        return
      }
      setState({ status: 'tracking', station: results[0], coords: { lat, lon } })
    } catch {
      setState({ status: 'error', message: 'Failed to fetch nearest station.' })
    }
  }, [])

  const onError = useCallback((err: GeolocationPositionError) => {
    setState({ status: 'error', message: geoErrorMessage(err) })
  }, [])

  const start = useCallback(() => {
    // Clear any existing watch before starting a new one
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }
    lastFetchCoordsRef.current = null
    setState({ status: 'locating' })
    watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: false,
      maximumAge: 10000,
    })
  }, [onSuccess, onError])

  // Cleanup on unmount — register once via a ref-based effect in NearbyView
  // We expose the watchIdRef so NearbyView's useEffect cleanup can call clearWatch.
  // Simpler: wrap in a small useEffect here.
  // (useEffect import added below)
  return { state, start }
}
```

Wait — the cleanup `useEffect` was omitted above. Rewrite the file with the import included:

```typescript
// frontend/src/hooks/useNearby.ts
import { useState, useRef, useCallback, useEffect } from 'react'

export interface NearbyStation {
  stop_id: string
  name: string
  distance_mi: number
}

export type NearbyStatus =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'tracking'; station: NearbyStation; coords: { lat: number; lon: number } }
  | { status: 'error'; message: string }

function distanceMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dlat = lat2 - lat1
  const dlon = lon2 - lon1
  return Math.sqrt((dlat * 69) ** 2 + (dlon * 52.5) ** 2) * 1609
}

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:    return 'Location access denied. Enable in browser settings.'
    case err.POSITION_UNAVAILABLE: return 'Location unavailable. Try again outside.'
    case err.TIMEOUT:              return 'Location timed out. Try again.'
    default:                       return 'Unknown location error.'
  }
}

export function useNearby(): { state: NearbyStatus; start: () => void } {
  const [state, setState] = useState<NearbyStatus>({ status: 'idle' })
  const watchIdRef = useRef<number | null>(null)
  const lastFetchCoordsRef = useRef<{ lat: number; lon: number } | null>(null)

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  const onSuccess = useCallback(async (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude

    if (lastFetchCoordsRef.current) {
      const dist = distanceMetres(
        lastFetchCoordsRef.current.lat,
        lastFetchCoordsRef.current.lon,
        lat,
        lon,
      )
      if (dist < 150) return
    }

    lastFetchCoordsRef.current = { lat, lon }

    try {
      const res = await fetch(`/api/stops/nearest?lat=${lat}&lon=${lon}&limit=1`)
      const results: NearbyStation[] = await res.json()
      if (results.length === 0) {
        setState({ status: 'error', message: 'No stations found nearby.' })
        return
      }
      setState({ status: 'tracking', station: results[0], coords: { lat, lon } })
    } catch {
      setState({ status: 'error', message: 'Failed to fetch nearest station.' })
    }
  }, [])

  const onError = useCallback((err: GeolocationPositionError) => {
    setState({ status: 'error', message: geoErrorMessage(err) })
  }, [])

  const start = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }
    lastFetchCoordsRef.current = null
    setState({ status: 'locating' })
    watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: false,
      maximumAge: 10000,
    })
  }, [onSuccess, onError])

  return { state, start }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/jamest/subway-intel/frontend
npx tsc --noEmit
```

Expected: no errors for `useNearby.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/hooks/useNearby.ts
git commit -m "feat: add useNearby geolocation hook (idle/locating/tracking/error)"
```

---

## Task 2: TopBar + App.tsx Wiring

**Files:**
- Modify: `frontend/src/components/TopBar.tsx:4` — add `'nearby'` to View type
- Modify: `frontend/src/components/TopBar.tsx:12-16` — insert NEARBY into NAV array
- Modify: `frontend/src/App.tsx:10` — add `'nearby'` to View type
- Modify: `frontend/src/App.tsx:1-42` — import NearbyView, render when active

- [ ] **Step 1: Update TopBar**

In `frontend/src/components/TopBar.tsx`, change line 4:

```typescript
type View = 'stations' | 'nearby' | 'pulse' | 'intel'
```

Change the NAV array (lines 12-16) to:

```typescript
const NAV: { id: View; label: string }[] = [
  { id: 'stations', label: 'MY STATIONS' },
  { id: 'nearby',   label: 'NEARBY' },
  { id: 'pulse',    label: 'NETWORK PULSE' },
  { id: 'intel',    label: 'DELAY INTEL' },
]
```

- [ ] **Step 2: Update App.tsx**

Change line 10 of `frontend/src/App.tsx`:

```typescript
type View = 'stations' | 'nearby' | 'pulse' | 'intel'
```

Add import after line 8:

```typescript
import { NearbyView } from './views/NearbyView'
```

Add render block inside `<main>` after the `{activeView === 'intel' && ...}` block (before `</main>`):

```tsx
{activeView === 'nearby' && (
  <NearbyView liveData={liveData} />
)}
```

Note: `<main>` currently has `gridTemplateColumns: '1fr 1fr'`. NearbyView needs full width. Add `gridColumn: '1 / -1'` as a wrapper, OR — simpler — check `activeView` to override the grid. The cleanest fix: when `activeView === 'nearby'`, the main grid uses `1fr` instead of `1fr 1fr`. Change line 25 of App.tsx:

```tsx
gridTemplateColumns: activeView === 'nearby' ? '1fr' : '1fr 1fr',
```

- [ ] **Step 3: Verify TypeScript compiles (NearbyView doesn't exist yet — expect one error only)**

```bash
cd /Users/jamest/subway-intel/frontend
npx tsc --noEmit 2>&1 | grep -v NearbyView
```

Expected: zero errors unrelated to NearbyView.

- [ ] **Step 4: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/components/TopBar.tsx frontend/src/App.tsx
git commit -m "feat: wire NEARBY tab into TopBar and App"
```

---

## Task 3: `NearbyView` Component

**Files:**
- Create: `frontend/src/views/NearbyView.tsx`

- [ ] **Step 1: Write the component**

```typescript
// frontend/src/views/NearbyView.tsx
import { useState, useMemo } from 'react'
import type { LiveData, ArrivalEntry } from '../hooks/useLiveData'
import { useNearby } from '../hooks/useNearby'
import { LineBadge } from '../components/LineBadge'
import { TrackDiagram } from '../components/TrackDiagram'

interface Props {
  liveData: LiveData
}

export function NearbyView({ liveData }: Props) {
  const { state, start } = useNearby()
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (state.status === 'idle') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>NEARBY</span>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
          Uses your device location to find the closest station.
        </p>
        <button
          onClick={start}
          style={{
            all: 'unset',
            cursor: 'pointer',
            padding: '10px 20px',
            fontSize: 11,
            letterSpacing: '0.08em',
            borderRadius: 3,
            background: 'var(--green-dim)',
            border: '1px solid var(--green-border)',
            color: 'var(--green)',
          }}
        >
          ⊕ ENABLE LOCATION
        </button>
      </div>
    )
  }

  // ── Locating ──────────────────────────────────────────────────────────────
  if (state.status === 'locating') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20 }}>
        <span className="dot dot-green" style={{ animation: 'pulse-glow 1s ease-in-out infinite' }} />
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--green)' }}>LOCATING...</span>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (state.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--red)' }}>LOCATION UNAVAILABLE</span>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: 0 }}>{state.message}</p>
        <button
          onClick={start}
          style={{
            all: 'unset',
            cursor: 'pointer',
            padding: '8px 16px',
            fontSize: 10,
            letterSpacing: '0.07em',
            borderRadius: 3,
            background: '#1a1a1a',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            alignSelf: 'flex-start',
          }}
        >
          RE-TRY
        </button>
      </div>
    )
  }

  // ── Tracking ──────────────────────────────────────────────────────────────
  const { station } = state

  // Merge N + S directional arrivals for this parent stop
  const stopArrivals: ArrivalEntry[] = [
    ...(liveData.arrivals[station.stop_id + 'N'] ?? []),
    ...(liveData.arrivals[station.stop_id + 'S'] ?? []),
  ]

  // Group by route_id, take soonest per route, filter past trains, sort soonest first
  const now = Date.now()
  const routeMap = new Map<string, { minUntil: number; entry: ArrivalEntry }>()
  for (const entry of stopArrivals) {
    const minUntil = Math.round((new Date(entry.arrival_time).getTime() - now) / 60000)
    if (minUntil < 0) continue
    const existing = routeMap.get(entry.route_id)
    if (!existing || minUntil < existing.minUntil) {
      routeMap.set(entry.route_id, { minUntil, entry })
    }
  }
  const sortedRoutes = [...routeMap.entries()].sort((a, b) => a[1].minUntil - b[1].minUntil)

  // Route list for line selector pills
  const routeIds = useMemo(() => {
    if (sortedRoutes.length > 0) return sortedRoutes.map(([rid]) => rid)
    // Fallback: derive from lineHealth if no arrivals
    return liveData.lineHealth.map(h => h.route_id)
  }, [sortedRoutes, liveData.lineHealth])

  // Default selected route to soonest arrival
  const activeRoute = selectedRoute ?? routeIds[0] ?? null

  const noArrivals = stopArrivals.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
          📍 {station.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          {station.distance_mi.toFixed(1)} mi
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="dot dot-green" style={{ animation: 'pulse-glow 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--green)' }}>TRACKING</span>
        </span>
      </div>

      {/* ── Next Arrivals ── */}
      <div>
        <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-faint)', marginBottom: 8 }}>
          NEXT ARRIVALS
        </div>
        {noArrivals ? (
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
            No live arrivals — feed may not cover this station.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {sortedRoutes.map(([routeId, { minUntil }], i) => (
              <div
                key={routeId}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  opacity: i === 0 ? 1 : 0.45,
                }}
              >
                <LineBadge routeId={routeId} size={16} />
                <span style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: i === 0 ? 'var(--green)' : 'var(--text-secondary)',
                  lineHeight: 1,
                }}>
                  {minUntil === 0 ? 'NOW' : `${minUntil}m`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Line Selector ── */}
      {routeIds.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {routeIds.map(rid => (
            <button
              key={rid}
              onClick={() => setSelectedRoute(rid)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                borderRadius: '50%',
                outline: activeRoute === rid ? '2px solid var(--green)' : '2px solid transparent',
                outlineOffset: 2,
              }}
            >
              <LineBadge routeId={rid} size={20} />
            </button>
          ))}
        </div>
      )}

      {/* ── Track Diagram ── */}
      {activeRoute && (
        <TrackDiagram
          routeId={activeRoute}
          vehiclePositions={liveData.vehiclePositions}
          lineHealth={liveData.lineHealth}
          myStopId={station.stop_id}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
cd /Users/jamest/subway-intel/frontend
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Start dev server and manually test each state**

```bash
cd /Users/jamest/subway-intel/frontend
npm run dev
```

Open `http://localhost:5173`. Click NEARBY tab. Verify:

1. **Idle state**: "ENABLE LOCATION" green button appears. No browser permission prompt fires on tab load.
2. **Locating state**: Click button → "LOCATING..." with pulsing dot appears immediately.
3. **Tracking state**: Browser prompts for location → permission granted → header shows station name, distance, TRACKING badge. NEXT ARRIVALS row renders countdown pills. Line selector pills appear. TrackDiagram renders with amber anchor dot at the user's stop.
4. **Error state**: Deny location → "LOCATION UNAVAILABLE" + error message + RE-TRY button. Clicking RE-TRY re-enters locating state.
5. **Mobile (DevTools device mode)**: Full-width layout, all elements readable.

- [ ] **Step 4: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/views/NearbyView.tsx
git commit -m "feat: add NearbyView with arrival countdown, line selector, and TrackDiagram anchor"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| NEARBY tab, 4th in TopBar, order: MY STATIONS / NEARBY / NETWORK PULSE / DELAY INTEL | Task 2 |
| `View` type gains `'nearby'` in App.tsx and TopBar | Task 2 |
| `useNearby` hook returns `{ state: NearbyStatus; start() }` | Task 1 |
| State machine: idle / locating / tracking / error | Task 1 |
| watchPosition with `enableHighAccuracy: false, maximumAge: 10000` | Task 1 |
| `start()` called on button press, not on mount | Task 1 |
| 150m movement threshold before re-fetching | Task 1 |
| `PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT` error messages | Task 1 |
| clearWatch on unmount | Task 1 |
| Idle render: "ENABLE LOCATION" CTA | Task 3 |
| Locating render: pulsing dot + "LOCATING..." | Task 3 |
| Error render: message + RE-TRY button | Task 3 |
| Tracking render: header with name + distance + TRACKING badge | Task 3 |
| Arrivals merged from `stop_id + 'N'` and `stop_id + 'S'` | Task 3 |
| Filter past trains (`minUntil >= 0`), soonest per route, sorted | Task 3 |
| "No live arrivals" message when empty | Task 3 |
| Countdown pills: LineBadge + minUntil, first pill green, rest dimmed | Task 3 |
| `NOW` when `minUntil === 0` | Task 3 |
| Line selector pills, default = soonest route | Task 3 |
| Fallback route list from `lineHealth` if no arrivals | Task 3 |
| `TrackDiagram` with `myStopId={station.stop_id}` | Task 3 |
| NearbyView full-width (not in 2-col grid) | Task 2 (gridTemplateColumns override) |
| No backend changes | ✅ confirmed — all data from existing endpoints |

**Placeholder scan:** No TBDs or incomplete stubs found.

**Type consistency:** `NearbyStation`, `NearbyStatus` defined in `useNearby.ts` and imported by `NearbyView.tsx`. `ArrivalEntry` imported from `useLiveData`. `LineBadge` and `TrackDiagram` props match their existing signatures (`routeId`, `vehiclePositions`, `lineHealth`, `myStopId`). All consistent.
