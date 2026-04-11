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
  const downtownStops = [...stops].reverse()  // direction=0: reversed for same geo alignment

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

  const totalWidth = stops.length * SLOT + Math.max(0, stops.length - 1) * CONN

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
    const anim = hasTrain && isApproaching
      ? (isDelayed ? 'pulse-glow-amber 1.2s ease-out infinite' : 'pulse-glow 1.2s ease-out infinite')
      : 'none'
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
