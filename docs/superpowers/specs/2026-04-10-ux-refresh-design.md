# UX Refresh Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Goal

Improve three areas of the subway-intel dashboard: mobile responsiveness, Smart Commute usability, and Track Diagram readability. No new data sources or backend changes required.

---

## 1. Mobile Responsive Layout

### Approach
Single CSS breakpoint at `768px`. The overall tab structure (MY STATIONS / NETWORK PULSE / DELAY INTEL) stays unchanged. All 2-column grid layouts collapse to single-column below 768px.

### Breakpoints to apply
- **App shell** (`App.tsx`): the `gridTemplateColumns: '1fr 1fr'` main grid → single column on mobile
- **MyStations** (`MyStations.tsx`): left station list + right SmartCommute 2-col → stacked on mobile
- **NetworkPulse** (`NetworkPulse.tsx`): left summary + right line groups 2-col → stacked on mobile
- **DelayIntel** (`DelayIntel.tsx`): existing grid → review and tighten for mobile

### Touch targets
All interactive elements (buttons, accordion toggles, sort buttons) must be minimum 44px tall on mobile.

### TopBar
TopBar tabs stay as text on all screen sizes. On screens below 400px, shorten tab labels to icons or abbreviations if they overflow — otherwise leave as-is.

### Implementation
Use a `useMediaQuery('(max-width: 768px)')` hook (inline, ~10 lines) rather than adding a CSS framework. Inject responsive `gridTemplateColumns` via inline style. No CSS file changes required.

---

## 2. Smart Commute Redesign

### Current problems
- FROM/TO inputs have no clear visual separation or labels
- Results (travel time, transfers) are hard to read at a glance
- No indication of whether the route is currently delayed

### Layout
Full-width on mobile. On desktop, keeps its position as the right panel in MyStations.

### FROM / TO inputs
Two `StationSearchInput` components (already implemented) stacked vertically with clear "FROM" and "TO" labels above each. A `→` separator between them. Minimum 44px tap target on each input.

### Results card
When a route is calculated, display a result card with:
- **Line badges** for each line involved in the route (using `<LineBadge>`)
- **Travel time** in large text (e.g. `14 min`)
- **Transfers** count (e.g. `1 transfer` or `Direct`)
- **Live status strip**: for each line in the route, pull its entry from `lineHealth` and show a colored status pill (NOMINAL / DELAYED / DISRUPTED) + alert count if > 0

### Live status derivation
No new API call. The `lineHealth` array is already passed down via `liveData`. Filter by the line IDs in the computed route, show the worst status. If any line is DELAYED or DISRUPTED, show a warning banner: `⚠ Route affected — check alerts`.

### No-route state
If no path exists between the selected stations, show: `No direct route found. Try nearby stations.`

---

## 3. Track Diagram Redesign

### Current problems
- Single-direction view with a toggle — users miss trains going the other way
- Train dots look similar to stop dots
- Labels hard to scan (too many, too small)
- No visual anchor for the user's saved station

### Both directions simultaneously
Replace the direction toggle with two stacked horizontal tracks:
- `↑ UPTOWN` (direction 1) on top
- `↓ DOWNTOWN` (direction 0) below

Both tracks share the same stop sequence (from `get_route_stops` — use direction 1's stop list, reversed for direction 0). Both tracks scroll together in the same horizontal scroll container.

Each track is a single `<div>` with dots and a connecting line, labeled once (stop names shown below the UPTOWN track only — not duplicated on the DOWNTOWN track).

### Train dot vs stop dot distinction
- **Stop dot**: 8×8px circle, `background: #1a1a1a`, `border: 1px solid #333`
- **Train dot**: 14×14px circle, `background: var(--green)`, `box-shadow: 0 0 8px var(--green)` (pulse-glow animation)
- **Stopped train**: solid green, no pulse
- **In-transit train**: pulse-glow animation (existing keyframe)
- **Delayed stop**: amber glow (existing logic)

### Stop labels
Labels shown below the UPTOWN track (between the two tracks). Alternate above/below every other stop to reduce overlap:
- Even-index stops: label rendered above the stop dot row
- Odd-index stops: label rendered below the stop dot row (i.e., above the DOWNTOWN track)

Truncate labels longer than 12 characters with `…`. Font size 9px. Show all labels regardless of stop count (the horizontal scroll handles overflow).

### Anchor stop
Add optional prop `myStopId?: string` to `TrackDiagram`. When provided, the stop dot for that station on both tracks is rendered as:
- 10×10px circle, `background: var(--amber)`, `border: 2px solid var(--amber)`
- Label in amber text

In **NetworkPulse** accordion: `myStopId` not passed (undefined).
In **MyStations**: `myStopId={station.stop_id}` — the station whose arrivals card is being shown. MyStations currently doesn't show a TrackDiagram; this spec does not add one. The anchor prop is designed for future use and wired now so it's ready.

> **Note:** TrackDiagram is currently only shown in the NetworkPulse accordion, which passes no `myStopId`. The amber-dot rendering logic IS implemented inside `TrackDiagram` (so the prop works when provided), but no caller passes it in this release. Sub-project B may wire it.

### Scroll behavior
Wrap both tracks in a single `overflow-x: auto` container. On mobile, the container is full-width and touch-scrollable.

---

## 4. Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/useMediaQuery.ts` | New — small hook, `matchMedia` wrapper |
| `frontend/src/App.tsx` | Responsive grid using `useMediaQuery` |
| `frontend/src/views/MyStations.tsx` | Responsive 2-col → 1-col |
| `frontend/src/views/NetworkPulse.tsx` | Responsive 2-col → 1-col |
| `frontend/src/views/DelayIntel.tsx` | Touch target + mobile tightening |
| `frontend/src/views/SmartCommute.tsx` | Full redesign: labels, result card, live status |
| `frontend/src/components/TrackDiagram.tsx` | Both directions, visual distinction, anchor prop, alternating labels |

---

## 5. Out of Scope

- Sub-project B (Location-Aware Station) — separate spec
- TopBar redesign
- New backend endpoints
- Any changes to data fetching or WebSocket protocol
