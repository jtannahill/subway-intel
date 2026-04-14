import { getLineColor, getLineTextColor } from '../constants/mta-colors'

// Express trains: rotated square (diamond) per NYC Core Framework + MTA signage standard
// All others: circle
const EXPRESS_ROUTES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'J', 'N', 'Q', 'R', 'W', 'Z'])

interface Props { routeId: string; size?: number }

export function LineBadge({ routeId, size = 22 }: Props) {
  const upper = routeId.toUpperCase()
  const isExpress = EXPRESS_ROUTES.has(upper)
  const bg = getLineColor(routeId)
  const fg = getLineTextColor(routeId)

  if (isExpress) {
    // Diamond: outer wrapper is rotated 45°, inner text counter-rotated
    const outer = Math.round(size * 0.78)   // rotated square fits inside circle of same size
    return (
      <span style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{
          width: outer,
          height: outer,
          background: bg,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'rotate(45deg)',
          flexShrink: 0,
        }}>
          <span style={{
            color: fg,
            fontSize: size * 0.42,
            fontWeight: 700,
            fontFamily: 'sans-serif',
            transform: 'rotate(-45deg)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}>
            {routeId}
          </span>
        </span>
      </span>
    )
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
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
