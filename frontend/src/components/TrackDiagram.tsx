import { useEffect, useRef, useState } from 'react'
import type { VehiclePositionEntry, LineHealthEntry } from '../hooks/useLiveData'

interface Stop { stop_id: string; name: string }

interface Props {
  routeId: string
  vehiclePositions: VehiclePositionEntry[]
  lineHealth: LineHealthEntry[]
  myStopId?: string
}

const SLOT = 16   // px: width of each stop's "column"
const CONN = 20   // px: width of the connector rail between stops
const TRAIN_SIZE = 12  // px: diameter of moving train dot
const RAIL_Y = 9       // px: vertical center of the rail

/** Convert a GTFS-RT status + stop index into an interpolated X pixel position. */
function interpolateTrainX(
  status: VehiclePositionEntry['status'],
  targetIdx: number,
): number {
  const targetX = targetIdx * (SLOT + CONN) + SLOT / 2
  const prevX = targetIdx > 0 ? (targetIdx - 1) * (SLOT + CONN) + SLOT / 2 : targetX
  switch (status) {
    case 'STOPPED_AT':   return targetX
    case 'INCOMING_AT':  return prevX + (targetX - prevX) * 0.80
    case 'IN_TRANSIT_TO': return prevX + (targetX - prevX) * 0.20
    default:             return targetX
  }
}

