import { useState } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { LineBadge } from '../components/LineBadge'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface Props {
  liveData: LiveData
  savedLines?: string[]
  hasSaved?: boolean
}

const STATUS_ORDER = { DISRUPTED: 0, DELAYED: 1, NOMINAL: 2 }
const STATUS_COLORS = {
  NOMINAL:   'var(--green)',
  DELAYED:   'var(--amber)',
  DISRUPTED: 'var(--red)',
}

function TrendArrow({ h }: { h: LineHealthEntry }) {
  if (h.avg_delay_sec > 120) return <span style={{ color: 'var(--red)' }}>↑</span>
  if (h.avg_delay_sec > 30)  return <span style={{ color: 'var(--amber)' }}>→</span>
  return <span style={{ color: 'var(--green)' }}>↓</span>
}

function GapFlag({ h }: { h: LineHealthEntry }) {
  if (h.headway_variance > 120) {
    return <span style={{ color: 'var(--amber)', fontSize: 9, marginLeft: 6 }}>GAP DETECTED</span>
  }
  return null
}

export function DelayIntel({ liveData, savedLines = [], hasSaved = false }: Props) {
  const [showAll, setShowAll] = useState(false)
  const [showDefs, setShowDefs] = useState(false)
  const isMobile = useMediaQuery('(max-width: 768px)')

  const sorted = [...liveData.lineHealth].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  )
  const visible = showAll ? sorted : sorted.filter(h => h.status !== 'NOMINAL')
  const nominalCount = sorted.filter(h => h.status === 'NOMINAL').length

  const pinnedRows = hasSaved
    ? sorted.filter(h => savedLines.includes(h.route_id))
    : []
  const unpinnedVisible = visible.filter(h => !savedLines.includes(h.route_id))

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div style={{ marginBottom: 8 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>DELAY INTEL</span>
      </div>
      <div style={{ color: 'var(--text-faint)', fontSize: 10, marginBottom: 12 }}>
        Heuristic signals derived from live GTFS-RT feed · 15-min rolling window
      </div>

      {/* Summary line */}
      {sorted.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          {[
            { label: 'DISRUPTED', count: sorted.filter(h => h.status === 'DISRUPTED').length, color: 'var(--red)' },
            { label: 'DELAYED',   count: sorted.filter(h => h.status === 'DELAYED').length,   color: 'var(--amber)' },
            { label: 'NOMINAL',   count: sorted.filter(h => h.status === 'NOMINAL').length,   color: 'var(--green)' },
          ].map(({ label, count, color }) => (
            <span key={label} style={{ fontSize: 10, color, letterSpacing: '0.06em' }}>
              {count} {label}
            </span>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
          gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--border)',
          minWidth: isMobile ? 480 : undefined,
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
          <>
            {/* Pinned saved-line rows */}
            {pinnedRows.length > 0 && (
              <>
                <div style={{
                  padding: '4px 14px 2px',
                  fontSize: 8,
                  letterSpacing: '0.12em',
                  color: 'var(--text-faint)',
                  textTransform: 'uppercase',
                }}>
                  PINNED
                </div>
                {pinnedRows.map(h => (
                  <div key={h.route_id} style={{
                    display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
                    gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
                    alignItems: 'center',
                    minWidth: isMobile ? 480 : undefined,
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
                ))}
                <div style={{ height: 1, background: 'var(--border)', margin: '2px 14px 4px' }} />
              </>
            )}

            {unpinnedVisible.map(h => (
              <div key={h.route_id} style={{
                display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
                gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
                alignItems: 'center',
                minWidth: isMobile ? 480 : undefined,
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
            ))}

            {!showAll && nominalCount > 0 && (
              <button onClick={() => setShowAll(true)} style={{
                all: 'unset', cursor: 'pointer', display: 'block', width: '100%',
                padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
                color: 'var(--green)', fontSize: 10, letterSpacing: '0.06em',
                boxSizing: 'border-box',
              }}>
                + {nominalCount} NOMINAL LINE{nominalCount > 1 ? 'S' : ''} RUNNING FINE ▼
              </button>
            )}

            {showAll && (
              <button onClick={() => setShowAll(false)} style={{
                all: 'unset', cursor: 'pointer', display: 'block', width: '100%',
                padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
                color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.06em',
                boxSizing: 'border-box',
              }}>
                ▲ HIDE NOMINAL LINES
              </button>
            )}
          </>
        )}
      </div>

      {/* Collapsible signal definitions */}
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setShowDefs(v => !v)} style={{
          all: 'unset', cursor: 'pointer',
          color: 'var(--text-faint)', fontSize: 9, letterSpacing: '0.08em',
        }}>
          {showDefs ? '▲ HIDE SIGNAL DEFINITIONS' : '▼ SIGNAL DEFINITIONS'}
        </button>
        {showDefs && (
          <div style={{ marginTop: 8, padding: 14, background: 'var(--bg-surface)', borderRadius: 3, border: '1px solid var(--border)' }}>
            <div className="label" style={{ marginBottom: 8 }}>SIGNAL DEFINITIONS</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, lineHeight: 1.8 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Avg Delay</strong> — rolling 15-min mean of delay_sec across all trips on this route.<br />
              <strong style={{ color: 'var(--text-primary)' }}>HW Variance</strong> — standard deviation of headways (seconds between consecutive trains). High variance = bunching or gapping.<br />
              <strong style={{ color: 'var(--text-primary)' }}>Trend</strong> — ↑ worsening, → stable, ↓ improving (last 30 min window).<br />
              <strong style={{ color: 'var(--text-primary)' }}>GAP DETECTED</strong> — headway variance &gt; 120s, indicating trains are not evenly spaced.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
