// Stop search is delegated to the backend /api/stops/search endpoint.
// This file holds only the direction label map.

export const DIRECTION_LABELS: Record<string, string> = {
  N: 'Uptown',
  S: 'Downtown',
}

export function directionLabel(direction: string, routeId: string): string {
  // Special cases
  if (routeId === '7') return direction === 'N' ? 'Queens-bound' : 'Manhattan-bound'
  if (routeId === 'L') return direction === 'N' ? 'Bklyn-bound' : '8 Av-bound'
  if (['A', 'C', 'E'].includes(routeId)) return direction === 'N' ? 'Uptown/Queens' : 'Downtown/Bklyn'
  return DIRECTION_LABELS[direction] ?? direction
}
