import { useEffect, useRef } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { LineBadge } from './LineBadge'

// Lines to show in ticker order (skipping less common shuttle variants)
const TICKER_LINES = ['1','2','3','4','5','6','7','A','C','E','B','D','F','M','G','J','Z','L','N','Q','R','W','SIR']

function statusText(h: LineHealthEntry | undefined): string {
  if (!h) return 'OK'
  if (h.status === 'DISRUPTED') return 'DLY'
  if (h.status === 'DELAYED') {
    const mins = Math.round(h.avg_delay_sec / 60)
    return mins > 0 ? `+${mins}m` : 'SLOWING'
  }
  // Show headway ratio when available and nominal
  if (h.current_headway_sec && h.scheduled_headway_sec) {
    const ratio = h.current_headway_sec / h.scheduled_headway_sec
    if (ratio > 1.5) return 'GAPS'
  }
  return 'OK'
}

function statusColor(h: LineHealthEntry | undefined): string {
  if (!h) return 'var(--green)'
  if (h.status === 'DISRUPTED') return 'var(--red)'
  if (h.status === 'DELAYED') return 'var(--amber)'
  if (h.current_headway_sec && h.scheduled_headway_sec) {
    if (h.current_headway_sec / h.scheduled_headway_sec > 1.5) return 'var(--amber)'
  }
  return 'var(--green)'
}

interface Props { liveData: LiveData }

export function Ticker({ liveData }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!liveData.lastUpdate || !containerRef.current) return
    const items = containerRef.current.querySelectorAll<HTMLElement>('.ticker-item')
    items.forEach((el, i) => {
      setTimeout(() => {
        el.classList.remove('pulse')
        void el.offsetWidth
        el.classList.add('pulse')
      }, i * 30)
    })
  }, [liveData.lastUpdate])

  const healthMap = Object.fromEntries(liveData.lineHealth.map(h => [h.route_id, h]))

  const items = TICKER_LINES.map(routeId => {
    const h = healthMap[routeId]
    return (
      <div
        key={routeId}
        className="ticker-item"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 12px',
          borderRight: '1px solid var(--border-dim)',
          height: '100%',
          flexShrink: 0,
        }}
      >
        <LineBadge routeId={routeId} size={17} />
        <span style={{ fontSize: 9, letterSpacing: '0.05em', color: statusColor(h), fontWeight: 600 }}>
          {statusText(h)}
        </span>
      </div>
    )
  })

  return (
    <div style={{
      height: 34,
      background: '#0a0a0a',
      borderBottom: '1px solid var(--border-dim)',
      display: 'flex',
      alignItems: 'center',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{
        padding: '0 12px',
        fontSize: 9,
        letterSpacing: '0.1em',
        color: 'var(--text-faint)',
        borderRight: '1px solid var(--border-dim)',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        LINES
      </div>

      <div style={{ flex: 1, overflow: 'hidden', height: '100%' }}>
        <div
          ref={containerRef}
          style={{
            display: 'flex',
            height: '100%',
            animation: 'ticker-scroll 28s linear infinite',
          }}
        >
          {items}
          {items}
        </div>
      </div>
    </div>
  )
}
