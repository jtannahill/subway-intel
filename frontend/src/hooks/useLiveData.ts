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
  current_headway_sec: number | null
  scheduled_headway_sec: number | null
}

export interface VehiclePositionEntry {
  trip_id: string
  route_id: string
  stop_id: string
  status: 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT'
  prev_stop_id: string | null
  next_arrival_iso: string | null
  prev_arrival_iso: string | null
  /** [[lon,lat], ...] shape segment from prev_stop → this stop for path interpolation */
  segment_coords?: [number, number][]
}

export interface BunchEvent {
  route_id: string
  trip_ids: [string, string]
  stop_ids: [string, string]
}

export interface LiveData {
  arrivals: Record<string, ArrivalEntry[]>  // stop_id → arrivals
  lineHealth: LineHealthEntry[]
  vehiclePositions: VehiclePositionEntry[]
  bunches: BunchEvent[]
  connected: boolean
  lastUpdate: Date | null
}

const INITIAL: LiveData = {
  arrivals: {},
  lineHealth: [],
  vehiclePositions: [],
  bunches: [],
  connected: false,
  lastUpdate: null,
}

export function useLiveData(): LiveData {
  const [data, setData] = useState<LiveData>(INITIAL)

  const onMessage = useCallback((msg: unknown) => {
    const m = msg as {
      type: string
      arrivals?: Record<string, ArrivalEntry[]>
      line_health?: LineHealthEntry[]
      vehicle_positions?: VehiclePositionEntry[]
      bunches?: BunchEvent[]
    }
    if (m.type === 'snapshot') {
      setData({
        arrivals: m.arrivals ?? {},
        lineHealth: m.line_health ?? [],
        vehiclePositions: m.vehicle_positions ?? [],
        bunches: m.bunches ?? [],
        connected: true,
        lastUpdate: new Date(),
      })
    }
  }, [])

  useWebSocket(onMessage)
  return data
}
