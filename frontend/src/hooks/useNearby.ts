import { useState, useRef, useCallback, useEffect } from 'react'

export interface NearbyStation {
  stop_id: string
  name: string
  distance_mi: number
}

export type NearbyStatus =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'tracking'; station: NearbyStation; coords: { lat: number; lon: number } }
  | { status: 'error'; message: string }

interface Coords {
  lat: number
  lon: number
}

function metresBetween(a: Coords, b: Coords): number {
  const dlat = b.lat - a.lat
  const dlon = b.lon - a.lon
  return Math.sqrt((dlat * 69) ** 2 + (dlon * 52.5) ** 2) * 1609
}

const THRESHOLD_M = 150

export function useNearby(): { state: NearbyStatus; start: () => void } {
  const [state, setState] = useState<NearbyStatus>({ status: 'idle' })

  const watchIdRef = useRef<number | null>(null)
  const lastFetchCoordsRef = useRef<Coords | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const onError = useCallback((err: GeolocationPositionError) => {
    let message: string
    switch (err.code) {
      case err.PERMISSION_DENIED:
        message = 'Location access denied. Enable in browser settings.'
        break
      case err.POSITION_UNAVAILABLE:
        message = 'Location unavailable. Try again outside.'
        break
      case err.TIMEOUT:
        message = 'Location timed out. Try again.'
        break
      default:
        message = 'Unknown location error.'
    }
    setState({ status: 'error', message })
  }, [])

  const onSuccess = useCallback((pos: GeolocationPosition) => {
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude
    const current: Coords = { lat, lon }

    if (lastFetchCoordsRef.current !== null) {
      const moved = metresBetween(lastFetchCoordsRef.current, current)
      if (moved < THRESHOLD_M) return
    }

    lastFetchCoordsRef.current = current

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    fetch(`/api/stops/nearest?lat=${lat}&lon=${lon}&limit=1`, { signal: abortRef.current.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<NearbyStation[]>
      })
      .then((results: NearbyStation[]) => {
        if (results.length === 0) {
          setState({ status: 'error', message: 'No stations found nearby.' })
        } else {
          setState({ status: 'tracking', station: results[0], coords: { lat, lon } })
        }
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setState({ status: 'error', message: 'Failed to fetch nearest station.' })
      })
  }, [])

  const start = useCallback(() => {
    setState({ status: 'locating' })

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }

    lastFetchCoordsRef.current = null

    watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: false,
      maximumAge: 10000,
    })
  }, [onSuccess, onError])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      abortRef.current?.abort()
    }
  }, [])

  return { state, start }
}
