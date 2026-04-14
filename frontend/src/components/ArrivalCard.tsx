import { useEffect, useRef, useState } from 'react'
import type { ArrivalEntry, LineHealthEntry } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'
import { LineBadge } from './LineBadge'
import { DelayBadge } from './DelayBadge'
import { directionLabel } from '../constants/stops'
import { useNow } from '../hooks/useNow'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface Props {
  station: SavedStation
  arrivals: ArrivalEntry[]
  onRemove: () => void
  lastUpdate?: Date | null
  corrections: Record<string, number>
  lineHealth?: LineHealthEntry[]
  walkMin?: number
}

/** Apply learned per-route correction to a scheduled arrival ISO string.
 *  Returns a new ISO string shifted by correction_sec. */
function applyCorrection(isoTime: string, correctionSec: number): string {
  const ms = new Date(isoTime).getTime() + correctionSec * 1000
  return new Date(ms).toISOString()
}

export function formatCountdown(isoTime: string, now: number): string {
  const ms = new Date(isoTime).getTime() - now
  if (ms <= 0) return 'NOW'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function submitFeedback(stopId: string, routeId: string, scheduledArrival: string, trainPresent: boolean) {
  fetch('/api/feedback/arrival', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stop_id: stopId,
      route_id: routeId,
      scheduled_arrival: scheduledArrival,
      train_present: trainPresent,
    }),
  }).catch(() => {/* fire and forget */})
}

// Per-arrival feedback state: 'pending' = showing prompt, 'done' = answered or timed out
type FeedbackStatus = 'pending' | 'done'

/** Returns true when a route's current headway is >1.8× scheduled (trains bunching). */
function isCrowded(routeId: string, lineHealth: LineHealthEntry[]): boolean {
  const h = lineHealth.find(e => e.route_id === routeId)
  if (!h || h.current_headway_sec == null || h.scheduled_headway_sec == null) return false
  return h.current_headway_sec > 1.8 * h.scheduled_headway_sec
}

