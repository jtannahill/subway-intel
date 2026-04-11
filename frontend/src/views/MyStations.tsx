import { useState } from 'react'
import { ArrivalCard } from '../components/ArrivalCard'
import { SignalStrip } from '../components/SignalStrip'
import { SmartCommute } from './SmartCommute'
import { StationSearchInput } from '../components/StationSearchInput'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[]; addStation: (s: SavedStation) => void; removeStation: (id: string, dir: string) => void }
  corrections: Record<string, number>
}

interface PendingStation { stop_id: string; name: string }

export function MyStations({ liveData, stationsCtx, corrections }: Props) {
  const { stations, addStation, removeStation } = stationsCtx
  const [showSearch, setShowSearch] = useState(false)
  const [pending, setPending] = useState<PendingStation | null>(null)
  const isMobile = useMediaQuery('(max-width: 640px)')

  function onSelect(stop_id: string, name: string) {
    setPending({ stop_id, name })
  }

  function addWithDirection(dir: 'N' | 'S') {
    if (!pending) return
    addStation({ stop_id: pending.stop_id + dir, name: pending.name, direction: dir, route_ids: [] })
    setPending(null)
    setShowSearch(false)
  }

  function cancelAdd() {
    setPending(null)
    setShowSearch(false)
  }

  return (
    <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 12 : 16, alignItems: 'start' }}>

      {/* LEFT: Station list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>MY STATIONS</span>
          {stations.length < 5 && !showSearch && (
            <button onClick={() => setShowSearch(true)} style={{
              all: 'unset', cursor: 'pointer', marginLeft: 'auto',
              color: 'var(--green)', fontSize: 10, letterSpacing: '0.05em',
              WebkitTapHighlightColor: 'transparent',
            }}>
              + ADD STATION
            </button>
          )}
          {showSearch && (
            <button onClick={cancelAdd} style={{
              all: 'unset', cursor: 'pointer', marginLeft: 'auto',
              color: 'var(--text-faint)', fontSize: 10,
              WebkitTapHighlightColor: 'transparent',
            }}>
              ✕ CANCEL
            </button>
          )}
        </div>

        {showSearch && !pending && (
          <div style={{ marginBottom: 16 }}>
            <StationSearchInput
              placeholder="Search station or NYC address..."
              onSelect={onSelect}
            />
          </div>
        )}

        {/* Direction picker */}
        {pending && (
          <div style={{
            marginBottom: 16,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '12px 14px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-primary)', marginBottom: 10 }}>
              {pending.name.toUpperCase()}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', marginBottom: 8 }}>
              WHICH DIRECTION?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => addWithDirection('N')} style={{
                all: 'unset', cursor: 'pointer', flex: 1,
                padding: '10px 0', textAlign: 'center',
                fontSize: 10, letterSpacing: '0.07em', fontFamily: 'inherit',
                borderRadius: 3,
                background: 'var(--green-dim)', border: '1px solid var(--green-border)',
                color: 'var(--green)', fontWeight: 700,
                WebkitTapHighlightColor: 'transparent',
              }}>
                ↑ UPTOWN
              </button>
              <button onClick={() => addWithDirection('S')} style={{
                all: 'unset', cursor: 'pointer', flex: 1,
                padding: '10px 0', textAlign: 'center',
                fontSize: 10, letterSpacing: '0.07em', fontFamily: 'inherit',
                borderRadius: 3,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                color: 'var(--text-muted)', fontWeight: 700,
                WebkitTapHighlightColor: 'transparent',
              }}>
                ↓ DOWNTOWN
              </button>
            </div>
          </div>
        )}

        {stations.length === 0 && !showSearch ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 40, textAlign: 'center' }}>
            No stations saved. Click + ADD STATION to get started.
          </div>
        ) : (
          stations.map(s => (
            <ArrivalCard
              key={`${s.stop_id}-${s.direction}`}
              station={s}
              arrivals={liveData.arrivals[s.stop_id] ?? []}
              onRemove={() => removeStation(s.stop_id, s.direction)}
              lastUpdate={liveData.lastUpdate}
              corrections={corrections}
            />
          ))
        )}

        {liveData.lineHealth.length > 0 && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div className="label" style={{ marginBottom: 8 }}>LIVE SIGNALS</div>
            <SignalStrip health={liveData.lineHealth} />
          </div>
        )}
      </div>

      {/* RIGHT: Smart Commute */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>SMART COMMUTE</span>
        </div>
        <SmartCommute liveData={liveData} stationsCtx={stationsCtx} />
      </div>

    </div>
  )
}
