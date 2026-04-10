import { useState } from 'react'
import { TopBar } from './components/TopBar'
import { Ticker } from './components/Ticker'
import { useLiveData } from './hooks/useLiveData'
import { useStations } from './hooks/useStations'
import { MyStations } from './views/MyStations'
import { NetworkPulse } from './views/NetworkPulse'
import { DelayIntel } from './views/DelayIntel'

type View = 'stations' | 'pulse' | 'intel'

export default function App() {
  const [activeView, setActiveView] = useState<View>('stations')
  const liveData = useLiveData()
  const stationsCtx = useStations()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar active={activeView} onNav={setActiveView} liveData={liveData} />
      <Ticker liveData={liveData} />
      <main style={{
        flex: 1,
        overflow: 'auto',
        padding: 20,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        alignContent: 'start',
      }}>
        {activeView === 'stations' && (
          <MyStations liveData={liveData} stationsCtx={stationsCtx} />
        )}
        {activeView === 'pulse' && (
          <NetworkPulse liveData={liveData} />
        )}
        {activeView === 'intel' && (
          <DelayIntel liveData={liveData} />
        )}
      </main>
    </div>
  )
}
