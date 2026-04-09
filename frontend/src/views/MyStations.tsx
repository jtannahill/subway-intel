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

export function MyStations(_props: Props) {
  return <div className="label">MY STATIONS — coming in Task 12</div>
}
