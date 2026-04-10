import { useState } from 'react'
import { ArrivalCard } from '../components/ArrivalCard'
import { SignalStrip } from '../components/SignalStrip'
import { SmartCommute } from './SmartCommute'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[]; addStation: (s: SavedStation) => void; removeStation: (id: string, dir: string) => void }
}

export function MyStations({ liveData, stationsCtx }: Props) {
  const { stations, addStation, removeStation } = stationsCtx
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<{ stop_id: string; name: string }[]>([])
  const [showSearch, setShowSearch] = useState(false)

  async function handleSearch(q: string) {
    setSearchQ(q)
    if (q.length < 2) { setSearchResults([]); return }
    const res = await fetch(`/api/stops/search?q=${encodeURIComponent(q)}&limit=8`)
    const data = await res.json()
    setSearchResults(data.results ?? [])
  }

  function addStop(stop: { stop_id: string; name: string }) {
    addStation({ stop_id: stop.stop_id + 'N', name: stop.name, direction: 'N', route_ids: [] })
    setShowSearch(false)
    setSearchQ('')
    setSearchResults([])
  }

  return (
    // Span both grid columns, then create inner 2-col layout
    <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

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
            <input
              autoFocus
              value={searchQ}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search stations..."
              style={{
                all: 'unset', display: 'block', width: '100%',
                background: 'var(--bg-surface)', border: '1px solid var(--green-border)',
                borderRadius: 3, padding: '8px 12px',
                color: 'var(--text-primary)', fontSize: 12, marginBottom: 4,
              }}
            />
            {searchResults.map(r => (
              <button key={r.stop_id} onClick={() => addStop(r)} style={{
                all: 'unset', display: 'block', width: '100%',
                padding: '8px 12px', cursor: 'pointer',
                color: 'var(--text-primary)', fontSize: 11,
                background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
              }}>
                {r.name} <span style={{ color: 'var(--text-faint)' }}>{r.stop_id}</span>
              </button>
            ))}
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
