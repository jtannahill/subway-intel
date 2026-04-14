import { useState, useCallback } from 'react'

const KEY = 'subway_intel_saved_lines'

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function useSavedLines() {
  const [savedLines, setSavedLines] = useState<string[]>(load)

  const toggleLine = useCallback((route_id: string) => {
    setSavedLines(prev => {
      const next = prev.includes(route_id)
        ? prev.filter(r => r !== route_id)
        : [...prev, route_id]
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    localStorage.removeItem(KEY)
    setSavedLines([])
  }, [])

  return {
    savedLines,
    toggleLine,
    clearAll,
    hasSaved: savedLines.length > 0,
  }
}
