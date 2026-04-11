import { useState } from 'react'
import { TopBar } from './components/TopBar'
import { Ticker } from './components/Ticker'
import { BottomNav } from './components/BottomNav'
import { useLiveData } from './hooks/useLiveData'
import { useStations } from './hooks/useStations'
import { useCorrections } from './hooks/useCorrections'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useNearby } from './hooks/useNearby'
import { MyStations } from './views/MyStations'
import { NearbyView } from './views/NearbyView'
import { NetworkPulse } from './views/NetworkPulse'
import { DelayIntel } from './views/DelayIntel'

type View = 'stations' | 'nearby' | 'pulse' | 'intel'

export default function App() {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [activeView, setActiveView] = useState<View>('nearby')
  const liveData = useLiveData()
  const stationsCtx = useStations()
  const corrections = useCorrections()
  const nearby = useNearby()

  const nearbyStation = nearby.state.status === 'tracking' ? nearby.state.station : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      <TopBar active={activeView} onNav={setActiveView} liveData={liveData} />
      {!isMobile && <Ticker liveData={liveData} />}
      <main style={{
        flex: 1,
        overflow: 'auto',
        padding: isMobile ? '12px' : '20px',
        paddingBottom: isMobile ? `calc(56px + env(safe-area-inset-bottom) + 12px)` : '20px',
        display: 'grid',
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
          <DelayIntel liveData={liveData} />
        )}
      </main>
      {isMobile && <BottomNav active={activeView} onNav={setActiveView} />}
    </div>
  )
}
