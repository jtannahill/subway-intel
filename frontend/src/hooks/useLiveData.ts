import { useState, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'

export interface ArrivalEntry {
  route_id: string
  arrival_time: string
  delay_sec: number
  direction: string
}

export interface LineHealthEntry {
  route_id: string
  status: 'NOMINAL' | 'DELAYED' | 'DISRUPTED'
  avg_delay_sec: number
  headway_variance: number
  alerts: string[]
}

export interface LiveData {
  arrivals: Record<string, ArrivalEntry[]>  // stop_id → arrivals
  lineHealth: LineHealthEntry[]
  connected: boolean
  lastUpdate: Date | null
}

const INITIAL: LiveData = {
  arrivals: {},
  lineHealth: [],
  connected: false,
  lastUpdate: null,
}

export function useLiveData(): LiveData {
  const [data, setData] = useState<LiveData>(INITIAL)

  const onMessage = useCallback((msg: unknown) => {
    const m = msg as { type: string; arrivals?: Record<string, ArrivalEntry[]>; line_health?: LineHealthEntry[] }
    if (m.type === 'snapshot') {
      setData({
        arrivals: m.arrivals ?? {},
        lineHealth: m.line_health ?? [],
        connected: true,
        lastUpdate: new Date(),
      })
    }
  }, [])

  useWebSocket(onMessage)
  return data
}
