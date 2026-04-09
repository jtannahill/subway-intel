import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: {
    stations: SavedStation[]
    addStation: (station: SavedStation) => void
    removeStation: (stop_id: string, direction: string) => void
  }
}

export function SmartCommute(_props: Props) {
  return <div className="label">SMART COMMUTE — coming in Task 13</div>
}
