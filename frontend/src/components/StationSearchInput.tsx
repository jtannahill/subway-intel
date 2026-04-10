import { useState, useRef, useEffect } from 'react'
import { useStationSearch } from '../hooks/useStationSearch'
import type { StationResult, AddressResult } from '../hooks/useStationSearch'

interface Props {
  placeholder?: string
  onSelect: (stop_id: string, name: string) => void
  defaultValue?: string
}

type Item =
  | { type: 'station'; data: StationResult }
  | { type: 'address'; data: AddressResult }

export function StationSearchInput({
  placeholder = 'Search station or address...',
  onSelect,
  defaultValue = '',
}: Props) {
  const [query, setQuery] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const { stations, addresses } = useStationSearch(query)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const items: Item[] = [
    ...stations.map(s => ({ type: 'station' as const, data: s })),
    ...addresses.map(a => ({ type: 'address' as const, data: a })),
  ]
  const hasResults = items.length > 0
  const showDropdown = open && query.length >= 2

  function selectStation(s: StationResult) {
    setQuery(s.name)
    onSelect(s.stop_id, s.name)
    setOpen(false)
    setHighlighted(-1)
  }

  async function selectAddress(a: AddressResult) {
    try {
      const res = await fetch(`/api/stops/nearest?lat=${a.lat}&lon=${a.lon}&limit=1`)
      const data = await res.json()
      const nearest = data.results?.[0]
      if (nearest) {
        setQuery(nearest.name)
        onSelect(nearest.stop_id, nearest.name)
        setOpen(false)
        setHighlighted(-1)
      }
    } catch { /* ignore network errors */ }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!showDropdown || items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlighted(-1)
    } else if (e.key === 'Enter' && highlighted >= 0) {
      const item = items[highlighted]
      if (item.type === 'station') selectStation(item.data)
      else selectAddress(item.data)
    }
  }

  function highlightMatch(text: string): React.ReactNode {
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1 || query.length === 0) return text
    return (
      <>
        {text.slice(0, idx)}
        <span style={{ color: 'var(--green)' }}>{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    )
  }

  const inputStyle: React.CSSProperties = {
    all: 'unset', display: 'block', width: '100%',
    background: 'var(--bg-surface)',
    border: `1px solid ${showDropdown && hasResults ? 'var(--green-border)' : 'var(--border)'}`,
    borderRadius: showDropdown && hasResults ? '3px 3px 0 0' : 3,
    padding: '8px 12px',
    color: 'var(--text-primary)', fontSize: 12,
    transition: 'border-color 0.1s',
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 8, letterSpacing: '0.14em', color: 'var(--text-faint)',
    padding: '5px 12px 3px',
    background: 'var(--bg)', borderBottom: '1px solid var(--border)',
  }

  let itemIdx = -1

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={inputStyle}
      />

      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg-surface)',
          border: '1px solid var(--green-border)', borderTop: 'none',
          borderRadius: '0 0 3px 3px',
          maxHeight: 280, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {stations.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>STATIONS</div>
              {stations.map(s => {
                itemIdx++
                const idx = itemIdx
                return (
                  <button
                    key={s.stop_id}
                    onMouseDown={e => { e.preventDefault(); selectStation(s) }}
                    style={{
                      all: 'unset', display: 'block', width: '100%',
                      padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                      color: 'var(--text-primary)',
                      background: highlighted === idx ? 'var(--bg-elevated)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                      boxSizing: 'border-box',
                    }}
                  >
                    {highlightMatch(s.name)}
                  </button>
                )
              })}
            </>
          )}

          {addresses.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>ADDRESSES</div>
              {addresses.map((a, i) => {
                itemIdx++
                const idx = itemIdx
                return (
                  <button
                    key={i}
                    onMouseDown={e => { e.preventDefault(); selectAddress(a) }}
                    style={{
                      all: 'unset', display: 'block', width: '100%',
                      padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                      color: 'var(--text-muted)',
                      background: highlighted === idx ? 'var(--bg-elevated)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                      boxSizing: 'border-box',
                    }}
                  >
                    {a.place_name}
                  </button>
                )
              })}
            </>
          )}

          {!hasResults && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-faint)' }}>
              No results for "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}
