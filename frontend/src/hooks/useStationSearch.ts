import { useState, useEffect, useRef } from 'react'

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) ?? ''
const NYC_BBOX = '-74.26,40.48,-73.70,40.92'

export interface StationResult {
  stop_id: string
  name: string
  lat: number
  lon: number
}

export interface AddressResult {
  place_name: string
  lat: number
  lon: number
}

export interface SearchResults {
  stations: StationResult[]
  addresses: AddressResult[]
  loading: boolean
}

export function useStationSearch(query: string): SearchResults {
  const [results, setResults] = useState<SearchResults>({ stations: [], addresses: [], loading: false })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (query.length < 2) {
      setResults({ stations: [], addresses: [], loading: false })
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setResults(prev => ({ ...prev, loading: true }))

      const stationFetch = fetch(
        `/api/stops/search?q=${encodeURIComponent(query)}&limit=6`,
        { signal: controller.signal }
      )

      const mapboxFetch = MAPBOX_TOKEN
        ? fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
            `?country=US&bbox=${NYC_BBOX}&types=address,poi,place&limit=4&access_token=${MAPBOX_TOKEN}`,
            { signal: controller.signal }
          )
        : Promise.resolve(null)

      try {
        const [stationRes, mapboxRes] = await Promise.all([stationFetch, mapboxFetch])
        const stationData = await stationRes.json()
        const stations: StationResult[] = stationData.results ?? []

        let addresses: AddressResult[] = []
        if (mapboxRes?.ok) {
          const mapboxData = await mapboxRes.json()
          addresses = (mapboxData.features ?? []).map((f: { place_name: string; center: [number, number] }) => ({
            place_name: f.place_name,
            lat: f.center[1],
            lon: f.center[0],
          }))
        }

        setResults({ stations, addresses, loading: false })
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          setResults({ stations: [], addresses: [], loading: false })
        }
      }
    }, 200)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  return results
}
