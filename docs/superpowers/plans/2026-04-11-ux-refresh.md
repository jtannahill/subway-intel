# UX Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the subway-intel dashboard mobile-responsive, improve Smart Commute readability with live route status, and redesign TrackDiagram to show both directions simultaneously with visually distinct train dots.

**Architecture:** Four independent tasks, all frontend-only (no backend changes). A new `useMediaQuery` hook drives responsive layout across the two 2-column views. SmartCommute adds LineBadge + lineHealth status to results. TrackDiagram is rewritten to show ↑ UPTOWN and ↓ DOWNTOWN tracks stacked, with fixed-width slot layout enabling precise label positioning.

**Tech Stack:** React 19, TypeScript, Vite. No new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/hooks/useMediaQuery.ts` | NEW — `matchMedia` wrapper hook |
| `frontend/src/views/MyStations.tsx` | inner 2-col grid → responsive |
| `frontend/src/views/NetworkPulse.tsx` | inner 2-col grid → responsive |
| `frontend/src/views/DelayIntel.tsx` | table row → `overflow-x: auto` wrapper on mobile |
| `frontend/src/views/SmartCommute.tsx` | LineBadge in results + live status strip |
| `frontend/src/components/TrackDiagram.tsx` | full rewrite — both directions, slot layout, myStopId prop |

---

## Task 1: useMediaQuery hook

**Files:**
- Create: `frontend/src/hooks/useMediaQuery.ts`

Context: There are no existing React tests in this repo. The test for frontend tasks is a TypeScript build check (`npm run build` from `frontend/`) plus visual verification at `http://127.0.0.1:8000`. The backend server can be left running.

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useMediaQuery.ts
import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `frontend/`:
```bash
npm run build
```
Expected: no errors, `dist/` produced.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useMediaQuery.ts
git commit -m "feat: useMediaQuery hook for responsive layout"
```

---

## Task 2: Responsive layout — MyStations, NetworkPulse, DelayIntel

**Files:**
- Modify: `frontend/src/views/MyStations.tsx`
- Modify: `frontend/src/views/NetworkPulse.tsx`
- Modify: `frontend/src/views/DelayIntel.tsx`

Context: Each view already spans the full App grid with `gridColumn: '1 / -1'`. The responsive changes are to the inner 2-column grids inside MyStations and NetworkPulse. DelayIntel uses a 6-column fixed table that needs a horizontal scroll wrapper on mobile.

- [ ] **Step 1: Update MyStations**

In `frontend/src/views/MyStations.tsx`, add the import and use `isMobile` to collapse the inner grid:

```typescript
// Add to imports at top of file (after existing imports):
import { useMediaQuery } from '../hooks/useMediaQuery'
```

Inside the `MyStations` function body, add after the destructuring line:
```typescript
const isMobile = useMediaQuery('(max-width: 768px)')
```

Change the outer `<div>` style (line 25 in current file — the one with `gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr'`):
```tsx
<div style={{
  gridColumn: '1 / -1',
  display: 'grid',
  gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
  gap: 16,
  alignItems: 'start',
}}>
```

- [ ] **Step 2: Update NetworkPulse**

In `frontend/src/views/NetworkPulse.tsx`, add the import (after existing imports):
```typescript
import { useMediaQuery } from '../hooks/useMediaQuery'
```

Inside `NetworkPulse`, add after the existing `useState` calls:
```typescript
const isMobile = useMediaQuery('(max-width: 768px)')
```

Change the outer wrapper `<div>` style (line 69 — the one with `gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr'`):
```tsx
<div style={{
  gridColumn: '1 / -1',
  display: 'grid',
  gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
  gap: 16,
  alignItems: 'start',
}}>
```

- [ ] **Step 3: Update DelayIntel — horizontal scroll wrapper**

In `frontend/src/views/DelayIntel.tsx`, add the import (after existing imports):
```typescript
import { useMediaQuery } from '../hooks/useMediaQuery'
```

Inside `DelayIntel`, add after the sort variable:
```typescript
const isMobile = useMediaQuery('(max-width: 768px)')
```

