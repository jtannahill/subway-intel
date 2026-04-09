import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { useLiveData } from './hooks/useLiveData'
import { useStations } from './hooks/useStations'
import { MyStations } from './views/MyStations'
import { SmartCommute } from './views/SmartCommute'
import { NetworkPulse } from './views/NetworkPulse'
import { DelayIntel } from './views/DelayIntel'

type View = 'stations' | 'commute' | 'pulse' | 'intel'

export default function App() {
  const [activeView, setActiveView] = useState<View>('stations')
  const liveData = useLiveData()
  const stationsCtx = useStations()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        background: '#111', borderBottom: '1px solid var(--border-dim)',
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, height: 40 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 10, height: 10, background: '#ff5f57', borderRadius: '50%' }} />
          <div style={{ width: 10, height: 10, background: '#febc2e', borderRadius: '50%' }} />
          <div style={{ width: 10, height: 10, background: '#28c840', borderRadius: '50%' }} />
        </div>
        <span className="label-green" style={{ marginLeft: 8, fontSize: 12 }}>SUBWAY-INTEL</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className={`dot ${liveData.connected ? 'dot-green' : 'dot-dim'}`} />
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>LIVE</span>
        </div>
      </div>

      {/* Body below top bar */}
      <div style={{ display: 'flex', flex: 1, marginTop: 40, overflow: 'hidden' }}>
        <Sidebar active={activeView} onNav={setActiveView} liveData={liveData} />
        <main style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {activeView === 'stations' && <MyStations liveData={liveData} stationsCtx={stationsCtx} />}
          {activeView === 'commute'  && <SmartCommute liveData={liveData} stationsCtx={stationsCtx} />}
          {activeView === 'pulse'    && <NetworkPulse liveData={liveData} />}
          {activeView === 'intel'    && <DelayIntel liveData={liveData} />}
        </main>
      </div>
    </div>
  )
}
