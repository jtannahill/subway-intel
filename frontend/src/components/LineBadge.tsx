import { getLineColor, getLineTextColor } from '../constants/mta-colors'

interface Props { routeId: string; size?: number }

export function LineBadge({ routeId, size = 22 }: Props) {
  return (
    <span
      style={{
        width: size,
        height: size,
        background: getLineColor(routeId),
        color: getLineTextColor(routeId),
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5,
        fontWeight: 700,
        flexShrink: 0,
        fontFamily: 'sans-serif',
      }}
    >
      {routeId}
    </span>
  )
}
