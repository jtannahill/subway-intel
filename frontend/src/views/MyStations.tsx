import { useState } from 'react'
import { ArrivalCard } from '../components/ArrivalCard'
import { LineBadge } from '../components/LineBadge'
import { SignalStrip } from '../components/SignalStrip'
import { SmartCommute } from './SmartCommute'
import { StationSearchInput } from '../components/StationSearchInput'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useNow } from '../hooks/useNow'
import { formatCountdown } from '../components/ArrivalCard'

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
  const now = useNow()

  function onSelect(stop_id: string, name: string) {
    setPending({ stop_id, name })
  }

  function addWithDirection(dir: 'N' | 'S' | 'both') {
    if (!pending) return
    if (dir === 'both') {
      addStation({ stop_id: pending.stop_id + 'N', name: pending.name, direction: 'N', route_ids: [] })
      addStation({ stop_id: pending.stop_id + 'S', name: pending.name, direction: 'S', route_ids: [] })
    } else {
      addStation({ stop_id: pending.stop_id + dir, name: pending.name, direction: dir, route_ids: [] })
    }
    setPending(null)
    setShowSearch(false)
  }

  function cancelAdd() {
    setPending(null)
    setShowSearch(false)
  }

  // Group stations by base stop_id so N+S for the same station render together
  const grouped = stations.reduce<SavedStation[][]>((acc, s) => {
    const base = s.stop_id.slice(0, -1)
    const last = acc[acc.length - 1]
    if (last && last[0].stop_id.slice(0, -1) === base) {
      last.push(s)
    } else {
      acc.push([s])
    }
    return acc
  }, [])

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => addWithDirection('both')} style={{
                all: 'unset', cursor: 'pointer',
                padding: '10px 0', textAlign: 'center',
                fontSize: 10, letterSpacing: '0.07em', fontFamily: 'inherit',
                borderRadius: 3,
                background: 'var(--green-dim)', border: '1px solid var(--green-border)',
                color: 'var(--green)', fontWeight: 700,
                WebkitTapHighlightColor: 'transparent',
              }}>
                ↑↓ BOTH DIRECTIONS
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => addWithDirection('N')} style={{
                  all: 'unset', cursor: 'pointer', flex: 1,
                  padding: '8px 0', textAlign: 'center',
                  fontSize: 9, letterSpacing: '0.07em', fontFamily: 'inherit',
                  borderRadius: 3,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', fontWeight: 700,
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  ↑ UPTOWN ONLY
                </button>
                <button onClick={() => addWithDirection('S')} style={{
                  all: 'unset', cursor: 'pointer', flex: 1,
                  padding: '8px 0', textAlign: 'center',
                  fontSize: 9, letterSpacing: '0.07em', fontFamily: 'inherit',
                  borderRadius: 3,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', fontWeight: 700,
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  ↓ DOWNTOWN ONLY
                </button>
              </div>
            </div>
          </div>
        )}

        {stations.length === 0 && !showSearch ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 40, textAlign: 'center' }}>
            No stations saved. Click + ADD STATION to get started.
          </div>
        ) : (
          grouped.map(group => (
            <div key={group[0].stop_id.slice(0, -1)} style={{ marginBottom: 8 }}>
              {group.length === 2 ? (
                // Paired N+S — render under a shared station header
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '8px 12px', borderBottom: '1px solid var(--border)',
                    fontSize: 11, color: 'var(--text-primary)', letterSpacing: '0.04em',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    {group[0].name.toUpperCase()}
                    <button
                      onClick={() => { removeStation(group[0].stop_id, group[0].direction); removeStation(group[1].stop_id, group[1].direction) }}
                      style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 10 }}
                    >✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                    {group.map((s, i) => (
                      <div key={s.stop_id} style={{
                        padding: '10px 12px',
                        borderRight: i === 0 ? '1px solid var(--border)' : 'none',
                      }}>
                        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em', marginBottom: 6 }}>
                          {s.direction === 'N' ? '↑ UPTOWN' : '↓ DOWNTOWN'}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {(liveData.arrivals[s.stop_id] ?? []).length === 0 ? (
                            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>NO DATA</div>
                          ) : (
                            (liveData.arrivals[s.stop_id] ?? []).slice(0, 3).map((a) => {
                              const correctionSec = corrections[a.route_id] ?? 0
                              const corrected = new Date(new Date(a.arrival_time).getTime() + correctionSec * 1000).toISOString()
                              const countdown = formatCountdown(corrected, now)
                              const isFirst = a === (liveData.arrivals[s.stop_id] ?? [])[0]
                              const hasDelay = a.delay_sec > 30
                              return (
                                <div key={a.arrival_time} style={{
                                  background: isFirst ? (hasDelay ? 'var(--amber-dim)' : 'var(--green-dim)') : 'var(--bg)',
                                  border: `1px solid ${isFirst ? (hasDelay ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)'}`,
                                  borderRadius: 3, padding: '6px 8px', textAlign: 'center', minWidth: 44,
                                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                                }}>
                                  <LineBadge routeId={a.route_id} size={12} />
                                  <div style={{
                                    fontSize: 14, fontWeight: 700,
                                    color: isFirst ? (hasDelay ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)',
                                    letterSpacing: '-0.02em',
                                  }}>{countdown}</div>
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // Single direction — render normal ArrivalCard
                <ArrivalCard
                  station={group[0]}
                  arrivals={liveData.arrivals[group[0].stop_id] ?? []}
                  onRemove={() => removeStation(group[0].stop_id, group[0].direction)}
                  lastUpdate={liveData.lastUpdate}
                  corrections={corrections}
                />
              )}
            </div>
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