export function ArrivalCard({ station, arrivals, onRemove, lastUpdate, corrections, lineHealth = [], walkMin }: Props) {
  const now = useNow()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const tilesRef = useRef<(HTMLDivElement | null)[]>([])
  // keyed by arrival_time ISO
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackStatus>>({})
  const dismissTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const firstDelay = arrivals[0]?.delay_sec ?? 0
  const hasDelay = firstDelay > 30
  const isDisrupted = firstDelay > 300

  // Trigger feedback prompt when a tile hits NOW
  useEffect(() => {
    for (const a of arrivals.slice(0, 3)) {
      const corrected = applyCorrection(a.arrival_time, corrections[a.route_id] ?? 0)
      const ms = new Date(corrected).getTime() - now
      if (ms <= 0 && !feedbackMap[a.arrival_time]) {
        setFeedbackMap(prev => ({ ...prev, [a.arrival_time]: 'pending' }))
        // Auto-dismiss after 30s if unanswered
        dismissTimers.current[a.arrival_time] = setTimeout(() => {
          setFeedbackMap(prev =>
            prev[a.arrival_time] === 'pending'
              ? { ...prev, [a.arrival_time]: 'done' }
              : prev
          )
        }, 30_000)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now])

  // Clear timers on unmount
  useEffect(() => {
    const timers = dismissTimers.current
    return () => { Object.values(timers).forEach(clearTimeout) }
  }, [])

  useEffect(() => {
    if (!lastUpdate) return
    tilesRef.current.forEach(el => {
      if (!el) return
      el.classList.remove('pulse', 'pulse-amber')
      void el.offsetWidth
      el.classList.add(hasDelay ? 'pulse-amber' : 'pulse')
    })
  }, [lastUpdate, hasDelay])

  function answerFeedback(arrival: ArrivalEntry, present: boolean) {
    clearTimeout(dismissTimers.current[arrival.arrival_time])
    setFeedbackMap(prev => ({ ...prev, [arrival.arrival_time]: 'done' }))
    submitFeedback(station.stop_id, arrival.route_id, arrival.arrival_time, present)
  }

  return (
    <div className={`card ${hasDelay ? (isDisrupted ? 'card-disrupted' : 'card-delayed') : ''}`}
         style={{ marginBottom: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {station.route_ids.map(r => <LineBadge key={r} routeId={r} />)}
        </div>
        <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {station.name.toUpperCase()}
        </span>
        {hasDelay && <DelayBadge delaySec={firstDelay} />}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
          {directionLabel(station.direction, station.route_ids[0]?.toUpperCase() ?? '')}
        </span>
        <button onClick={onRemove} style={{
          all: 'unset', cursor: 'pointer', color: 'var(--text-faint)',
          fontSize: 10, marginLeft: 8,
        }}>✕</button>
      </div>

      {/* Countdown tiles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {arrivals.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>NO SERVICE DATA</div>
          ) : (
            arrivals.slice(0, 3).map((a, i) => {
              const corrected = applyCorrection(a.arrival_time, corrections[a.route_id] ?? 0)
              const countdown = formatCountdown(corrected, now)
              const isNext = i === 0
              const fbStatus = feedbackMap[a.arrival_time]
              const crowded = isNext && isCrowded(a.route_id, lineHealth)
              return (
                <div
                  key={a.arrival_time}
                  ref={el => { tilesRef.current[i] = el }}
                  style={{
                    background: isNext ? (hasDelay ? 'var(--amber-dim)' : 'var(--green-dim)') : 'var(--bg)',
                    border: `1px solid ${isNext ? (hasDelay ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)'}`,
                    borderRadius: 3,
                    padding: isMobile ? '12px 14px' : '8px 10px',
                    textAlign: 'center',
                    minWidth: isMobile ? 64 : 52,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <LineBadge routeId={a.route_id} size={14} />
                  <div style={{
                    fontSize: countdown === 'NOW' ? 16 : 18,
                    fontWeight: 700,
                    fontFamily: 'inherit',
                    color: isNext ? (hasDelay ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)',
                    letterSpacing: '-0.02em',
                  }}>
                    {countdown}
                  </div>
                  {/* Crowding indicator */}
                  {crowded && (
                    <span style={{ fontSize: 8, letterSpacing: '0.08em', color: 'var(--amber)', lineHeight: 1 }}>
                      LIKELY CROWDED
                    </span>
                  )}
                  {/* Feedback prompt */}
                  {countdown === 'NOW' && fbStatus === 'pending' && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginTop: 2 }}>
                      <span style={{ fontSize: 8, letterSpacing: '0.08em', color: 'var(--text-faint)' }}>HERE?</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => answerFeedback(a, true)}
                          style={{
                            all: 'unset', cursor: 'pointer',
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                            padding: '2px 6px', borderRadius: 2,
                            background: 'var(--green-dim)', border: '1px solid var(--green-border)',
                            color: 'var(--green)',
                          }}>Y</button>
                        <button
                          onClick={() => answerFeedback(a, false)}
                          style={{
                            all: 'unset', cursor: 'pointer',
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                            padding: '2px 6px', borderRadius: 2,
                            background: 'var(--red-dim)', border: '1px solid var(--red-border)',
                            color: 'var(--red)',
                          }}>N</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Departure timer — only when walkMin is provided and there are arrivals */}
        {walkMin != null && arrivals.length > 0 && (() => {
          const corrected = applyCorrection(arrivals[0].arrival_time, corrections[arrivals[0].route_id] ?? 0)
          const msUntil = new Date(corrected).getTime() - now
          const leaveInMs = msUntil - walkMin * 60_000
          return (
            <div style={{ fontSize: 8, letterSpacing: '0.08em', lineHeight: 1, color: leaveInMs <= 0 ? 'var(--amber)' : 'var(--green)' }}>
              {leaveInMs <= 0
                ? 'LEAVE NOW'
                : `LEAVE IN ${Math.ceil(leaveInMs / 60_000)}m`}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
