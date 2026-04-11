import { useState, useEffect } from 'react'

/** Returns current timestamp, updated every `intervalMs` ms. Use to drive live countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
