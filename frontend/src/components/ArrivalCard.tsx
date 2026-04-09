import type { ArrivalEntry } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'
import { LineBadge } from './LineBadge'
import { DelayBadge } from './DelayBadge'
import { directionLabel } from '../constants/stops'

interface Props {
  station: SavedStation
  arrivals: ArrivalEntry[]
  onRemove: () => void
}

function minutesUntil(isoTime: string): number {
  return Math.max(0, Math.round((new Date(isoTime).getTime() - Date.now()) / 60000))
}

export function ArrivalCard({ station, arrivals, onRemove }: Props) {
  const firstDelay = arrivals[0]?.delay_sec ?? 0
  const hasDelay = firstDelay > 30
  const isDisrupted = firstDelay > 300

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
              <div key={a.arrival_time} style={{
                background: isNext ? (hasDelay ? 'var(--amber-dim)' : 'var(--green-dim)') : 'var(--bg)',
                border: `1px solid ${isNext ? (hasDelay ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)'}`,
                borderRadius: 3,
                padding: '8px 14px',
                textAlign: 'center',
                minWidth: 52,
              }}>
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