export function TrackDiagram({ routeId, vehiclePositions, lineHealth, myStopId }: Props) {
  const [stops, setStops] = useState<Stop[]>([])
  const [error, setError] = useState(false)
  const cacheRef = useRef<Record<string, Stop[]>>({})
  const containerRef = useRef<HTMLDivElement>(null)

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

  // Compute myX before early returns so the auto-scroll useEffect is always called
  const myBase = myStopId?.replace(/[NS]$/, '')
  const uptownIndexMap = new Map(stops.map((s, i) => [s.stop_id.replace(/[NS]$/, ''), i]))
  const myIndex = myBase ? uptownIndexMap.get(myBase) ?? -1 : -1
  const myX = myIndex >= 0 ? myIndex * (SLOT + CONN) + SLOT / 2 : -1

  // Auto-scroll to center "you are here" when stops load — must be before early returns
  useEffect(() => {
    if (myX < 0 || !containerRef.current) return
    containerRef.current.scrollLeft = myX - containerRef.current.clientWidth / 2
  }, [myX])

  if (error) return (
    <div style={{ color: 'var(--text-faint)', fontSize: 10, padding: '8px 0', letterSpacing: '0.08em' }}>
      NO ROUTE DATA
    </div>
  )
  if (stops.length === 0) return null

  const uptownStops = stops
  const downtownStops = [...stops].reverse()

  const health = lineHealth.find(h => h.route_id === routeId)
  const isDelayed = (health?.avg_delay_sec ?? 0) > 60
  const trainColor = isDelayed ? 'var(--amber)' : 'var(--green)'
  const trainShadow = isDelayed ? '0 0 8px #f59e0b88' : '0 0 8px #22c55e88'
  const trainBorder = isDelayed ? '2px solid var(--amber)' : '2px solid var(--green)'
  const trainApproachAnim = isDelayed ? 'pulse-glow-amber 1.2s ease-out infinite' : 'pulse-glow 1.2s ease-out infinite'

  const totalWidth = stops.length * SLOT + Math.max(0, stops.length - 1) * CONN

  // Index maps: base_stop_id → position in each direction's array (uptownIndexMap already computed above)
  const downtownIndexMap = new Map(downtownStops.map((s, i) => [s.stop_id.replace(/[NS]$/, ''), i]))

  // Split vehicles by direction suffix
  const routeVehicles = vehiclePositions.filter(v => v.route_id === routeId)
  const uptownVehicles = routeVehicles.filter(v => v.stop_id.endsWith('N'))
  const downtownVehicles = routeVehicles.filter(v => v.stop_id.endsWith('S'))

  function renderLabels(trackStops: Stop[]) {
    return (
      <div style={{ position: 'relative', height: 28, width: totalWidth }}>
        {trackStops.map((stop, i) => {
          const raw = stop.name.replace(/[-–].+$/, '').trim()
          const label = raw.length > 10 ? raw.slice(0, 9) + '…' : raw
          const centerX = i * (SLOT + CONN) + SLOT / 2
          const top = i % 2 === 0 ? 0 : 14
          const isMyStop = myBase && stop.stop_id.replace(/[NS]$/, '') === myBase
          return (
            <div key={stop.stop_id} style={{
              position: 'absolute',
              left: centerX,
              top,
              transform: 'translateX(-50%)',
              fontSize: 8,
              fontWeight: isMyStop ? 700 : 400,
              color: isMyStop ? 'var(--amber)' : 'var(--text-faint)',
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

  /** Overlay station dots and floating train dots in the same coordinate space. */
  function renderTrack(
    trackStops: Stop[],
    vehicles: VehiclePositionEntry[],
    indexMap: Map<string, number>,
  ) {
    return (
      <div style={{ position: 'relative', height: 20, width: totalWidth }}>
        {/* Rail */}
        <div style={{
          position: 'absolute', top: RAIL_Y, left: 0, width: totalWidth, height: 2,
          background: '#1e3a1e',
        }} />
        {/* Station markers */}
        {trackStops.map((stop, i) => {
          const base = stop.stop_id.replace(/[NS]$/, '')
          const isMyStop = !!myBase && base === myBase
          const dotSize = isMyStop ? 14 : 8
          const dotLeft = i * (SLOT + CONN) + (SLOT - dotSize) / 2
          const dotTop = (20 - dotSize) / 2
          return (
            <div key={stop.stop_id} title={stop.name} style={{
              position: 'absolute', left: dotLeft, top: dotTop,
              width: dotSize, height: dotSize, borderRadius: '50%',
              background: isMyStop ? 'var(--amber)' : '#1e3a1e',
              border: isMyStop ? '2px solid #fbbf24' : '1px solid #2a5a2a',
              boxShadow: isMyStop ? '0 0 10px #f59e0baa, 0 0 20px #f59e0b55' : 'none',
              animation: isMyStop ? 'pulse-glow-amber 1.4s ease-in-out infinite' : 'none',
              zIndex: 2,
            }} />
          )
        })}
        {/* Floating train dots */}
        {vehicles.map(vp => {
          const base = vp.stop_id.replace(/[NS]$/, '')
          const idx = indexMap.get(base)
          if (idx === undefined) return null
          const trainX = interpolateTrainX(vp.status, idx)
          const isApproaching = vp.status === 'IN_TRANSIT_TO' || vp.status === 'INCOMING_AT'
          return (
            <div key={vp.trip_id} style={{
              position: 'absolute',
              left: trainX - TRAIN_SIZE / 2,
              top: RAIL_Y - TRAIN_SIZE / 2,
              width: TRAIN_SIZE,
              height: TRAIN_SIZE,
              borderRadius: '50%',
              background: trainColor,
              border: trainBorder,
              boxShadow: trainShadow,
              animation: isApproaching ? trainApproachAnim : 'none',
              zIndex: 4,
              transition: 'left 0.8s ease-in-out',
              willChange: 'left',
            }} />
          )
        })}
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ paddingTop: 8, overflowX: 'auto', width: '100%', minWidth: 0 }}>
      <div style={{ width: totalWidth, padding: '0 4px 4px' }}>

        {/* YOU ARE HERE pin */}
        <div style={{ position: 'relative', height: myX >= 0 ? 34 : 0, width: totalWidth }}>
          {myX >= 0 && (
            <div style={{
              position: 'absolute', left: myX,
              transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              top: 0, gap: 1,
            }}>
              <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                YOU
              </span>
              <div style={{ width: 1, height: 12, background: 'var(--amber)', opacity: 0.65 }} />
              <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid var(--amber)' }} />
            </div>
          )}
        </div>

        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', marginBottom: 4 }}>↑ UPTOWN</div>
        {renderTrack(uptownStops, uptownVehicles, uptownIndexMap)}
        {renderLabels(uptownStops)}
        {renderTrack(downtownStops, downtownVehicles, downtownIndexMap)}
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', marginTop: 4 }}>↓ DOWNTOWN</div>

      </div>
    </div>
  )
}
