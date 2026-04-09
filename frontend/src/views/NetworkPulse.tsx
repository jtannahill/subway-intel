import type { LiveData } from '../hooks/useLiveData'

interface Props {
  liveData: LiveData
}

export function NetworkPulse(_props: Props) {
  return <div className="label">NETWORK PULSE — coming in Task 14</div>
}
