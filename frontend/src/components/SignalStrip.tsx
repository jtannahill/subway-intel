import type { LineHealthEntry } from '../hooks/useLiveData'

interface Props { health: LineHealthEntry[] }

const STATUS_COLORS = {
  NOMINAL: { bg: 'var(--green-dim)', border: 'var(--green-border)', text: 'var(--green)' },
  DELAYED: { bg: 'var(--amber-dim)', border: 'var(--amber-border)', text: 'var(--amber)' },
  DISRUPTED: { bg: 'var(--red-dim)', border: 'var(--red-border)', text: 'var(--red)' },
}

export function SignalStrip({ health }: Props) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {health.map((h) => {
        const c = STATUS_COLORS[h.status]
        return (
          <span key={h.route_id} style={{
            background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 2, padding: '3px 8px',
            fontSize: 10, color: c.text,
          }}>
            {h.route_id} · {h.status === 'NOMINAL' ? 'nominal' : `${Math.round(h.avg_delay_sec / 60)}m lag`}
          </span>
        )
      })}
    </div>
  )
}
