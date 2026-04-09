import { useState } from 'react'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[] }
}

interface CommuteResult {
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
  const [result, setResult] = useState<CommuteResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [originResults, setOriginResults] = useState<{ stop_id: string; name: string }[]>([])
  const [destResults, setDestResults] = useState<{ stop_id: string; name: string }[]>([])
  const [originName, setOriginName] = useState('')
  const [destName, setDestName] = useState('')

  // Available for future use (e.g. pre-populate from saved stations)
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
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch(`/api/commute?origin=${origin}&destination=${dest}`)
      if (!res.ok) { setError('No route found between these stops.'); return }
      setResult(await res.json())
    } catch { setError('Network error — is the backend running?') }
    finally { setLoading(false) }
  }

  const leaveInMin = result ? Math.round(result.leave_in_sec / 60) : null

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
            color: 'var(--text-primary)', fontSize: 12 }} />
        {originResults.map(r => (
          <button key={r.stop_id} onClick={() => { setOrigin(r.stop_id + 'N'); setOriginName(r.name); setOriginResults([]) }}
            style={{ all: 'unset', display: 'block', width: '100%', padding: '8px 12px', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 11, background: 'var(--bg-elevated)',
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
            color: 'var(--text-primary)', fontSize: 12 }} />
        {destResults.map(r => (
          <button key={r.stop_id} onClick={() => { setDest(r.stop_id + 'N'); setDestName(r.name); setDestResults([]) }}
            style={{ all: 'unset', display: 'block', width: '100%', padding: '8px 12px', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 11, background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)' }}>
            {r.name}
          </button>
        ))}
      </div>

      <button onClick={calculate} disabled={loading} style={{
        all: 'unset', cursor: loading ? 'default' : 'pointer',
        background: 'var(--green-dim)', border: '1px solid var(--green-border)',
        borderRadius: 3, padding: '10px 20px', color: 'var(--green)',
        fontSize: 11, letterSpacing: '0.05em',
      }}>
        {loading ? 'CALCULATING...' : 'CALCULATE'}
      </button>

      {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 12 }}>{error}</div>}

      {result && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="label" style={{ marginBottom: 16 }}>RECOMMENDATION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
            <span className="mono-lg" style={{ fontSize: 48, color: 'var(--green)' }}>{leaveInMin}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>minutes to leave</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.8 }}>
            Take the <span style={{ color: 'var(--text-primary)' }}>{result.route_id}</span> at{' '}
            <span style={{ color: 'var(--text-primary)' }}>{fmt(result.board_at)}</span>
            {result.delay_sec > 30 && (
              <span style={{ color: 'var(--amber)' }}> (+{Math.round(result.delay_sec / 60)}m delay)</span>
            )}
            <br />
            Arrives at <span style={{ color: 'var(--text-primary)' }}>{fmt(result.arrive_at)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
