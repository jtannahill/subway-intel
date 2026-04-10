// Official MTA brand hex colors — sourced from MTA open data (3uhz-sej2)
export const MTA_LINE_COLORS: Record<string, string> = {
  // NYC Subway
  '1': '#D82233', '2': '#D82233', '3': '#D82233',
  '4': '#009B3A', '5': '#009B3A', '6': '#009B3A',
  '7': '#9A38A1',
  'A': '#0062CF', 'C': '#0062CF', 'E': '#0062CF',
  'B': '#EB6800', 'D': '#EB6800', 'F': '#EB6800', 'M': '#EB6800',
  'G': '#799534',
  'J': '#8E5C33', 'Z': '#8E5C33',
  'L': '#7C858C',
  'N': '#F6BC26', 'Q': '#F6BC26', 'R': '#F6BC26', 'W': '#F6BC26',
  'S': '#7C858C', 'GS': '#7C858C', 'FS': '#7C858C', 'H': '#7C858C',
  'T': '#008EB7',
  'SIR': '#08179C',

  // Long Island Rail Road
  'LIRR-Babylon':         '#00985F',
  'LIRR-CityTerminal':    '#4D5357',
  'LIRR-Montauk':         '#00B2A9',
  'LIRR-PortJefferson':   '#006EC7',
  'LIRR-Ronkonkoma':      '#A626AA',
  'LIRR-Hempstead':       '#CE8E00',
  'LIRR-FarRockaway':     '#6E3219',
  'LIRR-BelmontPark':     '#60269E',
  'LIRR-OysterBay':       '#00AF3F',
  'LIRR-PortWashington':  '#C60C30',
  'LIRR-LongBeach':       '#FF6319',
  'LIRR-WestHempstead':   '#00A1DE',

  // Metro-North Railroad
  'MNR-Hudson':           '#009B3A',
  'MNR-NewHaven':         '#E00034',
  'MNR-Harlem':           '#0039A6',
  'MNR-PortJervis':       '#FF7900',
  'MNR-PascackValley':    '#923D97',
}

export function getLineColor(routeId: string): string {
  return MTA_LINE_COLORS[routeId.toUpperCase()] ?? MTA_LINE_COLORS[routeId] ?? '#555555'
}

// Text color: black for light backgrounds (yellow N/Q/R/W, light tones)
export function getLineTextColor(routeId: string): string {
  return ['N', 'Q', 'R', 'W'].includes(routeId.toUpperCase()) ? '#000000' : '#ffffff'
}
