import { useState, useMemo, useCallback } from 'react'
import { useNow } from '../hooks/useNow'
import type { LiveData, ArrivalEntry, LineHealthEntry } from '../hooks/useLiveData'
import type { NearbyStatus } from '../hooks/useNearby'
import { LineBadge } from '../components/LineBadge'
import { TrackDiagram } from '../components/TrackDiagram'
import { StationSearchInput } from '../components/StationSearchInput'

interface Props {
  liveData: LiveData
  corrections: Record<string, number>
  nearby: { state: NearbyStatus; start: () => void; select: (stop_id: string, name: string) => void; reset: () => void }
}

/** Returns true when a route's current headway is >1.8× scheduled — trains are bunching. */
function isCrowded(routeId: string, lineHealth: LineHealthEntry[]): boolean {
  const h = lineHealth.find(e => e.route_id === routeId)
  if (!h || h.current_headway_sec == null || h.scheduled_headway_sec == null) return false
  return h.current_headway_sec > 1.8 * h.scheduled_headway_sec
}

/** Read walk minutes from localStorage, default 5. */
function getWalkMin(baseStopId: string): number {
  const raw = localStorage.getItem(`subway_intel_walk_min_${baseStopId}`)
  const n = parseInt(raw ?? '', 10)
  return isNaN(n) ? 5 : n
}

