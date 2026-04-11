import { useState, useMemo } from 'react'
import { useNow } from '../hooks/useNow'
import type { LiveData, ArrivalEntry } from '../hooks/useLiveData'
import type { NearbyStatus } from '../hooks/useNearby'
import { LineBadge } from '../components/LineBadge'
import { TrackDiagram } from '../components/TrackDiagram'

interface Props {
  liveData: LiveData
  corrections: Record<string, number>
  nearby: { state: NearbyStatus; start: () => void }
}

export function NearbyView({ liveData, corrections, nearby }: Props) {
  const { state, start } = nearby
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)

  // ── tracking-state derived values ──────────────────────────────────────────
  const station = state.status === 'tracking' ? state.station : null

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

  // ── idle ───────────────────────────────────────────────────────────────────
  if (state.status === 'idle') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>NEARBY</span>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          Uses your device location to find the closest station.
        </p>
        <button onClick={start} style={{
          all: 'unset', cursor: 'pointer', padding: '14px 28px',
          fontSize: 11, letterSpacing: '0.08em', borderRadius: 3,
          background: 'var(--green-dim)', border: '1px solid var(--green-border)',
          color: 'var(--green)', WebkitTapHighlightColor: 'transparent',
        }}>
          ⊕ ENABLE LOCATION
        </button>
      </div>
    )
  }

  // ── locating ───────────────────────────────────────────────────────────────
  if (state.status === 'locating') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20 }}>
        <span className="dot dot-green" style={{ animation: 'pulse-glow 1s ease-in-out infinite' }} />
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--green)' }}>LOCATING...</span>
      </div>
    )
  }

  // ── error ──────────────────────────────────────────────────────────────────
  if (state.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--red)' }}>LOCATION UNAVAILABLE</span>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>{state.message}</p>
        <button onClick={start} style={{
          all: 'unset', cursor: 'pointer', padding: '12px 20px',
          fontSize: 10, letterSpacing: '0.07em', borderRadius: 3,
          WebkitTapHighlightColor: 'transparent',
          background: '#1a1a1a', border: '1px solid var(--border)',
          color: 'var(--text-primary)', alignSelf: 'flex-start',
        }}>
          RE-TRY
        </button>
      </div>
    )
  }

  // ── tracking ───────────────────────────────────────────────────────────────
  const { station: trackedStation } = state

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>📍 {trackedStation.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{trackedStation.distance_mi.toFixed(1)} mi</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="dot dot-green" style={{ animation: 'pulse-glow 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--green)' }}>TRACKING</span>
        </span>
      </div>

      {/* NEXT ARRIVALS */}
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
            {sortedRoutes.map(([routeId, { msUntil }], i) => (
              <div key={routeId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: i === 0 ? 1 : 0.45 }}>
                <LineBadge routeId={routeId} size={16} />
                <span style={{ fontSize: 18, fontWeight: 700, color: i === 0 ? 'var(--green)' : 'var(--text-muted)', lineHeight: 1, letterSpacing: '-0.02em' }}>
                  {formatMs(msUntil)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Line selector pills */}
      {routeIds.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {routeIds.map(rid => (
            <button key={rid} onClick={() => setSelectedRoute(rid)}
              style={{ all: 'unset', cursor: 'pointer', borderRadius: '50%', outline: activeRoute === rid ? '2px solid var(--green)' : '2px solid transparent', outlineOffset: 2, WebkitTapHighlightColor: 'transparent' }}>
              <LineBadge routeId={rid} size={20} />
            </button>
          ))}
        </div>
      )}

      {/* TrackDiagram anchored to user's station */}
      {activeRoute && (
        <TrackDiagram
          routeId={activeRoute}
          vehiclePositions={liveData.vehiclePositions}
          lineHealth={liveData.lineHealth}
          myStopId={trackedStation.stop_id}
        />
      )}
    </div>
  )
}
