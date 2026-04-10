# UI Ops Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the subway-intel frontend into an ops-dashboard layout: horizontal top-bar nav, scrolling live line-status ticker, 2-column grid main area, and pulse-glow animations on live data updates.

**Architecture:** Replace the sidebar with a `TopBar` component (tabs + LIVE pill) and a `Ticker` component (scrolling line strip). `App.tsx` becomes a shell of TopBar → Ticker → main grid. Each view arranges its own 2-column panels; Smart Commute is inlined as the right column of My Stations and removed as a standalone tab.

**Tech Stack:** React 19, TypeScript, Vite, plain CSS custom properties (no new dependencies)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.css` | Modify | Add `pulse-glow` keyframe + `.pulse` class; remove `--sidebar-width` |
| `src/components/TopBar.tsx` | Create | Wordmark + 3 nav tabs + LIVE elapsed pill |
| `src/components/Ticker.tsx` | Create | Scrolling line-status strip; pulse on WS update |
| `src/components/Sidebar.tsx` | Delete | Replaced by TopBar |
| `src/components/ArrivalCard.tsx` | Modify | Accept `lastUpdate` prop; pulse countdown tiles on update |
| `src/App.tsx` | Modify | New layout shell: TopBar + Ticker + main; 3-tab nav |
| `src/views/MyStations.tsx` | Modify | 2-col grid; inline `<SmartCommute>` in right column |
| `src/views/NetworkPulse.tsx` | Modify | Left: summary + offenders; Right: expandable line groups |
| `src/views/DelayIntel.tsx` | Modify | Wrap in `grid-column: 1 / -1` full-width div |
| `src/views/SmartCommute.tsx` | No change | Already correct; just rendered inside MyStations now |

---

## Task 1: CSS Foundation

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add pulse-glow keyframe and utility class**

Open `src/index.css`. Add the following at the bottom of the file:

```css
/* Live update pulse */
@keyframes pulse-glow {
  0%   { box-shadow: 0 0 0 0 #22c55e44; border-color: var(--green); }
  50%  { box-shadow: 0 0 12px 4px #22c55e44; border-color: var(--green); }
  100% { box-shadow: 0 0 0 0 #22c55e00; border-color: var(--green-border); }
}
.pulse { animation: pulse-glow 1.2s ease-out forwards; }

@keyframes pulse-glow-amber {
  0%   { box-shadow: 0 0 0 0 #f59e0b44; border-color: var(--amber); }
  50%  { box-shadow: 0 0 12px 4px #f59e0b44; border-color: var(--amber); }
  100% { box-shadow: 0 0 0 0 #f59e0b00; border-color: var(--amber-border); }
}
.pulse-amber { animation: pulse-glow-amber 1.2s ease-out forwards; }
```

- [ ] **Step 2: Remove `--sidebar-width` custom property**

In `src/index.css`, remove the line:
```css
  --sidebar-width: 180px;
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/index.css
git commit -m "style: add pulse-glow keyframes, remove sidebar-width var"
```

---

## Task 2: TopBar Component

**Files:**
- Create: `frontend/src/components/TopBar.tsx`
- Modify: `frontend/src/App.tsx` (View type only — full App rewrite comes in Task 5)

- [ ] **Step 1: Create `TopBar.tsx`**

```tsx
import { useState, useEffect } from 'react'
import type { LiveData } from '../hooks/useLiveData'

type View = 'stations' | 'pulse' | 'intel'

interface Props {
  active: View
  onNav: (v: View) => void
  liveData: LiveData
}

const NAV: { id: View; label: string }[] = [
  { id: 'stations', label: 'MY STATIONS' },
  { id: 'pulse',    label: 'NETWORK PULSE' },
  { id: 'intel',    label: 'DELAY INTEL' },
]

export function TopBar({ active, onNav, liveData }: Props) {
  const [elapsedSec, setElapsedSec] = useState(0)

  useEffect(() => {
    if (!liveData.lastUpdate) return
    const tick = () =>
      setElapsedSec(Math.round((Date.now() - liveData.lastUpdate!.getTime()) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [liveData.lastUpdate])

  return (
    <div style={{
      height: 48,
      background: '#111',
      borderBottom: '1px solid var(--border-dim)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      gap: 24,
      flexShrink: 0,
      zIndex: 10,
    }}>
      {/* Wordmark */}
      <span style={{ fontSize: 12, letterSpacing: '0.14em', color: 'var(--green)', fontWeight: 700 }}>
        SUBWAY-INTEL
      </span>

      {/* Nav tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {NAV.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onNav(id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '6px 14px',
              fontSize: 10,
              letterSpacing: '0.07em',
              borderRadius: 3,
              color: active === id ? 'var(--text-primary)' : 'var(--text-faint)',
              background: active === id ? '#1a1a1a' : 'transparent',
              border: active === id ? '1px solid var(--border)' : '1px solid transparent',
              transition: 'color 0.1s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* LIVE pill */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className={`dot ${liveData.connected ? 'dot-green' : 'dot-dim'}`} />
        <span style={{ color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.05em' }}>
          {liveData.connected
            ? `LIVE · ${elapsedSec}s ago`
            : 'CONNECTING'}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors. (TopBar isn't wired in yet — that's Task 5.)

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/components/TopBar.tsx
git commit -m "feat: add TopBar component with 3-tab nav and LIVE pill"
```

---

## Task 3: Ticker Component

**Files:**
- Create: `frontend/src/components/Ticker.tsx`

- [ ] **Step 1: Create `Ticker.tsx`**

The ticker renders every line from `liveData.lineHealth`, duplicated for a seamless CSS scroll loop. On each `liveData.lastUpdate` change it briefly adds `.pulse` to all items.

```tsx
import { useEffect, useRef } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { getLineColor, getLineTextColor } from '../constants/mta-colors'

// Lines to show in ticker order (skipping less common shuttle variants)
const TICKER_LINES = ['1','2','3','4','5','6','7','A','C','E','B','D','F','M','G','J','Z','L','N','Q','R','W','SIR']

function statusText(h: LineHealthEntry | undefined): string {
  if (!h) return 'OK'
  if (h.status === 'DISRUPTED') return 'DLY'
  if (h.status === 'DELAYED') return `+${Math.round(h.avg_delay_sec / 60)}m`
  return 'OK'
}

function statusColor(h: LineHealthEntry | undefined): string {
  if (!h) return 'var(--green)'
  if (h.status === 'DISRUPTED') return 'var(--red)'
  if (h.status === 'DELAYED') return 'var(--amber)'
  return 'var(--green)'
}

interface Props { liveData: LiveData }

export function Ticker({ liveData }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!liveData.lastUpdate || !containerRef.current) return
    const items = containerRef.current.querySelectorAll<HTMLElement>('.ticker-item')
    items.forEach((el, i) => {
      setTimeout(() => {
        el.classList.remove('pulse')
        void el.offsetWidth // reflow to restart animation
        el.classList.add('pulse')
      }, i * 30)
    })
  }, [liveData.lastUpdate])

  const healthMap = Object.fromEntries(liveData.lineHealth.map(h => [h.route_id, h]))

  // Build items once, duplicate for seamless loop
  const items = TICKER_LINES.map(routeId => {
    const h = healthMap[routeId]
    return (
      <div
        key={routeId}
        className="ticker-item"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 14px',
          borderRight: '1px solid var(--border-dim)',
          height: '100%',
          flexShrink: 0,
        }}
      >
        <span style={{
          width: 18,
          height: 18,
          background: getLineColor(routeId),
          color: getLineTextColor(routeId),
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          fontWeight: 700,
          flexShrink: 0,
          fontFamily: 'sans-serif',
        }}>
          {routeId === 'SIR' ? 'SI' : routeId}
        </span>
        <span style={{ fontSize: 9, letterSpacing: '0.05em', color: statusColor(h) }}>
          {statusText(h)}
        </span>
      </div>
    )
  })

  return (
    <div style={{
      height: 34,
      background: '#0a0a0a',
      borderBottom: '1px solid var(--border-dim)',
      display: 'flex',
      alignItems: 'center',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Static label */}
      <div style={{
        padding: '0 12px',
        fontSize: 9,
        letterSpacing: '0.1em',
        color: 'var(--text-faint)',
        borderRight: '1px solid var(--border-dim)',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        LINES
      </div>

      {/* Scrolling strip */}
      <div style={{ flex: 1, overflow: 'hidden', height: '100%' }}>
        <div
          ref={containerRef}
          style={{
            display: 'flex',
            height: '100%',
            animation: 'ticker-scroll 28s linear infinite',
          }}
        >
          {items}
          {/* Duplicate for seamless loop */}
          {items}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add ticker-scroll keyframe to `index.css`**

Append to `src/index.css`:

```css
/* Ticker scroll */
@keyframes ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/components/Ticker.tsx frontend/src/index.css
git commit -m "feat: add Ticker component with scrolling line-status strip"
```

---

## Task 4: ArrivalCard Pulse Glow

**Files:**
- Modify: `frontend/src/components/ArrivalCard.tsx`

- [ ] **Step 1: Add `lastUpdate` prop and pulse effect**

Replace the full contents of `src/components/ArrivalCard.tsx` with:

```tsx
import { useEffect, useRef } from 'react'
import type { ArrivalEntry } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'
import { LineBadge } from './LineBadge'
import { DelayBadge } from './DelayBadge'
import { directionLabel } from '../constants/stops'

interface Props {
  station: SavedStation
  arrivals: ArrivalEntry[]
  onRemove: () => void
  lastUpdate: Date | null
}

function minutesUntil(isoTime: string): number {
  return Math.max(0, Math.round((new Date(isoTime).getTime() - Date.now()) / 60000))
}

export function ArrivalCard({ station, arrivals, onRemove, lastUpdate }: Props) {
  const tilesRef = useRef<(HTMLDivElement | null)[]>([])
  const firstDelay = arrivals[0]?.delay_sec ?? 0
  const hasDelay = firstDelay > 30
  const isDisrupted = firstDelay > 300

  useEffect(() => {
    if (!lastUpdate) return
    tilesRef.current.forEach(el => {
      if (!el) return
      el.classList.remove('pulse', 'pulse-amber')
      void el.offsetWidth // reflow
      el.classList.add(hasDelay ? 'pulse-amber' : 'pulse')
    })
  }, [lastUpdate, hasDelay])

  return (
    <div className={`card ${hasDelay ? (isDisrupted ? 'card-disrupted' : 'card-delayed') : ''}`}
         style={{ marginBottom: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {station.route_ids.map(r => <LineBadge key={r} routeId={r} />)}
        </div>
        <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {station.name.toUpperCase()}
        </span>
        {hasDelay && <DelayBadge delaySec={firstDelay} />}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
          {directionLabel(station.direction, station.route_ids[0]?.toUpperCase() ?? '')}
        </span>
        <button onClick={onRemove} style={{
          all: 'unset', cursor: 'pointer', color: 'var(--text-faint)',
          fontSize: 10, marginLeft: 8,
        }}>✕</button>
      </div>

      {/* Countdown tiles */}
      <div style={{ display: 'flex', gap: 8 }}>
        {arrivals.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>NO SERVICE DATA</div>
        ) : (
          arrivals.slice(0, 3).map((a, i) => {
            const mins = minutesUntil(a.arrival_time)
            const isNext = i === 0
            return (
              <div
                key={a.arrival_time}
                ref={el => { tilesRef.current[i] = el }}
                style={{
                  background: isNext ? (hasDelay ? 'var(--amber-dim)' : 'var(--green-dim)') : 'var(--bg)',
                  border: `1px solid ${isNext ? (hasDelay ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)'}`,
                  borderRadius: 3,
                  padding: '8px 14px',
                  textAlign: 'center',
                  minWidth: 52,
                }}
              >
                <div className="mono-lg" style={{
                  color: isNext ? (hasDelay ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)',
                }}>
                  {mins}
                </div>
                <div className="mono-sm">MIN</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: TypeScript error — `MyStations.tsx` passes `ArrivalCard` without `lastUpdate`. That's fine, it will be fixed in Task 6. For now just verify no other errors.

Actually — to keep the build green at each step, temporarily give `lastUpdate` a default value. Change the interface in the file you just wrote:

```tsx
interface Props {
  station: SavedStation
  arrivals: ArrivalEntry[]
  onRemove: () => void
  lastUpdate?: Date | null   // optional until MyStations is updated in Task 6
}
```

And guard the effect:
```tsx
  useEffect(() => {
    if (!lastUpdate) return
    // ... rest unchanged
  }, [lastUpdate, hasDelay])
```

Re-run:
```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/components/ArrivalCard.tsx
git commit -m "feat: ArrivalCard pulse-glow on live data update"
```

---

## Task 5: App Shell Rewrite

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Delete Sidebar**

```bash
rm /Users/jamest/subway-intel/frontend/src/components/Sidebar.tsx
```

- [ ] **Step 2: Rewrite `App.tsx`**

Replace full contents of `src/App.tsx`:

```tsx
import { useState } from 'react'
import { TopBar } from './components/TopBar'
import { Ticker } from './components/Ticker'
import { useLiveData } from './hooks/useLiveData'
import { useStations } from './hooks/useStations'
import { MyStations } from './views/MyStations'
import { NetworkPulse } from './views/NetworkPulse'
import { DelayIntel } from './views/DelayIntel'

type View = 'stations' | 'pulse' | 'intel'

export default function App() {
  const [activeView, setActiveView] = useState<View>('stations')
  const liveData = useLiveData()
  const stationsCtx = useStations()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar active={activeView} onNav={setActiveView} liveData={liveData} />
      <Ticker liveData={liveData} />
      <main style={{
        flex: 1,
        overflow: 'auto',
        padding: 20,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        alignContent: 'start',
      }}>
        {activeView === 'stations' && (
          <MyStations liveData={liveData} stationsCtx={stationsCtx} />
        )}
        {activeView === 'pulse' && (
          <NetworkPulse liveData={liveData} />
        )}
        {activeView === 'intel' && (
          <DelayIntel liveData={liveData} />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built`. (Views may render stacked for now — layout polish comes in Tasks 6–8.)

- [ ] **Step 4: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/App.tsx
git rm frontend/src/components/Sidebar.tsx
git commit -m "feat: replace sidebar with TopBar+Ticker ops dashboard shell"
```

---

## Task 6: MyStations — 2-Column Grid with Inlined SmartCommute

**Files:**
- Modify: `frontend/src/views/MyStations.tsx`

The left column is the station list; the right column is the SmartCommute panel. Both columns span the parent grid cell, not the full viewport — `App.tsx` provides the outer `1fr 1fr` grid, so each view child placed in `<main>` occupies one cell. To make MyStations span both columns and manage its own inner 2-col layout, it needs `gridColumn: '1 / -1'` on its wrapper, then its own inner grid.

- [ ] **Step 1: Rewrite `MyStations.tsx`**

Replace full contents:

```tsx
import { useState } from 'react'
import { ArrivalCard } from '../components/ArrivalCard'
import { SignalStrip } from '../components/SignalStrip'
import { SmartCommute } from './SmartCommute'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[]; addStation: (s: SavedStation) => void; removeStation: (id: string, dir: string) => void }
}

export function MyStations({ liveData, stationsCtx }: Props) {
  const { stations, addStation, removeStation } = stationsCtx
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<{ stop_id: string; name: string }[]>([])
  const [showSearch, setShowSearch] = useState(false)

  async function handleSearch(q: string) {
    setSearchQ(q)
    if (q.length < 2) { setSearchResults([]); return }
    const res = await fetch(`/api/stops/search?q=${encodeURIComponent(q)}&limit=8`)
    const data = await res.json()
    setSearchResults(data.results ?? [])
  }

  function addStop(stop: { stop_id: string; name: string }) {
    addStation({ stop_id: stop.stop_id + 'N', name: stop.name, direction: 'N', route_ids: [] })
    setShowSearch(false)
    setSearchQ('')
    setSearchResults([])
  }

  return (
    // Span both grid columns, then create inner 2-col layout
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
            <input
              autoFocus
              value={searchQ}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search stations..."
              style={{
                all: 'unset', display: 'block', width: '100%',
                background: 'var(--bg-surface)', border: '1px solid var(--green-border)',
                borderRadius: 3, padding: '8px 12px',
                color: 'var(--text-primary)', fontSize: 12, marginBottom: 4,
              }}
            />
            {searchResults.map(r => (
              <button key={r.stop_id} onClick={() => addStop(r)} style={{
                all: 'unset', display: 'block', width: '100%',
                padding: '8px 12px', cursor: 'pointer',
                color: 'var(--text-primary)', fontSize: 11,
                background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
              }}>
                {r.name} <span style={{ color: 'var(--text-faint)' }}>{r.stop_id}</span>
              </button>
            ))}
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

- [ ] **Step 2: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors.

- [ ] **Step 3: Smoke test in browser**

```bash
cd /Users/jamest/subway-intel && uvicorn backend.main:app --reload
```

Open `http://127.0.0.1:8000`. Verify:
- Top bar shows SUBWAY-INTEL wordmark, 3 tabs, LIVE pill
- Ticker strip scrolls below top bar
- MY STATIONS tab shows station list on left, SMART COMMUTE panel on right

- [ ] **Step 4: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/views/MyStations.tsx frontend/src/components/ArrivalCard.tsx
git commit -m "feat: MyStations 2-col grid with inlined SmartCommute; ArrivalCard lastUpdate prop required"
```

---

## Task 7: NetworkPulse — Split Layout

**Files:**
- Modify: `frontend/src/views/NetworkPulse.tsx`

Left column: summary stat counts + worst-offender chips. Right column: expandable line group accordion.

- [ ] **Step 1: Rewrite `NetworkPulse.tsx`**

Replace full contents:

```tsx
import { useState } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { LineBadge } from '../components/LineBadge'

interface Props { liveData: LiveData }

const STATUS_COLORS = {
  NOMINAL:   { text: 'var(--green)', bg: 'var(--green-dim)', border: 'var(--green-border)' },
  DELAYED:   { text: 'var(--amber)', bg: 'var(--amber-dim)', border: 'var(--amber-border)' },
  DISRUPTED: { text: 'var(--red)',   bg: 'var(--red-dim)',   border: 'var(--red-border)'   },
}

const LINE_GROUPS: { label: string; routes: string[] }[] = [
  { label: 'IRT LEXINGTON',  routes: ['4', '5', '6'] },
  { label: 'IRT BROADWAY',   routes: ['1', '2', '3'] },
  { label: 'IND EIGHTH AV',  routes: ['A', 'C', 'E'] },
  { label: 'IND SIXTH AV',   routes: ['B', 'D', 'F', 'M'] },
  { label: 'IND CROSSTOWN',  routes: ['G'] },
  { label: 'BMT NASSAU',     routes: ['J', 'Z'] },
  { label: 'IND FLUSHING',   routes: ['7'] },
  { label: 'BMT CANARSIE',   routes: ['L'] },
  { label: 'BMT BROADWAY',   routes: ['N', 'Q', 'R', 'W'] },
  { label: 'SIR',            routes: ['SIR'] },
]

function worstHealth(routes: string[], health: LineHealthEntry[]): LineHealthEntry | null {
  const entries = health.filter(h => routes.includes(h.route_id))
  if (entries.length === 0) return null
  const order = { DISRUPTED: 2, DELAYED: 1, NOMINAL: 0 }
  const sorted = [...entries].sort((a, b) => order[b.status] - order[a.status])
  const avg = entries.reduce((s, e) => s + e.avg_delay_sec, 0) / entries.length
  return { ...sorted[0], avg_delay_sec: avg }
}

export function NetworkPulse({ liveData }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggle = (label: string) => setExpanded(v => v === label ? null : label)

  const summary = {
    nominal:   liveData.lineHealth.filter(h => h.status === 'NOMINAL').length,
    delayed:   liveData.lineHealth.filter(h => h.status === 'DELAYED').length,
    disrupted: liveData.lineHealth.filter(h => h.status === 'DISRUPTED').length,
  }

  const offenders = liveData.lineHealth
    .filter(h => h.status !== 'NOMINAL')
    .sort((a, b) => b.avg_delay_sec - a.avg_delay_sec)
    .slice(0, 5)

  return (
    // Span both parent grid columns, manage own inner 2-col layout
    <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

      {/* LEFT: Summary + offenders */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>NETWORK PULSE</span>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {([
            { label: 'NOMINAL',   count: summary.nominal,   color: 'var(--green)' },
            { label: 'DELAYED',   count: summary.delayed,   color: 'var(--amber)' },
            { label: 'DISRUPTED', count: summary.disrupted, color: 'var(--red)'   },
          ] as const).map(({ label, count, color }) => (
            <div key={label} className="card" style={{ flex: 1, textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{count}</div>
              <div className="label" style={{ marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Worst offenders */}
        {offenders.length > 0 && (
          <>
            <div className="label" style={{ marginBottom: 10 }}>WORST OFFENDERS</div>
            {offenders.map(h => {
              const c = STATUS_COLORS[h.status]
              return (
                <div key={h.route_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', marginBottom: 6,
                  background: c.bg, border: `1px solid ${c.border}`, borderRadius: 3,
                }}>
                  <LineBadge routeId={h.route_id} size={20} />
                  <span style={{ color: c.text, fontSize: 10, letterSpacing: '0.06em' }}>{h.status}</span>
                  {h.avg_delay_sec > 30 && (
                    <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
                      +{Math.round(h.avg_delay_sec / 60)}m avg
                    </span>
                  )}
                  {h.alerts.length > 0 && (
                    <span style={{ color: 'var(--amber)', fontSize: 9, letterSpacing: '0.05em' }}>
                      {h.alerts.length} ALERT{h.alerts.length > 1 ? 'S' : ''}
                    </span>
                  )}
                </div>
              )
            })}
          </>
        )}

        {offenders.length === 0 && liveData.lineHealth.length > 0 && (
          <div style={{ color: 'var(--green)', fontSize: 11, marginTop: 8 }}>All lines nominal.</div>
        )}
      </div>

      {/* RIGHT: Line group accordion */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>LINE GROUPS</span>
        </div>
        {LINE_GROUPS.map(({ label, routes }) => {
          const h = worstHealth(routes, liveData.lineHealth)
          const status = h?.status ?? 'NOMINAL'
          const colors = STATUS_COLORS[status]
          const isExpanded = expanded === label

          return (
            <div key={label} style={{ marginBottom: 4 }}>
              <button onClick={() => toggle(label)} style={{
                all: 'unset', cursor: 'pointer', display: 'flex', width: '100%',
                alignItems: 'center', gap: 10,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: isExpanded ? '3px 3px 0 0' : 3, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {routes.map(r => <LineBadge key={r} routeId={r} size={16} />)}
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.06em' }}>{label}</span>
                <div style={{
                  marginLeft: 'auto', background: colors.bg,
                  border: `1px solid ${colors.border}`, borderRadius: 2,
                  padding: '2px 7px', fontSize: 9, color: colors.text,
                }}>
                  {status}
                </div>
                <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>{isExpanded ? '▲' : '▼'}</span>
              </button>

              {isExpanded && h && (
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none',
                  borderRadius: '0 0 3px 3px', padding: 12,
                }}>
                  {h.alerts.length === 0
                    ? <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No active alerts.</div>
                    : h.alerts.map((a, i) => (
                        <div key={i} style={{ color: 'var(--amber)', fontSize: 11, marginBottom: 4 }}>⚠ {a}</div>
                      ))
                  }
                  <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 8 }}>
                    Avg delay: {Math.round(h.avg_delay_sec)}s · HW variance: {Math.round(h.headway_variance)}s
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/views/NetworkPulse.tsx
git commit -m "feat: NetworkPulse 2-col layout — summary+offenders left, accordion right"
```

---

## Task 8: DelayIntel — Full Width

**Files:**
- Modify: `frontend/src/views/DelayIntel.tsx`

The table needs horizontal space so it spans both parent grid columns via `gridColumn: '1 / -1'`.

- [ ] **Step 1: Wrap DelayIntel content in a full-width div**

In `src/views/DelayIntel.tsx`, change the outermost `<div>` from:

```tsx
    <div>
```

to:

```tsx
    <div style={{ gridColumn: '1 / -1' }}>
```

(This is the very first `<div>` returned by `DelayIntel`, at line 34 in the current file.)

- [ ] **Step 2: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/views/DelayIntel.tsx
git commit -m "feat: DelayIntel spans full grid width"
```

---

## Task 9: Final Build, Smoke Test, and Cleanup

**Files:**
- No new file changes — verification and commit only

- [ ] **Step 1: Production build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: `✓ built` with no errors or TypeScript complaints.

- [ ] **Step 2: Start backend and open app**

```bash
cd /Users/jamest/subway-intel && uvicorn backend.main:app --reload
```

Open `http://127.0.0.1:8000` and verify:

| Check | Expected |
|-------|----------|
| Top bar | SUBWAY-INTEL wordmark, 3 tabs (MY STATIONS / NETWORK PULSE / DELAY INTEL), LIVE pill with elapsed time |
| Ticker | All MTA lines scrolling left with OK/+Nm/DLY status |
| MY STATIONS tab | Left: station cards; Right: SMART COMMUTE search + departure cards |
| NETWORK PULSE tab | Left: stat counts + offender chips; Right: line group accordion |
| DELAY INTEL tab | Full-width table spanning both columns |
| Pulse glow | Wait for WS update (≤30s) — arrival tiles briefly glow green/amber |
| Ticker pulse | On WS update, ticker items ripple with green glow |

- [ ] **Step 3: Commit final build artifact note**

```bash
cd /Users/jamest/subway-intel
git add frontend/src
git commit -m "feat: ops dashboard UI complete — ticker, TopBar, 2-col grid, pulse glow" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- ✅ TopBar with wordmark + 3 tabs + LIVE pill → Task 2
- ✅ Ticker scrolling line-status strip → Task 3
- ✅ Pulse glow on live update → Tasks 1, 3, 4
- ✅ App shell rewrite, Sidebar deleted → Task 5
- ✅ MyStations 2-col + SmartCommute inlined → Task 6
- ✅ NetworkPulse split layout → Task 7
- ✅ DelayIntel full-width → Task 8
- ✅ Smart Commute tab removed (3-tab nav in TopBar + App) → Tasks 2, 5

**Type consistency:**
- `View = 'stations' | 'pulse' | 'intel'` defined in both `TopBar.tsx` and `App.tsx` — consistent
- `lastUpdate: Date | null` in `ArrivalCard` matches `LiveData.lastUpdate: Date | null` — consistent
- `worstHealth()` in NetworkPulse replaces `healthForRoutes()` — renamed inline, not referenced elsewhere
- `pulse` / `pulse-amber` CSS classes used in ArrivalCard and Ticker — both defined in Task 1

**No placeholders:** All steps have complete code. ✅
