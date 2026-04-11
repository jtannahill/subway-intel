import { useState, useEffect } from 'react'
import type { LiveData } from '../hooks/useLiveData'
import { useMediaQuery } from '../hooks/useMediaQuery'

type View = 'stations' | 'nearby' | 'pulse' | 'intel'

interface Props {
  active: View
  onNav: (v: View) => void
  liveData: LiveData
}

const NAV: { id: View; label: string }[] = [
  { id: 'stations', label: 'MY STATIONS' },
  { id: 'nearby',   label: 'NEARBY' },
  { id: 'pulse',    label: 'NETWORK PULSE' },
  { id: 'intel',    label: 'DELAY INTEL' },
]

export function TopBar({ active, onNav, liveData }: Props) {
  const [elapsedSec, setElapsedSec] = useState(0)
  const isMobile = useMediaQuery('(max-width: 640px)')

  useEffect(() => {
    if (!liveData.lastUpdate) return
    const tick = () =>
      setElapsedSec(Math.round((Date.now() - liveData.lastUpdate!.getTime()) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [liveData.lastUpdate])

  return (
    <div style={{
      height: 48,
      background: '#111',
      borderBottom: '1px solid var(--border-dim)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 24,
      flexShrink: 0,
      paddingLeft: 'max(16px, env(safe-area-inset-left))',
      paddingRight: 'max(16px, env(safe-area-inset-right))',
      zIndex: 10,
    }}>
      {/* Wordmark */}
      <span style={{ fontSize: 12, letterSpacing: '0.14em', color: 'var(--green)', fontWeight: 700 }}>
        SUBWAY-INTEL
      </span>

      {/* Nav tabs — desktop only */}
      {!isMobile && (
        <div style={{ display: 'flex', gap: 4 }}>
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onNav(id)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: '6px 14px',
                fontSize: 10,
                letterSpacing: '0.07em',
                borderRadius: 3,
                color: active === id ? 'var(--text-primary)' : 'var(--text-faint)',
                background: active === id ? '#1a1a1a' : 'transparent',
                border: active === id ? '1px solid var(--border)' : '1px solid transparent',
                transition: 'color 0.1s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* LIVE pill */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className={`dot ${liveData.connected ? 'dot-green' : 'dot-dim'}`} />
        <span style={{ color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.05em' }}>
          {liveData.connected
            ? (isMobile ? 'LIVE' : `LIVE · ${elapsedSec}s ago`)
            : 'CONNECTING'}
        </span>
      </div>
    </div>
  )
}
