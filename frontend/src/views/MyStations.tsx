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
}

export function MyStations({ liveData, stationsCtx }: Props) {
  const { stations, addStation, removeStation } = stationsCtx
  const [showSearch, setShowSearch] = useState(false)
  const isMobile = useMediaQuery('(max-width: 768px)')

  function addStop(stop_id: string, name: string) {
    // Direction hardcoded to 'N' — direction selection UI is out of scope for this feature
    addStation({ stop_id: stop_id + 'N', name, direction: 'N', route_ids: [] })
    setShowSearch(false)
  }

  return (
    <div style={{
      gridColumn: '1 / -1',
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      gap: 16,
      alignItems: 'start',
    }}>

      {/* LEFT: Station list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>MY STATIONS</span>
          {stations.length < 5 && (
            <button onClick={() => setShowSearch(v => !v)} style={{
              all: 'unset', cursor: 'pointer', marginLeft: 'auto',
              color: 'var(--green)', fontSize: 10, letterSpacing: '0.05em',
            }}>
              + ADD STATION
            </button>
          )}
        </div>

        {showSearch && (
          <div style={{ marginBottom: 16 }}>
            <StationSearchInput
              placeholder="Search station or NYC address..."
              onSelect={addStop}
            />
          </div>
        )}

        {stations.length === 0 ? (
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
