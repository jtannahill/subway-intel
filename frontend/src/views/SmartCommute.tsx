import { useState } from 'react'
import { LineBadge } from '../components/LineBadge'
import { StationSearchInput } from '../components/StationSearchInput'
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

interface TransferInfo {
  at: string
  leg1_min: number
  leg2_min: number
}

function fmt(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function SmartCommute({ liveData, stationsCtx }: Props) {
  const [origin, setOrigin] = useState('')
  const [dest, setDest] = useState('')
  const [options, setOptions] = useState<CommuteOption[]>([])
  const [transfer, setTransfer] = useState<TransferInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  void stationsCtx

  async function calculate() {
    if (!origin || !dest) { setError('Select both origin and destination.'); return }
    setLoading(true); setError(''); setOptions([]); setTransfer(null)
    try {
      const res = await fetch(`/api/commute?origin=${origin}&destination=${dest}`)
      if (!res.ok) { setError('No route found. Try different stations.'); return }
      const data = await res.json()
      setOptions(data.options ?? [])
      setTransfer(data.transfer ?? null)
    } catch { setError('Network error — is the backend running?') }
    finally { setLoading(false) }
  }

  return (
    <div>
      {/* Origin */}
      <div style={{ marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 6 }}>FROM</div>
        <StationSearchInput
          placeholder="Search origin station or address..."
          onSelect={(stop_id) => setOrigin(stop_id + 'N')} // 'N' direction hardcoded; direction UI out of scope
        />
      </div>

      {/* Destination */}
      <div style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>TO</div>
        <StationSearchInput
          placeholder="Search destination station or address..."
          onSelect={(stop_id) => setDest(stop_id + 'N')} // 'N' direction hardcoded; direction UI out of scope
        />
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

      {transfer && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 3,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ color: 'var(--amber)', fontSize: 10, letterSpacing: '0.06em' }}>
            ⇄ 1 TRANSFER REQUIRED
          </div>
          <div>
            Transfer at <span style={{ color: 'var(--text-primary)' }}>{transfer.at}</span>
          </div>
          <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>
            {transfer.leg1_min} min to transfer station · {transfer.leg2_min} min to destination
          </div>
        </div>
      )}

      {options.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="label" style={{ marginBottom: 12 }}>DEPARTURES</div>
          {options.map((opt, i) => {
            const leaveInMin = Math.round(opt.leave_in_sec / 60)
            const isNow = leaveInMin === 0
            const isFirst = i === 0
            return (
              <div key={opt.trip_id} className="card" style={{
                marginBottom: 8,
                borderColor: isFirst ? (isNow ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)',
                opacity: isFirst ? 1 : 0.7,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ minWidth: 80, textAlign: 'center' }}>
                    {isNow ? (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: 'var(--amber)', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}>
                          LEAVE NOW
                        </div>
                        <div style={{ color: 'var(--text-faint)', fontSize: 9, letterSpacing: '0.06em', marginTop: 2 }}>
                          TRAIN BOARDS &lt;1 MIN
                        </div>
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
                  <div style={{ width: 1, height: 40, background: 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <LineBadge routeId={opt.route_id} size={20} />
                      <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>
                        {'board '}<span style={{ color: 'var(--green)' }}>{fmt(opt.board_at)}</span>
                      </span>
                      {opt.delay_sec > 30 && (
                        <span style={{ color: 'var(--amber)', fontSize: 12 }}>+{Math.round(opt.delay_sec / 60)}m delay</span>
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

      {options.length > 0 && (() => {
        const routeIds = [...new Set(options.map(o => o.route_id))]
        const statuses = routeIds
          .map(rid => liveData.lineHealth.find(h => h.route_id === rid))
          .filter((h): h is NonNullable<typeof h> => !!h)
        if (statuses.length === 0) return null

        const disrupted = statuses.find(h => h.status === 'DISRUPTED')
        const delayed = statuses.find(h => h.status === 'DELAYED')
        const worst = disrupted ?? delayed

        return (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {worst && (
              <div style={{
                padding: '8px 12px', borderRadius: 3,
                background: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
                color: 'var(--amber)', fontSize: 11, letterSpacing: '0.04em',
              }}>
                ⚠ Route affected — {worst.route_id} is {worst.status.toLowerCase()}
                {worst.alerts.length > 0 && ` · ${worst.alerts.length} alert${worst.alerts.length > 1 ? 's' : ''}`}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {statuses.map(h => {
                const color = h.status === 'DISRUPTED' ? 'var(--red)' : h.status === 'DELAYED' ? 'var(--amber)' : 'var(--green)'
                const bg = h.status === 'DISRUPTED' ? 'var(--red-dim)' : h.status === 'DELAYED' ? 'var(--amber-dim)' : 'var(--green-dim)'
                const border = h.status === 'DISRUPTED' ? 'var(--red-border)' : h.status === 'DELAYED' ? 'var(--amber-border)' : 'var(--green-border)'
                return (
                  <div key={h.route_id} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 8px', borderRadius: 2,
                    background: bg, border: `1px solid ${border}`,
                  }}>
                    <LineBadge routeId={h.route_id} size={14} />
                    <span style={{ color, fontSize: 9, letterSpacing: '0.06em' }}>{h.status}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
