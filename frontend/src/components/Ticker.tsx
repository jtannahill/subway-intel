import { useEffect, useRef } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { getLineColor, getLineTextColor } from '../constants/mta-colors'

// Lines to show in ticker order (skipping less common shuttle variants)
const TICKER_LINES = ['1','2','3','4','5','6','7','A','C','E','B','D','F','M','G','J','Z','L','N','Q','R','W','SIR']

function statusText(h: LineHealthEntry | undefined): string {
  if (!h) return 'OK'
  if (h.status === 'DISRUPTED') return 'DLY'
  if (h.status === 'DELAYED') return `+${Math.round(h.avg_delay_sec / 60)}m`
  return 'OK'
}

function statusColor(h: LineHealthEntry | undefined): string {
  if (!h) return 'var(--green)'
  if (h.status === 'DISRUPTED') return 'var(--red)'
  if (h.status === 'DELAYED') return 'var(--amber)'
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
        void el.offsetWidth // reflow to restart animation
        el.classList.add('pulse')
      }, i * 30)
    })
  }, [liveData.lastUpdate])

  const healthMap = Object.fromEntries(liveData.lineHealth.map(h => [h.route_id, h]))

  // Build items once, duplicate for seamless loop
  const items = TICKER_LINES.map(routeId => {
    const h = healthMap[routeId]
    return (
      <div
        key={routeId}
        className="ticker-item"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 14px',
          borderRight: '1px solid var(--border-dim)',
          height: '100%',
          flexShrink: 0,
        }}
      >
        <span style={{
          width: 18,
          height: 18,
          background: getLineColor(routeId),
          color: getLineTextColor(routeId),
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          fontWeight: 700,
          flexShrink: 0,
          fontFamily: 'sans-serif',
        }}>
          {routeId === 'SIR' ? 'SI' : routeId}
        </span>
        <span style={{ fontSize: 9, letterSpacing: '0.05em', color: statusColor(h) }}>
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
      {/* Static label */}
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

      {/* Scrolling strip */}
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
          {/* Duplicate for seamless loop */}
          {items}
        </div>
      </div>
    </div>
  )
}
