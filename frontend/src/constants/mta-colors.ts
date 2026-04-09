export const MTA_LINE_COLORS: Record<string, string> = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C',
  '7': '#B933AD',
  'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6',
  'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319',
  'G': '#6CBE45',
  'J': '#996633', 'Z': '#996633',
  'L': '#A7A9AC',
  'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
  'S': '#808183', 'GS': '#808183', 'FS': '#808183', 'H': '#808183',
  'SIR': '#0039A6',
}

export function getLineColor(routeId: string): string {
  return MTA_LINE_COLORS[routeId.toUpperCase()] ?? '#555555'
}

// Text color: white for dark bg, black for light lines (N/Q/R/W/L)
export function getLineTextColor(routeId: string): string {
  return ['N', 'Q', 'R', 'W', 'L'].includes(routeId.toUpperCase()) ? '#000000' : '#ffffff'
}
