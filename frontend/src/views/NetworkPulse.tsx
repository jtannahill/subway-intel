import { useState } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { LineBadge } from '../components/LineBadge'

interface Props { liveData: LiveData }

const STATUS_COLORS = {
  NOMINAL:   { text: 'var(--green)', bg: 'var(--green-dim)' },
  DELAYED:   { text: 'var(--amber)', bg: 'var(--amber-dim)' },
  DISRUPTED: { text: 'var(--red)',   bg: 'var(--red-dim)'   },
}

// Group lines into MTA divisions
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

function healthForRoutes(routes: string[], health: LineHealthEntry[]): LineHealthEntry | null {
  const entries = health.filter(h => routes.includes(h.route_id))
  if (entries.length === 0) return null
  const worst = entries.sort((a, b) => {
    const order = { DISRUPTED: 2, DELAYED: 1, NOMINAL: 0 }
    return order[b.status] - order[a.status]
  })[0]
  const avgDelay = entries.reduce((s, e) => s + e.avg_delay_sec, 0) / entries.length
  return { ...worst, avg_delay_sec: avgDelay }
}

export function NetworkPulse({ liveData }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const toggle = (label: string) => setExpanded(v => v === label ? null : label)

  const summary = {
    nominal:   liveData.lineHealth.filter(h => h.status === 'NOMINAL').length,
    delayed:   liveData.lineHealth.filter(h => h.status === 'DELAYED').length,
    disrupted: liveData.lineHealth.filter(h => h.status === 'DISRUPTED').length,
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>NETWORK PULSE</span>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'NOMINAL', count: summary.nominal, color: 'var(--green)' },
          { label: 'DELAYED', count: summary.delayed, color: 'var(--amber)' },
          { label: 'DISRUPTED', count: summary.disrupted, color: 'var(--red)' },
        ].map(({ label, count, color }) => (
          <div key={label} className="card" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{count}</div>
            <div className="label" style={{ marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Line groups */}
      {LINE_GROUPS.map(({ label, routes }) => {
        const h = healthForRoutes(routes, liveData.lineHealth)
        const status = h?.status ?? 'NOMINAL'
        const colors = STATUS_COLORS[status]
        const isExpanded = expanded === label

        return (
          <div key={label} style={{ marginBottom: 4 }}>
            <button onClick={() => toggle(label)} style={{
              all: 'unset', cursor: 'pointer', display: 'flex', width: '100%',
              alignItems: 'center', gap: 10,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 3, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {routes.map(r => <LineBadge key={r} routeId={r} size={18} />)}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.06em' }}>{label}</span>
              <div style={{
                marginLeft: 'auto', background: colors.bg, borderRadius: 2,
                padding: '2px 8px', fontSize: 10, color: colors.text,
              }}>
                {status}
              </div>
              {h && h.avg_delay_sec > 30 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                  {Math.round(h.avg_delay_sec / 60)}m avg lag
                </span>
              )}
              <span style={{ color: 'var(--text-faint)', fontSize: 10, marginLeft: 8 }}>
                {isExpanded ? '▲' : '▼'}
              </span>
            </button>

            {isExpanded && h && (
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none',
                borderRadius: '0 0 3px 3px', padding: 14,
              }}>
                {h.alerts.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No active alerts.</div>
                ) : (
                  h.alerts.map((a, i) => (
                    <div key={i} style={{ color: 'var(--amber)', fontSize: 11, marginBottom: 4 }}>⚠ {a}</div>
                  ))
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 8 }}>
                  Avg delay: {Math.round(h.avg_delay_sec)}s ·
                  Headway variance: {Math.round(h.headway_variance)}s
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