Wrap the table header + rows section in a scroll container. Replace the existing table header `<div>` and rows `<div>` with:
```tsx
<div style={{ overflowX: isMobile ? 'auto' : 'visible' }}>
  {/* Table header */}
  <div style={{
    display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
    gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--border)',
    minWidth: isMobile ? 480 : undefined,
  }}>
    {['LINE', 'STATUS', 'AVG DELAY', 'HW VARIANCE', 'TREND', 'ALERTS'].map(h => (
      <div key={h} className="label">{h}</div>
    ))}
  </div>

  {sorted.length === 0 ? (
    <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '20px 14px' }}>
      Waiting for feed data...
    </div>
  ) : (
    sorted.map(h => (
      <div key={h.route_id} style={{
        display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
        gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
        alignItems: 'center',
        minWidth: isMobile ? 480 : undefined,
      }}>
        <div><LineBadge routeId={h.route_id} size={20} /></div>
        <div>
          <span style={{ color: STATUS_COLORS[h.status], fontSize: 11 }}>{h.status}</span>
          <GapFlag h={h} />
        </div>
        <div style={{ color: 'var(--text-primary)', fontSize: 11 }}>
          {Math.round(h.avg_delay_sec)}s
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          ±{Math.round(Math.sqrt(h.headway_variance))}s
        </div>
        <div style={{ fontSize: 14 }}><TrendArrow h={h} /></div>
        <div style={{ color: h.alerts.length > 0 ? 'var(--amber)' : 'var(--text-faint)', fontSize: 11 }}>
          {h.alerts.length > 0 ? h.alerts.length : '—'}
        </div>
      </div>
    ))
  )}
</div>
```

- [ ] **Step 4: Build check**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/MyStations.tsx frontend/src/views/NetworkPulse.tsx frontend/src/views/DelayIntel.tsx
git commit -m "feat: responsive layout — 2-col grids collapse to 1-col on mobile"
```

---

## Task 3: SmartCommute — LineBadge + live route status

**Files:**
- Modify: `frontend/src/views/SmartCommute.tsx`

Context: The current results section shows `opt.route_id` as plain text (e.g. `"4 train · board 3:12 PM"`). We want: (1) replace the text route_id with a `<LineBadge>`, and (2) add a live status banner below the results that pulls from `liveData.lineHealth` for the routes in the commute result.

The `liveData` prop is already received but currently voided with `void liveData`. Remove that void.

- [ ] **Step 1: Add LineBadge import and un-void liveData**

In `frontend/src/views/SmartCommute.tsx`, add to the imports:
```typescript
import { LineBadge } from '../components/LineBadge'
```

Remove the `void liveData` line (line 31 in current file). The `void stationsCtx` line can stay (stationsCtx is still unused in SmartCommute).

- [ ] **Step 2: Replace text route_id with LineBadge in each result card**

In the result card (inside the `options.map`), find this block:
```tsx
<div style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 4 }}>
  <span style={{ fontWeight: 700 }}>{opt.route_id}</span>
  {' train · board '}<span style={{ color: 'var(--green)' }}>{fmt(opt.board_at)}</span>
  {opt.delay_sec > 30 && (
    <span style={{ color: 'var(--amber)', fontSize: 12 }}> +{Math.round(opt.delay_sec / 60)}m delay</span>
  )}
</div>
```

Replace with:
```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
  <LineBadge routeId={opt.route_id} size={20} />
  <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>
    {'board '}<span style={{ color: 'var(--green)' }}>{fmt(opt.board_at)}</span>
  </span>
  {opt.delay_sec > 30 && (
    <span style={{ color: 'var(--amber)', fontSize: 12 }}>+{Math.round(opt.delay_sec / 60)}m delay</span>
  )}
