import type { LiveData } from '../hooks/useLiveData'

type View = 'stations' | 'commute' | 'pulse' | 'intel'

interface Props {
  active: View
  onNav: (v: View) => void
  liveData: LiveData
}

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'stations', label: 'MY STATIONS' },
  { id: 'commute',  label: 'SMART COMMUTE' },
  { id: 'pulse',    label: 'NETWORK PULSE' },
  { id: 'intel',    label: 'DELAY INTEL' },
]

export function Sidebar({ active, onNav, liveData }: Props) {
  const alertCount = liveData.lineHealth.filter(h => h.alerts.length > 0).length
  const hasDelays = liveData.lineHealth.some(h => h.status === 'DELAYED' || h.status === 'DISRUPTED')

  return (
    <aside style={{
      width: 'var(--sidebar-width)',
      flexShrink: 0,
      background: '#0a0a0a',
      borderRight: '1px solid var(--border-dim)',
      display: 'flex',
      flexDirection: 'column',
      padding: '16px 0',
    }}>
      <div style={{ padding: '0 12px', marginBottom: 20 }}>
        <div className="label">NAVIGATION</div>
      </div>

      {NAV_ITEMS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onNav(id)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'block',
            padding: '10px 12px',
            borderLeft: active === id ? '2px solid var(--green)' : '2px solid transparent',
            color: active === id ? 'var(--green)' : 'var(--text-faint)',
            fontSize: 11,
            letterSpacing: '0.06em',
            marginBottom: 2,
            transition: 'color 0.1s',
          }}
        >
          {label}
        </button>
      ))}

      <div style={{ marginTop: 'auto', padding: '0 12px', borderTop: '1px solid var(--border-dim)', paddingTop: 20 }}>
        <div className="label" style={{ marginBottom: 10 }}>SYSTEM</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <div className={`dot ${liveData.connected ? 'dot-green' : 'dot-dim'}`} />
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>Feed: {liveData.connected ? 'OK' : 'CONNECTING'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <div className={`dot ${hasDelays ? 'dot-amber' : 'dot-green'}`} />
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>
            {alertCount > 0 ? `${alertCount} alerts active` : 'No alerts'}
          </span>
        </div>
        {liveData.lastUpdate && (
          <div style={{ color: 'var(--text-faint)', fontSize: 9, marginTop: 8 }}>
            updated {Math.round((Date.now() - liveData.lastUpdate.getTime()) / 1000)}s ago
          </div>
        )}
      </div>
    </aside>
  )
}