export function NearbyView({ liveData, corrections, nearby }: Props) {
  const { state, start, select, reset } = nearby
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)
  const [selectedStationIdx, setSelectedStationIdx] = useState(0)
  const [editingWalk, setEditingWalk] = useState(false)
  const [copied, setCopied] = useState(false)

  // ── tracking-state derived values ──────────────────────────────────────────
  const stations = state.status === 'tracking' ? state.stations : null
  const station = stations ? (stations[selectedStationIdx] ?? stations[0]) : null

  const handleShare = useCallback(() => {
    const baseStopId = station?.stop_id.replace(/[NS]$/, '') ?? ''
    const url = `https://mta.jamestannahill.com?near=${baseStopId}`
    if (navigator.share) {
      navigator.share({ title: 'Subway Intel', url }).catch(() => { /* user dismissed */ })
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => { /* clipboard denied */ })
    }
  }, [station])

  // Walk time for the selected station (localStorage-backed, default 5 min)
  const baseStopId = station?.stop_id ?? ''
  const [walkMin, setWalkMin] = useState<number>(() => getWalkMin(baseStopId))

  function handleWalkChange(val: number) {
    const clamped = Math.max(1, Math.min(20, val))
    setWalkMin(clamped)
    if (baseStopId) localStorage.setItem(`subway_intel_walk_min_${baseStopId}`, String(clamped))
  }

  // Merge N + S directional arrivals for this parent stop
  const stopArrivals: ArrivalEntry[] = station
    ? [
        ...(liveData.arrivals[station.stop_id + 'N'] ?? []),
        ...(liveData.arrivals[station.stop_id + 'S'] ?? []),
      ]
    : []

  // Group by route_id, take soonest per route, filter past trains
  const now = useNow()
  const routeMap = new Map<string, { msUntil: number; entry: ArrivalEntry }>()
  for (const entry of stopArrivals) {
    const correctionMs = (corrections[entry.route_id] ?? 0) * 1000
    const ms = new Date(entry.arrival_time).getTime() + correctionMs - now
    if (ms < 0) continue
    const existing = routeMap.get(entry.route_id)
    if (!existing || ms < existing.msUntil) {
      routeMap.set(entry.route_id, { msUntil: ms, entry })
    }
  }

  function formatMs(ms: number): string {
    if (ms <= 0) return 'NOW'
    const totalSec = Math.round(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    if (m === 0) return `:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const sortedRoutes = [...routeMap.entries()].sort((a, b) => a[1].msUntil - b[1].msUntil)

  const routeKey = [...routeMap.keys()].sort().join(',')
  const routeIds = useMemo(
    () =>
      routeMap.size > 0
        ? [...routeMap.entries()]
            .sort((a, b) => a[1].msUntil - b[1].msUntil)
            .map(([rid]) => rid)
        : liveData.lineHealth.map(h => h.route_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeKey, liveData.lineHealth],
  )

  const activeRoute =
    (selectedRoute !== null && routeIds.includes(selectedRoute))
      ? selectedRoute
      : (routeIds[0] ?? null)
  const noArrivals = sortedRoutes.length === 0

  // ── idle / error: show search + GPS button ─────────────────────────────────
  if (state.status === 'idle' || state.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 0' }}>
        {/* Station / address search */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-faint)', marginBottom: 8 }}>
            SEARCH STATION OR ADDRESS
          </div>
          <StationSearchInput
            placeholder="Times Square, 42 St, 350 5th Ave…"
            onSelect={(stop_id, name) => select(stop_id, name)}
          />
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-faint)' }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {/* GPS button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <button onClick={start} style={{
            all: 'unset', cursor: 'pointer', padding: '12px 28px',
            fontSize: 11, letterSpacing: '0.1em', borderRadius: 3,
            background: 'var(--green-dim)', border: '1px solid var(--green-border)',
            color: 'var(--green)', WebkitTapHighlightColor: 'transparent',
            fontWeight: 700,
          }}>
            ⊕ USE MY LOCATION
          </button>
          <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: 0, textAlign: 'center', letterSpacing: '0.05em' }}>
            YOUR LOCATION IS NOT STORED
          </p>
        </div>

        {/* Error message */}
        {state.status === 'error' && (
          <p style={{ fontSize: 12, color: 'var(--red)', margin: 0 }}>{state.message}</p>
        )}
      </div>
    )
  }

  // ── locating ───────────────────────────────────────────────────────────────
  if (state.status === 'locating') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dot dot-green" style={{ animation: 'pulse-glow 1s ease-in-out infinite' }} />
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--green)' }}>LOCATING…</span>
        </div>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-faint)', marginBottom: 8 }}>
            OR SEARCH A STATION
          </div>
          <StationSearchInput
            placeholder="Times Square, 42 St, 350 5th Ave…"
            onSelect={(stop_id, name) => select(stop_id, name)}
          />
        </div>
      </div>
    )
  }

  // ── tracking ───────────────────────────────────────────────────────────────
  const { stations: trackedStations, manual } = state

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4, minWidth: 0, width: '100%' }}>

      {/* Station selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>NEARBY STATIONS</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="dot dot-green" style={{ animation: manual ? 'none' : 'pulse-glow 1.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, letterSpacing: '0.08em', color: manual ? 'var(--text-faint)' : 'var(--green)' }}>
              {manual ? 'PINNED' : 'TRACKING'}
            </span>
          </span>
          <button onClick={reset} style={{
            all: 'unset', cursor: 'pointer', fontSize: 9, letterSpacing: '0.08em',
            color: 'var(--text-faint)', textDecoration: 'underline',
            WebkitTapHighlightColor: 'transparent',
          }}>change</button>
        </div>
        {trackedStations.map((s, i) => (
          <button key={s.stop_id} onClick={() => { setSelectedStationIdx(i); setSelectedRoute(null) }} style={{
            all: 'unset', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 3,
            background: i === selectedStationIdx ? 'var(--bg-surface)' : 'transparent',
            border: `1px solid ${i === selectedStationIdx ? 'var(--green-border)' : 'var(--border)'}`,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <span style={{ fontSize: 11, color: i === selectedStationIdx ? 'var(--text-primary)' : 'var(--text-muted)', letterSpacing: '0.02em', flex: 1 }}>
              {s.name}
            </span>
            {i === selectedStationIdx && (
              <button
                onClick={e => { e.stopPropagation(); handleShare() }}
                style={{
                  all: 'unset', cursor: 'pointer', flexShrink: 0,
                  fontSize: 9, letterSpacing: '0.1em', fontWeight: 700,
                  padding: '2px 6px', borderRadius: 2,
                  background: copied ? 'var(--green-dim)' : 'transparent',
                  border: `1px solid ${copied ? 'var(--green-border)' : 'var(--border)'}`,
                  color: copied ? 'var(--green)' : 'var(--text-faint)',
                  transition: 'color 0.1s, background 0.1s',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {copied ? 'COPIED' : 'SHARE'}
              </button>
            )}
            {s.route_ids.length > 0 && (
              <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {s.route_ids.map(rid => <LineBadge key={rid} routeId={rid} size={14} />)}
              </span>
            )}
            {!manual && s.distance_mi > 0 && (
              <span style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.05em', flexShrink: 0 }}>
                {s.distance_mi.toFixed(2)} mi · {Math.round(s.distance_mi * 20)} blks
              </span>
            )}
          </button>
        ))}
      </div>

      {/* NEXT ARRIVALS */}
      <div>
        {/* Header row: label + walk-time editor */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>NEXT ARRIVALS</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            {editingWalk ? (
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min={1}
                max={20}
                value={walkMin}
                autoFocus
                autoComplete="off"
                onChange={e => handleWalkChange(parseInt(e.target.value, 10) || 1)}
                onBlur={() => setEditingWalk(false)}
                style={{
                  width: 36, fontSize: 9, fontFamily: 'inherit', letterSpacing: '0.05em',
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 2,
                  color: 'var(--text-primary)', padding: '1px 4px', textAlign: 'center',
                }}
              />
            ) : (
              <button
                onClick={() => setEditingWalk(true)}
                style={{
                  all: 'unset', cursor: 'pointer', fontSize: 9, letterSpacing: '0.08em',
                  color: 'var(--text-faint)', WebkitTapHighlightColor: 'transparent',
                }}
              >
                WALK: {walkMin}m ✏
              </button>
            )}
          </span>
        </div>

        {noArrivals ? (
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
            No live arrivals — feed may not cover this station.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {sortedRoutes.map(([routeId, { msUntil }], i) => {
                const crowded = isCrowded(routeId, liveData.lineHealth)
                return (
                  <div key={routeId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: i === 0 ? 1 : 0.45 }}>
                    <LineBadge routeId={routeId} size={16} />
                    <span style={{ fontSize: 18, fontWeight: 700, color: i === 0 ? 'var(--green)' : 'var(--text-muted)', lineHeight: 1, letterSpacing: '-0.02em' }}>
                      {formatMs(msUntil)}
                    </span>
                    {crowded && (
                      <span style={{ fontSize: 8, letterSpacing: '0.08em', color: 'var(--amber)', lineHeight: 1 }}>
                        LIKELY CROWDED
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Departure timer — derived from the first upcoming arrival */}
            {sortedRoutes.length > 0 && (() => {
              const leaveInMs = sortedRoutes[0][1].msUntil - walkMin * 60_000
              return (
                <div style={{ fontSize: 8, letterSpacing: '0.08em', lineHeight: 1, color: leaveInMs <= 0 ? 'var(--amber)' : 'var(--green)' }}>
                  {leaveInMs <= 0
                    ? 'LEAVE NOW'
                    : `LEAVE IN ${Math.ceil(leaveInMs / 60_000)}m`}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Line selector pills */}
      {routeIds.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {routeIds.map(rid => (
            <button key={rid} onClick={() => setSelectedRoute(rid)}
              style={{ all: 'unset', cursor: 'pointer', outline: activeRoute === rid ? '2px solid var(--green)' : '2px solid transparent', outlineOffset: 3, borderRadius: 4, WebkitTapHighlightColor: 'transparent' }}>
              <LineBadge routeId={rid} size={20} />
            </button>
          ))}
        </div>
      )}

      {/* TrackDiagram anchored to user's station */}
      {activeRoute && station && (
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
