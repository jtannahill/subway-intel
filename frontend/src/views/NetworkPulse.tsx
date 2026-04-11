import { useState } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import type { NearbyStation } from '../hooks/useNearby'
import { LineBadge } from '../components/LineBadge'
import { TrackDiagram } from '../components/TrackDiagram'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface Props { liveData: LiveData; nearbyStation: NearbyStation | null }

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

type SortKey = 'delay' | 'variance' | 'trend' | 'alerts'

const STATUS_ORDER = { DISRUPTED: 2, DELAYED: 1, NOMINAL: 0 }

export function NetworkPulse({ liveData, nearbyStation }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDesc, setSortDesc] = useState(true)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const toggle = (label: string) => setExpanded(v => v === label ? null : label)

  function cycleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDesc) setSortDesc(false)
      else { setSortKey(null); setSortDesc(true) }
    } else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

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
    <div style={{
      gridColumn: '1 / -1',
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      gap: 16,
      alignItems: 'start',
    }}>

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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>LINE GROUPS</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {([
              { key: 'trend',    label: 'TREND' },
              { key: 'delay',    label: 'AVG DELAY' },
              { key: 'variance', label: 'HW VARIANCE' },
              { key: 'alerts',   label: 'ALERTS' },
            ] as { key: SortKey; label: string }[]).map(({ key, label }) => {
              const active = sortKey === key
              return (
                <button key={key} onClick={() => cycleSort(key)} style={{
                  all: 'unset', cursor: 'pointer',
                  fontSize: 7, letterSpacing: '0.1em', padding: '2px 6px',
                  borderRadius: 2,
                  background: active ? 'var(--green-dim)' : 'transparent',
                  border: `1px solid ${active ? 'var(--green-border)' : 'var(--border)'}`,
                  color: active ? 'var(--green)' : 'var(--text-faint)',
                }}>
                  {label}{active ? (sortDesc ? ' ▼' : ' ▲') : ''}
                </button>
              )
            })}
          </div>
        </div>
        {(sortKey
          ? [...LINE_GROUPS].sort((a, b) => {
              const ha = worstHealth(a.routes, liveData.lineHealth)
              const hb = worstHealth(b.routes, liveData.lineHealth)
              let va = 0, vb = 0
              if (sortKey === 'delay')    { va = ha?.avg_delay_sec ?? 0;   vb = hb?.avg_delay_sec ?? 0 }
              if (sortKey === 'variance') { va = ha?.headway_variance ?? 0; vb = hb?.headway_variance ?? 0 }
              if (sortKey === 'trend')    { va = STATUS_ORDER[ha?.status ?? 'NOMINAL']; vb = STATUS_ORDER[hb?.status ?? 'NOMINAL'] }
              if (sortKey === 'alerts')   { va = ha?.alerts.length ?? 0;    vb = hb?.alerts.length ?? 0 }
              return sortDesc ? vb - va : va - vb
            })
          : LINE_GROUPS
        ).map(({ label, routes }) => {
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

              {isExpanded && (
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none',
                  borderRadius: '0 0 3px 3px', padding: 12,
                }}>
                  {h ? (
                    <>
                      {h.alerts.length === 0
                        ? <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No active alerts.</div>
                        : h.alerts.map((a, i) => (
                            <div key={i} style={{ color: 'var(--amber)', fontSize: 11, marginBottom: 4 }}>⚠ {a}</div>
                          ))
                      }
                      <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 8 }}>
                        Avg delay: {Math.round(h.avg_delay_sec)}s · HW variance: {Math.round(h.headway_variance)}s
                      </div>
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No data.</div>
                  )}
                  <TrackDiagram
                    routeId={routes[0]}
                    vehiclePositions={liveData.vehiclePositions}
                    lineHealth={liveData.lineHealth}
                    myStopId={nearbyStation?.stop_id}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}

