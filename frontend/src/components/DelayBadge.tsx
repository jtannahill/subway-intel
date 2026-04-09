interface Props { delaySec: number }

export function DelayBadge({ delaySec }: Props) {
  if (delaySec <= 30) return null
  const mins = Math.round(delaySec / 60)
  return (
    <span style={{
      background: 'var(--amber-dim)',
      border: '1px solid var(--amber-border)',
      borderRadius: 2,
      padding: '2px 6px',
      fontSize: 9,
      color: 'var(--amber)',
      letterSpacing: '0.05em',
    }}>
      +{mins} MIN DELAY
    </span>
  )
}
