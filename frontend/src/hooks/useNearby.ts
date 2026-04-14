import { useState, useRef, useCallback, useEffect } from 'react'

export interface NearbyStation {
  stop_id: string
  name: string
  distance_mi: number
  route_ids: string[]
}

export type NearbyStatus =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'tracking'; stations: NearbyStation[]; coords: { lat: number; lon: number } | null; manual: boolean }
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

export function useNearby(): { state: NearbyStatus; start: () => void; select: (stop_id: string, name: string) => void; reset: () => void } {
  const [state, setState] = useState<NearbyStatus>({ status: 'idle' })

  const watchIdRef = useRef<number | null>(null)
  const lastFetchCoordsRef = useRef<Coords | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
    lastFetchCoordsRef.current = null
  }, [])

  const onError = useCallback((err: GeolocationPositionError) => {
    let message: string
    switch (err.code) {
      case err.PERMISSION_DENIED:
        message = 'Location access denied. Enable in Settings → Privacy → Location.'
        break
      case err.POSITION_UNAVAILABLE:
        message = 'Location unavailable. Try outdoors or search a station above.'
        break
      case err.TIMEOUT:
        message = 'Location timed out. Try again or search a station above.'
        break
      default:
        message = 'Location error. Try searching a station above.'
    }
    setState({ status: 'error', message })
  }, [])

  const fetchNearest = useCallback((lat: number, lon: number) => {
    const current: Coords = { lat, lon }

    if (lastFetchCoordsRef.current !== null) {
      const moved = metresBetween(lastFetchCoordsRef.current, current)
      if (moved < THRESHOLD_M) return
    }

    lastFetchCoordsRef.current = current

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    fetch(`/api/stops/nearest?lat=${lat}&lon=${lon}&limit=3`, { signal: abortRef.current.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ results: NearbyStation[] }>
      })
      .then(({ results }) => {
        if (results.length === 0) {
          setState({ status: 'error', message: 'No stations found nearby.' })
        } else {
          setState({ status: 'tracking', stations: results, coords: { lat, lon }, manual: false })
        }
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setState({ status: 'error', message: 'Failed to fetch nearest station.' })
      })
  }, [])

  const onSuccess = useCallback((pos: GeolocationPosition) => {
    fetchNearest(pos.coords.latitude, pos.coords.longitude)
  }, [fetchNearest])

  const start = useCallback(() => {
    if (!navigator?.geolocation) {
      setState({ status: 'error', message: 'Geolocation not supported. Search a station above.' })
      return
    }

    setState({ status: 'locating' })
    stopWatch()

    const watchOpts: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    }

    try {
      // getCurrentPosition fires immediately (cache or fast GPS fix)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fetchNearest(pos.coords.latitude, pos.coords.longitude)
          try {
            watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, watchOpts)
          } catch {
            // watchPosition unsupported — one-shot result is still shown
          }
        },
        (_err) => {
          // First-shot failed; let watchPosition surface the real error
          try {
            watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, watchOpts)
          } catch {
            setState({ status: 'error', message: 'Location unavailable. Search a station above.' })
          }
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
      )
    } catch {
      setState({ status: 'error', message: 'Location unavailable. Search a station above.' })
    }
  }, [onSuccess, onError, fetchNearest, stopWatch])

  /** Manually select a station (e.g. from the search box) without GPS. */
  const select = useCallback((stop_id: string, name: string) => {
    stopWatch()
    setState({
      status: 'tracking',
      stations: [{ stop_id, name, distance_mi: 0, route_ids: [] }],
      coords: null,
      manual: true,
    })
  }, [stopWatch])

  const reset = useCallback(() => {
    stopWatch()
    setState({ status: 'idle' })
  }, [stopWatch])

  useEffect(() => {
    return () => stopWatch()
  }, [stopWatch])

  return { state, start, select, reset }
}
