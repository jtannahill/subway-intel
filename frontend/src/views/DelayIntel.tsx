import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { LineBadge } from '../components/LineBadge'

interface Props { liveData: LiveData }

const STATUS_ORDER = { DISRUPTED: 0, DELAYED: 1, NOMINAL: 2 }
const STATUS_COLORS = {
  NOMINAL:   'var(--green)',
  DELAYED:   'var(--amber)',
  DISRUPTED: 'var(--red)',
}

function TrendArrow({ h }: { h: LineHealthEntry }) {
  // Simple: if avg delay > 60s show ↑, else ↓ or —
  if (h.avg_delay_sec > 120) return <span style={{ color: 'var(--red)' }}>↑</span>
  if (h.avg_delay_sec > 30)  return <span style={{ color: 'var(--amber)' }}>→</span>
  return <span style={{ color: 'var(--green)' }}>↓</span>
}

function GapFlag({ h }: { h: LineHealthEntry }) {
  // Flag bunching/gapping if headway variance > 120s^2
  if (h.headway_variance > 120) {
    return <span style={{ color: 'var(--amber)', fontSize: 9, marginLeft: 6 }}>GAP DETECTED</span>
  }
  return null
}

export function DelayIntel({ liveData }: Props) {
  const sorted = [...liveData.lineHealth].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  )

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div style={{ marginBottom: 8 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>DELAY INTEL</span>
      </div>
      <div style={{ color: 'var(--text-faint)', fontSize: 10, marginBottom: 20 }}>
        Heuristic signals derived from live GTFS-RT feed · 15-min rolling window
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
        gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--border)',
      }}>
        {['LINE', 'STATUS', 'AVG DELAY', 'HW VARIANCE', 'TREND', 'ALERTS'].map(h => (
          <div key={h} className="label">{h}</div>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '20px 14px' }}>
          Waiting for feed data...
        </div>
      ) : (
        sorted.map(h => (
          <div key={h.route_id} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
            gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
            alignItems: 'center',
          }}>
            <div><LineBadge routeId={h.route_id} size={20} /></div>
            <div>
              <span style={{ color: STATUS_COLORS[h.status], fontSize: 11 }}>{h.status}</span>
              <GapFlag h={h} />
            </div>
            <div style={{ color: 'var(--text-primary)', fontSize: 11 }}>
              {Math.round(h.avg_delay_sec)}s
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              ±{Math.round(Math.sqrt(h.headway_variance))}s
            </div>
            <div style={{ fontSize: 14 }}><TrendArrow h={h} /></div>
            <div style={{ color: h.alerts.length > 0 ? 'var(--amber)' : 'var(--text-faint)', fontSize: 11 }}>
              {h.alerts.length > 0 ? h.alerts.length : '—'}
            </div>
          </div>
        ))
      )}

      <div style={{ marginTop: 24, padding: 14, background: 'var(--bg-surface)', borderRadius: 3, border: '1px solid var(--border)' }}>
        <div className="label" style={{ marginBottom: 8 }}>SIGNAL DEFINITIONS</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 10, lineHeight: 1.8 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Avg Delay</strong> — rolling 15-min mean of delay_sec across all trips on this route.<br />
          <strong style={{ color: 'var(--text-primary)' }}>HW Variance</strong> — standard deviation of headways (seconds between consecutive trains). High variance = bunching or gapping.<br />
          <strong style={{ color: 'var(--text-primary)' }}>Trend</strong> — ↑ worsening, → stable, ↓ improving (last 30 min window).<br />
          <strong style={{ color: 'var(--text-primary)' }}>GAP DETECTED</strong> — headway variance &gt; 120s, indicating trains are not evenly spaced.
        </div>
      </div>
    </div>
  )
}
