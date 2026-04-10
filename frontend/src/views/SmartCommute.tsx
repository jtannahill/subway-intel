import { useState } from 'react'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[] }
}

interface CommuteOption {
  leave_in_sec: number
  board_at: string
  arrive_at: string
  route_id: string
  trip_id: string
  delay_sec: number
}

function fmt(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function SmartCommute({ liveData, stationsCtx }: Props) {
  const [origin, setOrigin] = useState('')
  const [dest, setDest] = useState('')
  const [options, setOptions] = useState<CommuteOption[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [originResults, setOriginResults] = useState<{ stop_id: string; name: string }[]>([])
  const [destResults, setDestResults] = useState<{ stop_id: string; name: string }[]>([])
  const [originName, setOriginName] = useState('')
  const [destName, setDestName] = useState('')

  void liveData
  void stationsCtx

  async function searchStops(q: string, setter: typeof setOriginResults) {
    if (q.length < 2) { setter([]); return }
    const res = await fetch(`/api/stops/search?q=${encodeURIComponent(q)}&limit=6`)
    const data = await res.json()
    setter(data.results ?? [])
  }

  async function calculate() {
    if (!origin || !dest) { setError('Select both origin and destination.'); return }
    setLoading(true); setError(''); setOptions([])
    try {
      const res = await fetch(`/api/commute?origin=${origin}&destination=${dest}`)
      if (!res.ok) { setError('No route found between these stops.'); return }
      const data = await res.json()
      setOptions(data.options ?? [])
    } catch { setError('Network error — is the backend running?') }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>SMART COMMUTE</span>
      </div>

      {/* Origin */}
      <div style={{ marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 6 }}>FROM</div>
        <input value={originName} onChange={e => { setOriginName(e.target.value); searchStops(e.target.value, setOriginResults) }}
          placeholder="Search origin station..."
          style={{ all: 'unset', display: 'block', width: '100%', background: 'var(--bg-surface)',
            border: '1px solid var(--border)', borderRadius: 3, padding: '8px 12px',
            color: 'var(--text-primary)', fontSize: 14 }} />
        {originResults.map(r => (
          <button key={r.stop_id} onClick={() => { setOrigin(r.stop_id + 'N'); setOriginName(r.name); setOriginResults([]) }}
            style={{ all: 'unset', display: 'block', width: '100%', padding: '8px 12px', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 13, background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)' }}>
            {r.name}
          </button>
        ))}
      </div>

      {/* Destination */}
      <div style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>TO</div>
        <input value={destName} onChange={e => { setDestName(e.target.value); searchStops(e.target.value, setDestResults) }}
          placeholder="Search destination station..."
          style={{ all: 'unset', display: 'block', width: '100%', background: 'var(--bg-surface)',
            border: '1px solid var(--border)', borderRadius: 3, padding: '8px 12px',
            color: 'var(--text-primary)', fontSize: 14 }} />
        {destResults.map(r => (
          <button key={r.stop_id} onClick={() => { setDest(r.stop_id + 'N'); setDestName(r.name); setDestResults([]) }}
            style={{ all: 'unset', display: 'block', width: '100%', padding: '8px 12px', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 13, background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)' }}>
            {r.name}
          </button>
        ))}
      </div>

      <button onClick={calculate} disabled={loading} style={{
        all: 'unset', cursor: loading ? 'default' : 'pointer',
        background: 'var(--green-dim)', border: '1px solid var(--green-border)',
        borderRadius: 3, padding: '10px 20px', color: 'var(--green)',
        fontSize: 13, letterSpacing: '0.05em',
      }}>
        {loading ? 'CALCULATING...' : 'CALCULATE'}
      </button>

      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}

      {options.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="label" style={{ marginBottom: 12 }}>DEPARTURES</div>
          {options.map((opt, i) => {
            const leaveInMin = Math.round(opt.leave_in_sec / 60)
            const isNow = leaveInMin === 0
            const isFirst = i === 0
            return (
              <div key={opt.trip_id} className={`card ${isFirst ? '' : ''}`} style={{
                marginBottom: 8,
                borderColor: isFirst ? (isNow ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)',
                opacity: isFirst ? 1 : 0.7,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Leave in */}
                  <div style={{ minWidth: 80, textAlign: 'center' }}>
                    {isNow ? (
                      <div style={{ color: 'var(--amber)', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}>
                        LEAVE NOW
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: isFirst ? 40 : 28, fontWeight: 700, color: isFirst ? 'var(--green)' : 'var(--text-muted)', lineHeight: 1 }}>
                          {leaveInMin}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>min to leave</div>
                      </>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ width: 1, height: 40, background: 'var(--border)' }} />

                  {/* Details */}
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700 }}>{opt.route_id}</span>
                      {' train · board '}<span style={{ color: 'var(--green)' }}>{fmt(opt.board_at)}</span>
                      {opt.delay_sec > 30 && (
                        <span style={{ color: 'var(--amber)', fontSize: 12 }}> +{Math.round(opt.delay_sec / 60)}m delay</span>
                      )}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      Arrives {fmt(opt.arrive_at)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
