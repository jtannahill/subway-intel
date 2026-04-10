# UI/UX Enhancement — Ops Dashboard

**Date:** 2026-04-10  
**Status:** Approved

## Overview

Restructure the subway-intel frontend from a sidebar-nav layout to an ops-dashboard layout: horizontal top-bar navigation, a persistent live line-status ticker, a 2-column grid main area, and pulse-glow animations on live data updates.

## Layout Shell

### TopBar (`src/components/TopBar.tsx`)
- Fixed 48px bar, `background: #111`, `border-bottom: 1px solid var(--border-dim)`
- Left: `SUBWAY-INTEL` wordmark in green monospace
- Center: 3 nav tabs — **MY STATIONS · NETWORK PULSE · DELAY INTEL**
  - Active tab: `background: #1a1a1a`, `border: 1px solid var(--border)`, `color: var(--text-primary)`
  - Inactive tab: `color: var(--text-faint)`, no border
- Right: LIVE pill — green dot + elapsed time since last WebSocket update

### Ticker (`src/components/Ticker.tsx`)
- 34px strip, `background: #0a0a0a`, `border-bottom: 1px solid var(--border-dim)`
- Left edge: "LINES" label in faint text, right-bordered
- Content: scrolling loop of all lines — each item is a `LineBadge` + status text
  - Status text: `OK` (green) · `+Nm` (amber) · `DLY` (red)
  - Derived from `liveData.lineHealth`
  - CSS `animation: scroll linear infinite` — duplicate items for seamless loop
- On WebSocket update: status text briefly flashes green (`pulse-glow` class, 1.2s, then removed)

### App Shell (`src/App.tsx`)
- Remove sidebar flex layout
- New structure: `TopBar` → `Ticker` → `<main>` (flex: 1, overflow: auto, padding: 20px)
- `Sidebar.tsx` deleted
- Nav state: `View = 'stations' | 'pulse' | 'intel'` (3 tabs, Smart Commute removed as separate view)

## Per-View Grid Layout

Main area uses `display: grid; grid-template-columns: 1fr 1fr; gap: 16px` as the default. Views control their own panel placement.

### My Stations (`src/views/MyStations.tsx`)
- **Left column:** station arrival cards list (scrollable, existing `ArrivalCard` components)
- **Right column:** Smart Commute panel (inlined — `MyStations` imports and renders `<SmartCommute>` directly in the right column; `App.tsx` no longer renders `SmartCommute` separately)
- Smart Commute search + departure cards live permanently in the right column
- `MyStations` receives both `liveData` and `stationsCtx` props as before; also receives `stationsCtx` to pass to the inlined `SmartCommute`

### Network Pulse (`src/views/NetworkPulse.tsx`)
- **Left column:** summary stat cards (NOMINAL / DELAYED / DISRUPTED counts) + worst-offender chips (lines currently delayed/disrupted with avg delay)
- **Right column:** expandable line-group cards (existing accordion behavior retained)

### Delay Intel (`src/views/DelayIntel.tsx`)
- **Full width** (`grid-column: 1 / -1`) — the data table needs horizontal space
- No structural change to table content

## Pulse Glow Animation

### CSS (added to `src/index.css`)
```css
@keyframes pulse-glow {
  0%   { box-shadow: 0 0 0 0 #22c55e44; border-color: var(--green); }
  50%  { box-shadow: 0 0 12px 4px #22c55e44; border-color: var(--green); }
  100% { box-shadow: 0 0 0 0 #22c55e00; border-color: var(--green-border); }
}
.pulse { animation: pulse-glow 1.2s ease-out; }
```

### ArrivalCard (`src/components/ArrivalCard.tsx`)
- Accept `lastUpdate: Date | null` prop
- `useEffect` watching `lastUpdate`: when it changes, add class `pulse` to each countdown tile ref, remove after 1200ms via `setTimeout`
- Delayed tiles use amber variant: `border-color: var(--amber)` at peak

### Ticker
- Same `pulse` class applied to each `ticker-item` on WebSocket message, staggered by 50ms per item so they ripple left-to-right

## Files Changed

| File | Action |
|------|--------|
| `src/App.tsx` | Rewrite layout shell, remove sidebar, 3-tab nav |
| `src/components/Sidebar.tsx` | Delete |
| `src/components/TopBar.tsx` | New — wordmark + tabs + LIVE pill |
| `src/components/Ticker.tsx` | New — scrolling line-status strip |
| `src/views/MyStations.tsx` | Add 2-col grid, inline SmartCommute in right column |
| `src/views/NetworkPulse.tsx` | Split into left (summary) + right (line groups) |
| `src/views/DelayIntel.tsx` | Add `grid-column: 1 / -1`, minor layout cleanup |
| `src/views/SmartCommute.tsx` | No structural change — rendered as panel inside MyStations |
| `src/components/ArrivalCard.tsx` | Add `lastUpdate` prop + pulse glow useEffect |
| `src/index.css` | Add `pulse-glow` keyframe + `.pulse` class, remove `--sidebar-width` |

## Non-Goals

- Mobile responsiveness (out of scope)
- Font change (keeping JetBrains Mono)
- Backend changes (zero)
