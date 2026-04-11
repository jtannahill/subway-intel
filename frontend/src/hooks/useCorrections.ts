import { useState, useEffect } from 'react'

/** Per-route bias correction in seconds (positive = trains arrive later than GTFS-RT reports).
 *  Fetched once on mount, refreshed every 5 minutes. */
export function useCorrections(): Record<string, number> {
  const [corrections, setCorrections] = useState<Record<string, number>>({})

  useEffect(() => {
    function fetch_() {
      fetch('/api/feedback/corrections')
        .then(r => r.ok ? r.json() as Promise<{ corrections: Record<string, number> }> : Promise.reject())
        .then(({ corrections }) => setCorrections(corrections))
        .catch(() => {/* silently ignore — corrections are optional */})
    }

    fetch_()
    const id = setInterval(fetch_, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  return corrections
}
