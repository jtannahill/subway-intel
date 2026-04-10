import { useState, useEffect, useRef } from 'react'
import type { VehiclePositionEntry, LineHealthEntry } from '../hooks/useLiveData'

interface Stop {
  stop_id: string
  name: string
}

interface Props {
  routeId: string
  vehiclePositions: VehiclePositionEntry[]
  lineHealth: LineHealthEntry[]
}

export function TrackDiagram({ routeId, vehiclePositions, lineHealth }: Props) {
  const [direction, setDirection] = useState<0 | 1>(1)
  const [stops, setStops] = useState<Stop[]>([])
  const [error, setError] = useState('')
  const cacheRef = useRef<Record<string, Stop[]>>({})

  useEffect(() => {
    const key = `${routeId}-${direction}`
    if (cacheRef.current[key]) {
      setStops(cacheRef.current[key])
      return
    }
    setError('')
    fetch(`/api/routes/${routeId}/stops?direction=${direction}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const s: Stop[] = data.stops ?? []
        cacheRef.current[key] = s
        setStops(s)
      })
      .catch(() => setError('NO ROUTE DATA'))
  }, [routeId, direction])

  // Trains at each stop for this route
  const routePositions = vehiclePositions.filter(vp => vp.route_id === routeId)

  // Map stop_id → list of statuses (multiple trains can be at same stop)
  const trainsByStop: Record<string, string[]> = {}
  for (const vp of routePositions) {
    const base = vp.stop_id.replace(/[NS]$/, '')  // strip N/S suffix for matching
    if (!trainsByStop[base]) trainsByStop[base] = []
    trainsByStop[base].push(vp.status)
  }

  // Is route delayed per lineHealth?
  const health = lineHealth.find(h => h.route_id === routeId)
  const isDelayed = (health?.avg_delay_sec ?? 0) > 60

  // Show every Nth label to avoid crowding
  function showLabel(i: number, total: number): boolean {
    if (total <= 8) return true
    if (total <= 14) return i % 2 === 0
    return i % 3 === 0
  }

  function dotStyle(stopId: string): React.CSSProperties {
    const base = stopId.replace(/[NS]$/, '')
    const statuses = trainsByStop[base] ?? []
    const hasTrain = statuses.length > 0
    const isStopped = statuses.some(s => s === 'STOPPED_AT')
    const isApproaching = statuses.some(s => s === 'IN_TRANSIT_TO' || s === 'INCOMING_AT')

    if (hasTrain && isDelayed) {
      return {
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: 'var(--amber)', border: '1px solid var(--amber)',
        boxShadow: '0 0 6px #f59e0b88', zIndex: 2, position: 'relative',
      }
    }
    if (isStopped) {
      return {
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: 'var(--green)', border: '1px solid var(--green)',
        boxShadow: '0 0 6px #22c55e88', zIndex: 2, position: 'relative',
      }
    }
    if (isApproaching) {
      return {
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: 'var(--green)', border: '1px solid var(--green)',
        boxShadow: '0 0 6px #22c55e88', zIndex: 2, position: 'relative',
        animation: 'pulse-glow 1.2s ease-out infinite',
      }
    }
    return {
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: '#1e3a1e', border: '1px solid #2a5a2a', zIndex: 2, position: 'relative',
    }
  }

  if (error) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.08em' }}>
        {error}
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 10 }}>
      {/* Direction toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([1, 0] as const).map(d => (
          <button key={d} onClick={() => setDirection(d)} style={{
            all: 'unset', cursor: 'pointer',
            fontSize: 8, letterSpacing: '0.1em', padding: '3px 8px',
            borderRadius: 2,
            background: direction === d ? 'var(--green-dim)' : 'transparent',
            border: `1px solid ${direction === d ? 'var(--green-border)' : 'var(--border)'}`,
            color: direction === d ? 'var(--green)' : 'var(--text-faint)',
          }}>
            {d === 1 ? 'UPTOWN' : 'DOWNTOWN'}
          </button>
        ))}
      </div>

      {/* Track row */}
      {stops.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>NO POSITION DATA</div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 'max-content', padding: '16px 4px 28px' }}>
            {stops.map((stop, i) => {
              const base = stop.stop_id.replace(/[NS]$/, '')
              const count = trainsByStop[base]?.length ?? 0
              const label = showLabel(i, stops.length)

              return (
                <div key={stop.stop_id} style={{ display: 'flex', alignItems: 'center' }}>
                  {/* Stop dot + label */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                    {/* Train count badge */}
                    {count > 1 && (
                      <div style={{
                        position: 'absolute', top: -14,
                        fontSize: 8, color: 'var(--green)', fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                        ▲{count}
                      </div>
                    )}
                    {count === 1 && (
                      <div style={{
                        position: 'absolute', top: -14,
                        fontSize: 8, color: 'var(--green)', fontWeight: 700,
                      }}>
                        ▲
                      </div>
                    )}

                    {/* Dot */}
                    <div title={stop.name} style={dotStyle(stop.stop_id)} />

                    {/* Label */}
                    {label && (
                      <div style={{
                        position: 'absolute', top: 14,
                        fontSize: 7, color: 'var(--text-faint)', whiteSpace: 'nowrap',
                        transform: 'translateX(-50%)', left: '50%',
                        maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {stop.name.split('–')[0].split('-')[0].trim()}
                      </div>
                    )}
                  </div>

                  {/* Connector segment (not after last stop) */}
                  {i < stops.length - 1 && (
                    <div style={{ width: 28, height: 2, background: '#1e3a1e', flexShrink: 0 }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
