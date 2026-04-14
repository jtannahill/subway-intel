import { useState, useCallback } from 'react'
import { StationSearchInput } from '../components/StationSearchInput'
import { LineBadge } from '../components/LineBadge'

interface Stop {
  stop_id: string
  name: string
}

interface TripOption {
  departure_time: string
  arrival_time: string
  duration_min: number
  route_ids: string[]
  transfers?: { stop_name: string; route_ids: string[] }[]
}

interface TripResult {
  options: TripOption[]
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch {
    return iso
  }
}

export function PlanView() {
  const [origin, setOrigin] = useState<Stop | null>(null)
  const [destination, setDestination] = useState<Stop | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TripResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const plan = useCallback(async () => {
    if (!origin || !destination) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/commute?origin=${origin.stop_id}&destination=${destination.stop_id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as TripResult
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to plan trip.')
    } finally {
      setLoading(false)
    }
  }, [origin, destination])

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div style={{ marginBottom: 8 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>PLAN A TRIP</span>
      </div>
      <div style={{ color: 'var(--text-faint)', fontSize: 10, marginBottom: 20 }}>
        Search origin and destination, then get departure options.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
        {/* Origin */}
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.12em', color: 'var(--text-faint)', marginBottom: 6 }}>FROM</div>
          <StationSearchInput
            placeholder="Origin station or address…"
            onSelect={(stop_id, name) => setOrigin({ stop_id, name })}
          />
          {origin && (
            <div style={{ fontSize: 9, color: 'var(--green)', marginTop: 4, letterSpacing: '0.05em' }}>
              ✓ {origin.name || origin.stop_id}
            </div>
          )}
        </div>

        {/* Destination */}
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.12em', color: 'var(--text-faint)', marginBottom: 6 }}>TO</div>
          <StationSearchInput
            placeholder="Destination station or address…"
            onSelect={(stop_id, name) => setDestination({ stop_id, name })}
          />
          {destination && (
            <div style={{ fontSize: 9, color: 'var(--green)', marginTop: 4, letterSpacing: '0.05em' }}>
              ✓ {destination.name || destination.stop_id}
            </div>
          )}
        </div>

        {/* Plan button */}
        <button
          onClick={plan}
          disabled={!origin || !destination || loading}
          style={{
            all: 'unset',
            cursor: (!origin || !destination || loading) ? 'default' : 'pointer',
            padding: '12px 24px',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            borderRadius: 3,
            background: (!origin || !destination || loading) ? 'var(--bg-surface)' : 'var(--green-dim)',
            border: `1px solid ${(!origin || !destination || loading) ? 'var(--border)' : 'var(--green-border)'}`,
            color: (!origin || !destination || loading) ? 'var(--text-faint)' : 'var(--green)',
            textAlign: 'center',
            transition: 'background 0.1s, color 0.1s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {loading ? 'PLANNING…' : 'PLAN TRIP'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 16, color: 'var(--red)', fontSize: 11 }}>{error}</div>
      )}

      {/* Results */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <div className="label" style={{ marginBottom: 12 }}>DEPARTURE OPTIONS</div>
          {result.options.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No routes found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
              {result.options.map((opt, i) => (
                <div key={i} style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: opt.transfers && opt.transfers.length > 0 ? 8 : 0 }}>
                    {/* Route badges */}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                      {opt.route_ids.map(rid => (
                        <LineBadge key={rid} routeId={rid} size={20} />
                      ))}
                    </div>

                    {/* Times */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                        {formatTime(opt.departure_time)}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>→</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                        {formatTime(opt.arrival_time)}
                      </span>
                    </div>

                    {/* Duration */}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', flexShrink: 0 }}>
                      {opt.duration_min}m
                    </span>
                  </div>

                  {/* Transfers */}
                  {opt.transfers && opt.transfers.map((t, j) => (
                    <div key={j} style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.07em', marginTop: 2 }}>
                      TRANSFER @ {t.stop_name}
                      {t.route_ids.length > 0 && (
                        <span style={{ marginLeft: 4, display: 'inline-flex', gap: 2, alignItems: 'center', verticalAlign: 'middle' }}>
                          → {t.route_ids.map(rid => <LineBadge key={rid} routeId={rid} size={12} />)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
