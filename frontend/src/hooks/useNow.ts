import { useState, useEffect } from 'react'

/** Returns the current timestamp, updated every second.
 *  Aligned to the wall-clock second boundary so ticks fire at :00, :01, :02… */
export function useNow(): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    // Align to the next whole second, then tick every 1000ms
    const delay = 1000 - (Date.now() % 1000)
    let id: ReturnType<typeof setInterval>
    const firstTick = setTimeout(() => {
      setNow(Date.now())
      id = setInterval(() => setNow(Date.now()), 1000)
    }, delay)
    return () => {
      clearTimeout(firstTick)
      clearInterval(id)
    }
  }, [])

  return now
}