</div>
```

- [ ] **Step 3: Update no-route error message**

Find this line in `SmartCommute.tsx`:
```typescript
if (!res.ok) { setError('No route found between these stops.'); return }
```
Replace with:
```typescript
if (!res.ok) { setError('No direct route found. Try nearby stations.'); return }
```

- [ ] **Step 4: Add live route status strip below results**

After the closing `</div>` of the `{options.length > 0 && (...)}` block, add:

```tsx
{options.length > 0 && (() => {
  const routeIds = [...new Set(options.map(o => o.route_id))]
  const statuses = routeIds
    .map(rid => liveData.lineHealth.find(h => h.route_id === rid))
    .filter((h): h is NonNullable<typeof h> => !!h)
  if (statuses.length === 0) return null

  const disrupted = statuses.find(h => h.status === 'DISRUPTED')
  const delayed = statuses.find(h => h.status === 'DELAYED')
  const worst = disrupted ?? delayed

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {worst && (
        <div style={{
          padding: '8px 12px', borderRadius: 3,
          background: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
          color: 'var(--amber)', fontSize: 11, letterSpacing: '0.04em',
        }}>
          ⚠ Route affected — {worst.route_id} is {worst.status.toLowerCase()}
          {worst.alerts.length > 0 && ` · ${worst.alerts.length} alert${worst.alerts.length > 1 ? 's' : ''}`}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {statuses.map(h => {
          const color = h.status === 'DISRUPTED' ? 'var(--red)' : h.status === 'DELAYED' ? 'var(--amber)' : 'var(--green)'
          const bg = h.status === 'DISRUPTED' ? 'var(--red-dim)' : h.status === 'DELAYED' ? 'var(--amber-dim)' : 'var(--green-dim)'
          const border = h.status === 'DISRUPTED' ? 'var(--red-border)' : h.status === 'DELAYED' ? 'var(--amber-border)' : 'var(--green-border)'
          return (
            <div key={h.route_id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', borderRadius: 2,
              background: bg, border: `1px solid ${border}`,
            }}>
              <LineBadge routeId={h.route_id} size={14} />
              <span style={{ color, fontSize: 9, letterSpacing: '0.06em' }}>{h.status}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
})()}
```

- [ ] **Step 4: Build check**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 6: Build check**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/SmartCommute.tsx
git commit -m "feat: smart commute results show LineBadge + live route status"
```

---

## Task 4: TrackDiagram — both directions, slot layout, myStopId

**Files:**
- Modify: `frontend/src/components/TrackDiagram.tsx`

Context: Current component has a direction toggle (UPTOWN / DOWNTOWN). We're replacing it with two stacked tracks shown simultaneously. The key design decision: use a fixed-slot layout where each stop occupies `SLOT=16px` wide column and each connector is `CONN=20px` wide. This lets labels be precisely positioned with `position: absolute` relative to known pixel offsets, avoiding flex alignment issues.

Uptown track: direction=1 stop list (left = south terminus, right = north terminus — the natural GTFS direction=1 order).
Downtown track: the same stops reversed, so both tracks are geographically aligned (north = right on both).

Vehicles: match by stripping N/S from `v.stop_id`. If `v.stop_id.endsWith('N')` → uptown track. If `v.stop_id.endsWith('S')` → downtown track.

Labels: shown between the two tracks. Even-index stops: label in top half (y=0). Odd-index stops: label in bottom half (y=14). Each label centered at `i * (SLOT + CONN) + SLOT / 2` px.

Only fetch direction=1 (no need for a separate direction=0 fetch — we reverse the list).

- [ ] **Step 1: Rewrite TrackDiagram**

Replace the entire contents of `frontend/src/components/TrackDiagram.tsx` with:

```typescript
import { useEffect, useRef, useState } from 'react'
import type { VehiclePositionEntry, LineHealthEntry } from '../hooks/useLiveData'

interface Stop { stop_id: string; name: string }

interface Props {
  routeId: string
  vehiclePositions: VehiclePositionEntry[]
  lineHealth: LineHealthEntry[]
  myStopId?: string
}

const SLOT = 16  // px: width of each stop's "column"
const CONN = 20  // px: width of the connector rail between stops

export function TrackDiagram({ routeId, vehiclePositions, lineHealth, myStopId }: Props) {
  const [stops, setStops] = useState<Stop[]>([])
  const [error, setError] = useState(false)
  const cacheRef = useRef<Record<string, Stop[]>>({})

  useEffect(() => {
    setStops([]); setError(false)
    if (cacheRef.current[routeId]) { setStops(cacheRef.current[routeId]); return }
    const ctrl = new AbortController()
    fetch(`/api/routes/${routeId}/stops?direction=1`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { const s: Stop[] = d.stops ?? []; cacheRef.current[routeId] = s; setStops(s) })
      .catch(e => { if ((e as Error)?.name !== 'AbortError') setError(true) })
    return () => ctrl.abort()
  }, [routeId])

  if (error) return (
    <div style={{ color: 'var(--text-faint)', fontSize: 10, padding: '8px 0', letterSpacing: '0.08em' }}>
      NO ROUTE DATA
    </div>
  )
  if (stops.length === 0) return null

  const uptownStops = stops                   // direction=1: south→north (left→right)
  const downtownStops = [...stops].reverse()  // direction=0: north→south → reverse for geo alignment

  // Separate vehicle maps by direction suffix
  const uptownMap = new Map<string, VehiclePositionEntry>()
  const downtownMap = new Map<string, VehiclePositionEntry>()
  for (const vp of vehiclePositions.filter(v => v.route_id === routeId)) {
    const base = vp.stop_id.replace(/[NS]$/, '')
    if (vp.stop_id.endsWith('N')) uptownMap.set(base, vp)
    else downtownMap.set(base, vp)
  }

  const health = lineHealth.find(h => h.route_id === routeId)
  const isDelayed = (health?.avg_delay_sec ?? 0) > 60
  const myBase = myStopId?.replace(/[NS]$/, '')

  const totalWidth = stops.length * (SLOT + CONN)

  function getDotStyle(
    stop: Stop,
    vehicleMap: Map<string, VehiclePositionEntry>,
    i: number,
  ): { size: number; bg: string; border: string; shadow: string; anim: string; left: number; top: number } {
    const base = stop.stop_id.replace(/[NS]$/, '')
    const vp = vehicleMap.get(base)
    const isMyStop = !!myBase && base === myBase
    const hasTrain = !!vp
    const isApproaching = vp?.status === 'IN_TRANSIT_TO' || vp?.status === 'INCOMING_AT'

    const size = hasTrain ? 14 : isMyStop ? 10 : 8
    const bg = hasTrain ? (isDelayed ? 'var(--amber)' : 'var(--green)') : isMyStop ? 'var(--amber)' : '#1e3a1e'
    const border = hasTrain
      ? (isDelayed ? '2px solid var(--amber)' : '2px solid var(--green)')
      : isMyStop ? '2px solid var(--amber)' : '1px solid #2a5a2a'
    const shadow = hasTrain
      ? (isDelayed ? '0 0 8px #f59e0b88' : '0 0 8px #22c55e88')
      : isMyStop ? '0 0 4px var(--amber)' : 'none'
    const anim = hasTrain && isApproaching ? 'pulse-glow 1.2s ease-out infinite' : 'none'
    const left = i * (SLOT + CONN) + (SLOT - size) / 2
    const top = (20 - size) / 2
    return { size, bg, border, shadow, anim, left, top }
  }

  function renderTrack(trackStops: Stop[], vehicleMap: Map<string, VehiclePositionEntry>) {
    return (
      <div style={{ position: 'relative', height: 20, width: totalWidth }}>
        {/* Rail */}
        <div style={{
          position: 'absolute', top: 9, left: 0, width: totalWidth, height: 2,
          background: '#1e3a1e',
        }} />
        {trackStops.map((stop, i) => {
          const { size, bg, border, shadow, anim, left, top } = getDotStyle(stop, vehicleMap, i)
          return (
            <div key={stop.stop_id} title={stop.name} style={{
              position: 'absolute', left, top,
              width: size, height: size, borderRadius: '50%',
              background: bg, border, boxShadow: shadow, animation: anim,
              zIndex: 2,
            }} />
          )
        })}
      </div>
    )
  }

  function renderLabels(trackStops: Stop[]) {
    // Alternating two rows: even-index at top (y=0), odd-index at bottom (y=14)
    return (
      <div style={{ position: 'relative', height: 28, width: totalWidth }}>
        {trackStops.map((stop, i) => {
          // Strip after first dash or en-dash to shorten "Times Sq-42 St" → "Times Sq"
          const raw = stop.name.replace(/[-–].+$/, '').trim()
          const label = raw.length > 10 ? raw.slice(0, 9) + '…' : raw
          const centerX = i * (SLOT + CONN) + SLOT / 2
          const top = i % 2 === 0 ? 0 : 14
          return (
            <div key={stop.stop_id} style={{
              position: 'absolute',
              left: centerX,
              top,
              transform: 'translateX(-50%)',
              fontSize: 8,
              color: myBase && stop.stop_id.replace(/[NS]$/, '') === myBase
                ? 'var(--amber)'
                : 'var(--text-faint)',
              whiteSpace: 'nowrap',
              letterSpacing: '0.01em',
            }}>
              {label}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 12, overflowX: 'auto' }}>
      <div style={{ width: totalWidth, padding: '0 4px 4px' }}>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', marginBottom: 4 }}>
          ↑ UPTOWN
        </div>
        {renderTrack(uptownStops, uptownMap)}
        {renderLabels(uptownStops)}
        {renderTrack(downtownStops, downtownMap)}
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', marginTop: 4 }}>
          ↓ DOWNTOWN
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build check**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 3: Visual check**

Start (or verify running) backend:
```bash
# From subway-intel/
uvicorn backend.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000`, go to NETWORK PULSE, expand any line group.
Expected:
- Two tracks: ↑ UPTOWN on top, ↓ DOWNTOWN below
- Green glowing dots for trains (larger than stop dots)
- Stop labels between tracks, alternating top/bottom rows
- Horizontal scroll if the line has many stops

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TrackDiagram.tsx
git commit -m "feat: track diagram shows both directions simultaneously with slot layout"
```
