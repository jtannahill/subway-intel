import { useState, useCallback } from 'react'

export interface SavedStation {
  stop_id: string
  name: string
  direction: string  // 'N' or 'S'
  route_ids: string[]
}

const STORAGE_KEY = 'subway_intel_stations'
const MAX_STATIONS = 5

function loadFromStorage(): SavedStation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function useStations() {
  const [stations, setStations] = useState<SavedStation[]>(loadFromStorage)

  const addStation = useCallback((station: SavedStation) => {
    setStations((prev) => {
      if (prev.length >= MAX_STATIONS) return prev
      if (prev.some((s) => s.stop_id === station.stop_id && s.direction === station.direction)) return prev
      const next = [...prev, station]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeStation = useCallback((stop_id: string, direction: string) => {
    setStations((prev) => {
      const next = prev.filter((s) => !(s.stop_id === stop_id && s.direction === direction))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { stations, addStation, removeStation }
}
