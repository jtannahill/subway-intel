/**
 * useStopCache — stale-while-revalidate stop lookup backed by IndexedDB.
 *
 * First load: fetch from network, populate IDB, resolve.
 * Subsequent loads: serve from IDB immediately (ready=true instantly), then
 * refresh from network in the background.
 */
import { useEffect, useRef, useState } from 'react'

export interface CachedStop {
  stop_id: string
  name: string
  lat: number
  lon: number
}

const DB_NAME = 'subway-intel-v1'
const STORE = 'stops'
const VERSION = 1
const NETWORK_URL = '/api/stops/all'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'stop_id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function readAll(db: IDBDatabase): Promise<CachedStop[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as CachedStop[])
    req.onerror = () => reject(req.error)
  })
}

function writeAll(db: IDBDatabase, stops: CachedStop[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.clear()
    for (const s of stops) store.put(s)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function fetchFromNetwork(): Promise<CachedStop[]> {
  const res = await fetch(NETWORK_URL)
  const data = await res.json() as { stops: CachedStop[] }
  return data.stops
}

export function useStopCache(): { stops: Map<string, CachedStop>; ready: boolean } {
  const [stops, setStops] = useState<Map<string, CachedStop>>(new Map())
  const [ready, setReady] = useState(false)
  const initDone = useRef(false)

  useEffect(() => {
    if (initDone.current) return
    initDone.current = true

    async function init() {
      const db = await openDB()
      const cached = await readAll(db)

      if (cached.length > 0) {
        // Serve from cache immediately
        setStops(new Map(cached.map(s => [s.stop_id, s])))
        setReady(true)
        // Refresh in background
        fetchFromNetwork().then(fresh => writeAll(db, fresh)).catch(() => {})
      } else {
        // First load: must wait for network
        const fresh = await fetchFromNetwork()
        await writeAll(db, fresh)
        setStops(new Map(fresh.map(s => [s.stop_id, s])))
        setReady(true)
      }
    }

    init().catch(() => {
      // IDB unavailable (private browsing etc.) — fall back to network only
      fetchFromNetwork().then(stops => {
        setStops(new Map(stops.map(s => [s.stop_id, s])))
        setReady(true)
      }).catch(() => {})
    })
  }, [])

  return { stops, ready }
}
