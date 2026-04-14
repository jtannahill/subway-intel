import { useState, lazy, Suspense, useEffect } from 'react'
import { TopBar } from './components/TopBar'
import { Ticker } from './components/Ticker'
import { BottomNav } from './components/BottomNav'
import { useLiveData } from './hooks/useLiveData'
import { useStations } from './hooks/useStations'
import { useCorrections } from './hooks/useCorrections'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useNearby } from './hooks/useNearby'
import { useSavedLines } from './hooks/useSavedLines'
import { MyStations } from './views/MyStations'
import { NearbyView } from './views/NearbyView'
import { NetworkPulse } from './views/NetworkPulse'
import { DelayIntel } from './views/DelayIntel'
const MapView = lazy(() => import('./views/MapView').then(m => ({ default: m.MapView })))
const PlanView = lazy(() => import('./views/PlanView').then(m => ({ default: m.PlanView })))

type View = 'stations' | 'nearby' | 'pulse' | 'intel' | 'map' | 'plan'

export default function App() {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [activeView, setActiveView] = useState<View>(() => {
    const saved = localStorage.getItem('activeView')
    return (saved === 'stations' || saved === 'nearby' || saved === 'pulse' || saved === 'intel' || saved === 'map' || saved === 'plan') ? saved : 'pulse'
  })

  function handleNav(view: View) {
    setActiveView(view)
    localStorage.setItem('activeView', view)
  }
  const liveData = useLiveData()
  const stationsCtx = useStations()
  const corrections = useCorrections()
  const nearby = useNearby()
  const { savedLines, hasSaved } = useSavedLines()

  const nearbyStation = nearby.state.status === 'tracking' ? nearby.state.stations[0] : null

  // Prefetch the map chunk + static API data in the background so MAP tab loads instantly
  // setTimeout fallback for Safari which doesn't support requestIdleCallback
  useEffect(() => {
    const id = setTimeout(() => {
      import('./views/MapView')
      fetch('/api/stops/all')
      fetch('/api/tracks')
      fetch('/api/config')
    }, 1500)
    return () => clearTimeout(id)
  }, [])

  // Handle ?near=STOP_ID deep link — pre-select a station in nearby view
  useEffect(() => {
    const stopId = new URLSearchParams(window.location.search).get('near')
    if (stopId) {
      nearby.select(stopId, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      <TopBar active={activeView} onNav={handleNav} liveData={liveData} />
      {!isMobile && <Ticker liveData={liveData} />}
      <main style={{
        flex: 1,
        overflow: activeView === 'map' ? 'hidden' : 'auto',
        padding: activeView === 'map' ? 0 : (isMobile ? '12px' : '20px'),
        paddingBottom: activeView === 'map' ? 0 : (isMobile ? `calc(56px + env(safe-area-inset-bottom) + 12px)` : '20px'),
        display: activeView === 'map' ? 'block' : 'grid',
        gridTemplateColumns: (!isMobile && activeView !== 'nearby') ? '1fr 1fr' : '1fr',
        gap: isMobile ? 12 : 16,
        alignContent: 'start',
        WebkitOverflowScrolling: 'touch',
      }}>
        {activeView === 'stations' && (
          <MyStations liveData={liveData} stationsCtx={stationsCtx} corrections={corrections} />
        )}
        {activeView === 'nearby' && (
          <NearbyView liveData={liveData} corrections={corrections} nearby={nearby} />
        )}
        {activeView === 'pulse' && (
          <NetworkPulse liveData={liveData} nearbyStation={nearbyStation} />
        )}
        {activeView === 'intel' && (
          <DelayIntel liveData={liveData} savedLines={savedLines} hasSaved={hasSaved} />
        )}
        {activeView === 'plan' && (
          <Suspense fallback={<div style={{ color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.1em', padding: 20 }}>LOADING…</div>}>
            <PlanView />
          </Suspense>
        )}
        {activeView === 'map' && (
          <Suspense fallback={<div style={{ color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.1em', padding: 20 }}>LOADING MAP…</div>}>
            <MapView liveData={liveData} nearbyState={nearby.state} />
          </Suspense>
        )}
      </main>
      {isMobile && <BottomNav active={activeView} onNav={handleNav} />}
    </div>
  )
}
