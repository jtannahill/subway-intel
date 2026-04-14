type View = 'stations' | 'nearby' | 'pulse' | 'intel' | 'map' | 'plan'

interface Props {
  active: View
  onNav: (v: View) => void
}

const ITEMS: { id: View; icon: string; label: string }[] = [
  { id: 'stations', icon: '⊞', label: 'STATIONS' },
  { id: 'nearby',   icon: '◎', label: 'NEARBY'   },
  { id: 'pulse',    icon: '≋', label: 'PULSE'     },
  { id: 'intel',    icon: '⚡', label: 'INTEL'     },
  { id: 'map',      icon: '⬡', label: 'MAP'       },
  { id: 'plan',     icon: '⇄', label: 'PLAN'      },
]

export function BottomNav({ active, onNav }: Props) {
  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: 'calc(56px + env(safe-area-inset-bottom))',
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: '#111',
      borderTop: '1px solid var(--border-dim)',
      display: 'flex',
      zIndex: 100,
    }}>
      {ITEMS.map(({ id, icon, label }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            onClick={() => onNav(id)}
            style={{
              all: 'unset',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              cursor: 'pointer',
              color: isActive ? 'var(--green)' : 'var(--text-faint)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontSize: 8, letterSpacing: '0.08em' }}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
