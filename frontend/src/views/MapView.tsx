import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { LiveData } from '../hooks/useLiveData'
import type { NearbyStatus } from '../hooks/useNearby'
import { MTA_LINE_COLORS, getLineColor } from '../constants/mta-colors'

// Express trains use diamond (rotated square) per MTA/NYC Core Framework signage
const EXPRESS_ROUTES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'J', 'N', 'Q', 'R', 'W', 'Z'])

/** Render an MTA subway bullet — diamond for express, circle for local */
function subwayBullet(routeId: string, size = 18): string {
  const color = MTA_LINE_COLORS[routeId] ?? '#888'
  const isYellow = ['N', 'Q', 'R', 'W'].includes(routeId)
  const fg = isYellow ? '#000' : '#fff'
  const isExpress = EXPRESS_ROUTES.has(routeId)
  if (isExpress) {
    const sq = Math.round(size * 0.72)
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;flex-shrink:0;"><span style="width:${sq}px;height:${sq}px;background:${color};display:inline-flex;align-items:center;justify-content:center;transform:rotate(45deg);"><span style="color:${fg};font-size:${Math.round(size * 0.42)}px;font-weight:700;font-family:sans-serif;transform:rotate(-45deg);display:inline-flex;align-items:center;justify-content:line-height:1;">${routeId}</span></span></span>`
  }
  return `<span style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.5)}px;font-weight:700;color:${fg};font-family:sans-serif;flex-shrink:0;">${routeId}</span>`
}
import { useMediaQuery } from '../hooks/useMediaQuery'

interface Props {
  liveData: LiveData
  nearbyState: NearbyStatus
}

interface StopCoords { lat: number; lon: number; name: string }


const STATUS_LABEL: Record<string, string> = {
  STOPPED_AT: 'stopped at',
  IN_TRANSIT_TO: 'en route to',
  INCOMING_AT: 'arriving at',
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

/**
 * Interpolate a position along a polyline [[lon,lat],...] at fraction t ∈ [0,1].
 * Falls back to straight-line between endpoints if coords has < 2 points.
 */
function lerpAlongPath(coords: [number, number][], t: number): [number, number] {
  if (coords.length === 0) return [0, 0]
  if (coords.length === 1) return coords[0]
  if (t <= 0) return coords[0]
  if (t >= 1) return coords[coords.length - 1]

  // Compute cumulative chord lengths
  let total = 0
  const lens: number[] = []
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0]
    const dy = coords[i][1] - coords[i - 1][1]
    const d = Math.sqrt(dx * dx + dy * dy)
    lens.push(d)
    total += d
  }
  if (total === 0) return coords[0]

  let target = t * total
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] + 1e-10) {
      const segT = lens[i] > 0 ? target / lens[i] : 0
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * segT,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * segT,
      ]
    }
    target -= lens[i]
  }
  return coords[coords.length - 1]
}

/** Bearing in degrees (0 = north, clockwise) from point A to point B. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const dLon = (lon2 - lon1) * toRad
  const φ1 = lat1 * toRad
  const φ2 = lat2 * toRad
  const y = Math.sin(dLon) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/**
 * Pre-render one high-res arrow image per MTA route into the map sprite.
 * Each SVG is rasterized to 96×128 px (well above display size) so bilinear
 * downscaling looks crisp at all zoom levels — no SDF artifacts.
 * Color + white outline are baked into the SVG, so no icon-color needed.
 */
function loadRouteArrows(map: mapboxgl.Map): Promise<void> {
  const W = 96, H = 128

  const svgFor = (color: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 28">
      <path d="M10 1 L19 26 L10 19.5 L1 26 Z"
            fill="${color}"
            stroke="rgba(255,255,255,0.95)" stroke-width="2.5"
            stroke-linejoin="round" stroke-linecap="round"
            paint-order="stroke"/>
    </svg>`

  const register = (id: string, color: string): Promise<void> =>
    new Promise((resolve) => {
      const img = new Image(W, H)
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = W; canvas.height = H
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, W, H)
        const raw = ctx.getImageData(0, 0, W, H)
        if (!map.hasImage(id)) {
          map.addImage(id, { width: W, height: H, data: new Uint8Array(raw.data.buffer) })
        }
        resolve()
      }
      img.onerror = () => resolve()
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(color))}`
    })

  return Promise.all([
    ...Object.entries(MTA_LINE_COLORS).map(([route, color]) => register(`arrow-${route}`, color)),
    register('arrow-default', '#888888'),
  ]).then(() => {})
}

// Mapbox expression: pick the pre-rendered image for each train's route
const ARROW_IMAGE_EXPR: mapboxgl.Expression = [
  'match', ['get', 'route_id'],
  ...Object.entries(MTA_LINE_COLORS).flatMap(([r]) => [r, `arrow-${r}`]),
  'arrow-default',
]

export function MapView({ liveData, nearbyState }: Props) {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const stopsRef = useRef<Map<string, StopCoords>>(new Map())
  const [tokenReady, setTokenReady] = useState(false)
  const [tokenError, setTokenError] = useState(false)
  const [stopsReady, setStopsReady] = useState(false)
  const [inViewCount, setInViewCount] = useState(0)
  const mapReadyRef = useRef(false)
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const locateMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const popupRef = useRef<mapboxgl.Popup | null>(null)
  // Last-known bearing per trip_id — used for STOPPED_AT trains so they keep their heading
  const bearingsRef = useRef<Map<string, number>>(new Map())

  // Feature 1: Line filter
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  // Feature 2: Layers ready flag (set after tracks are added)
  const [layersReady, setLayersReady] = useState(false)

  // Fire all fetches in parallel on mount
  const pendingTracksRef = useRef<Promise<GeoJSON.FeatureCollection> | null>(null)
  const pendingSubwayLinesRef = useRef<Promise<GeoJSON.FeatureCollection> | null>(null)
  const vehiclePositionsRef = useRef(liveData.vehiclePositions)
  const renderTrainsRef = useRef<() => void>(() => {})

  useEffect(() => {
    const configP = fetch('/api/config').then(r => r.json() as Promise<{ mapbox_token: string }>)
    const stopsP = fetch('/api/stops/all').then(r => r.json() as Promise<{ stops: { stop_id: string; name: string; lat: number; lon: number }[] }>)
    const tracksP = fetch('/api/tracks').then(r => r.json() as Promise<GeoJSON.FeatureCollection>)
    const subwayLinesP = fetch('/api/subway-lines').then(r => r.json() as Promise<GeoJSON.FeatureCollection>)
    pendingTracksRef.current = tracksP
    pendingSubwayLinesRef.current = subwayLinesP

    stopsP.then(({ stops }) => {
      for (const s of stops) stopsRef.current.set(s.stop_id, { lat: s.lat, lon: s.lon, name: s.name })
      setStopsReady(true)
    }).catch(() => {})

    configP.then(({ mapbox_token }) => {
      if (!mapbox_token) { setTokenError(true); return }
      mapboxgl.accessToken = mapbox_token
      setTokenReady(true)
    }).catch(() => setTokenError(true))
  }, [])

  // Init map once token is ready
  useEffect(() => {
    if (!tokenReady || !containerRef.current || mapRef.current) return

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-73.985, 40.758],
      zoom: 12,
      attributionControl: false,
    })
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')
    mapRef.current = map

    map.on('load', async () => {
      mapReadyRef.current = true

      // Pre-render per-route arrows before adding the symbol layer
      await loadRouteArrows(map)

      // NYC DOT physical track geometry (from nyc-geo-metadata / ArcGIS) — base layer
      // Shows actual track segments including Y-junctions and express/local splits.
      // Colored by MTA division: IRT=red family, IND=blue family, BMT=yellow family.
      const subwayLinesP = pendingSubwayLinesRef.current ?? fetch('/api/subway-lines').then(r => r.json())
      subwayLinesP.then((geojson: GeoJSON.FeatureCollection) => {
        if (!mapRef.current) return
        map.addSource('subway-lines', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'subway-lines-layer',
          type: 'line',
          source: 'subway-lines',
          paint: {
            // Division: '1'=IRT, '2'=IND, '3'=BMT
            'line-color': [
              'match', ['get', 'DIVISION'],
              '1', '#8B3A3A',  // IRT — dark red
              '2', '#1a3a6b',  // IND — dark blue
              '3', '#5a4a1a',  // BMT — dark gold
              '#333333',
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2],
            'line-opacity': 0.5,
          },
        })
      }).catch(() => {})

      const tracksP = pendingTracksRef.current ?? fetch('/api/tracks').then(r => r.json())
      tracksP.then((geojson: GeoJSON.FeatureCollection) => {
          if (!mapRef.current) return
          map.addSource('tracks', { type: 'geojson', data: geojson })
          const routes = [
            ...new Set(
              geojson.features
                .map(f => (f.properties as { route_id: string }).route_id)
                .filter(Boolean)
            ),
          ]
          for (const route of routes) {
            map.addLayer({
              id: `track-${route}`,
              type: 'line',
              source: 'tracks',
              filter: ['==', ['get', 'route_id'], route],
              paint: {
                'line-color': getLineColor(route),
                'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 2.5],
                'line-opacity': 0.75,
              },
            })
          }
          // Feature 2: signal that track layers are ready
          setLayersReady(true)
        })
        .catch(() => {})

      map.addSource('trains', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'trains-layer',
        type: 'symbol',
        source: 'trains',
        layout: {
          'icon-image': ARROW_IMAGE_EXPR,
          // 96px source → display at ~19px (zoom 9) to ~38px (zoom 16)
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.2, 16, 0.4],
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': 0.97,
        },
      })

      // Feature 3: stations source + layer (added BEFORE trains-layer)
      map.addSource('stations', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer(
        {
          id: 'stations-layer',
          type: 'circle',
          source: 'stations',
          minzoom: 11,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5],
            'circle-color': '#1a1a1a',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': 'rgba(255,255,255,0.4)',
            'circle-opacity': 0.85,
          },
        },
        'trains-layer',
      )

      // Feature 3: click handler on stations-layer
      map.on('click', 'stations-layer', async (e) => {
        if (!e.features?.length) return
        const props = e.features[0].properties as { stop_id: string; name: string }
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number]

        // Fetch both directions in parallel
        const [northData, southData] = await Promise.all([
          fetch(`/api/stations/${props.stop_id}N/arrivals`).then(r => r.json()).catch(() => ({ arrivals: [] })),
          fetch(`/api/stations/${props.stop_id}S/arrivals`).then(r => r.json()).catch(() => ({ arrivals: [] })),
        ])

        const arrivals = [...(northData.arrivals ?? []), ...(southData.arrivals ?? [])]
          .sort((a: { arrival_time: string }, b: { arrival_time: string }) => new Date(a.arrival_time).getTime() - new Date(b.arrival_time).getTime())
          .slice(0, 5)

        const now = Date.now()
        const rows = arrivals.map((a: { arrival_time: string; route_id: string; direction: string }) => {
          const mins = Math.round((new Date(a.arrival_time).getTime() - now) / 60000)
          return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #222;">
            ${subwayBullet(a.route_id, 18)}
            <span style="color:#aaa;font-size:10px;letter-spacing:0.06em;">${a.direction === 'N' ? 'Uptown' : 'Downtown'}</span>
            <span style="margin-left:auto;color:${mins <= 1 ? '#22c55e' : '#e5e5e5'};font-weight:600;font-size:11px;">${mins <= 0 ? 'Now' : mins + 'm'}</span>
          </div>`
        }).join('')

        popupRef.current?.remove()
        popupRef.current = new mapboxgl.Popup({ closeButton: true, className: 'train-popup', maxWidth: '240px', offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:var(--font-mono,monospace);">
              <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;color:#e5e5e5;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #333;">${props.name.toUpperCase()}</div>
              ${rows || '<div style="color:#666;font-size:10px;">No arrivals found</div>'}
            </div>
          `)
          .addTo(map)
      })

      // Feature 3: cursor change on hover for stations-layer
      map.on('mouseenter', 'stations-layer', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'stations-layer', () => { map.getCanvas().style.cursor = '' })

      // Click popup on train dot
      map.on('click', 'trains-layer', (e) => {
        if (!e.features?.length) return
        const f = e.features[0]
        const props = f.properties as { route_id: string; trip_id: string; status: string; stop_name: string }
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number]
        const statusLabel = STATUS_LABEL[props.status] ?? props.status?.toLowerCase() ?? ''

        popupRef.current?.remove()
        popupRef.current = new mapboxgl.Popup({
          closeButton: false,
          className: 'train-popup',
          maxWidth: '220px',
          offset: 10,
        })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:var(--font-mono,monospace);font-size:11px;line-height:1.6;color:#e5e5e5;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                ${subwayBullet(props.route_id, 20)}
                <span style="font-weight:600;letter-spacing:0.06em;">${props.route_id} TRAIN</span>
              </div>
              <div style="color:#aaa;font-size:10px;letter-spacing:0.08em;">${statusLabel.toUpperCase()}</div>
              <div style="color:#e5e5e5;font-size:11px;margin-top:1px;">${props.stop_name}</div>
            </div>
          `)
          .addTo(map)
      })

      map.on('mouseenter', 'trains-layer', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'trains-layer', () => { map.getCanvas().style.cursor = '' })

      map.on('moveend', () => renderTrainsRef.current())
    })

    return () => {
      mapReadyRef.current = false
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      locateMarkerRef.current?.remove()
      locateMarkerRef.current = null
      popupRef.current?.remove()
      popupRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [tokenReady])

  // Feature 3: populate stations source once stops are ready
  useEffect(() => {
    if (!stopsReady || !mapReadyRef.current) return
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('stations') as mapboxgl.GeoJSONSource | undefined
    if (!source) return
    const features: GeoJSON.Feature[] = []
    stopsRef.current.forEach((coords, stop_id) => {
      // Only add base stop IDs (without N/S suffix) to avoid duplicates
      if (stop_id.match(/[NS]$/)) return
      features.push({
        type: 'Feature',
        properties: { stop_id, name: coords.name },
        geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
      })
    })
    source.setData({ type: 'FeatureCollection', features })
  }, [stopsReady])

  // Feature 1: line filter effect
  useEffect(() => {
    if (!mapReadyRef.current) return
    const map = mapRef.current
    if (!map) return
    const layers = map.getStyle()?.layers ?? []
    for (const layer of layers) {
      if (layer.id.startsWith('track-')) {
        const route = layer.id.slice('track-'.length)
        if (!map.getLayer(layer.id)) continue
        if (activeFilter !== null) {
          map.setPaintProperty(layer.id, 'line-opacity', route === activeFilter ? 0.85 : 0.06)
        } else {
          map.setPaintProperty(layer.id, 'line-opacity', 0.75)
        }
      }
    }
    if (map.getLayer('trains-layer')) {
      map.setFilter('trains-layer', activeFilter ? ['==', ['get', 'route_id'], activeFilter] : null)
    }
  }, [activeFilter])

  // Feature 2: service alerts — recolor track lines based on lineHealth
  useEffect(() => {
    if (!layersReady) return
    const map = mapRef.current
    if (!map) return
    for (const entry of liveData.lineHealth) {
      const layerId = `track-${entry.route_id}`
      if (!map.getLayer(layerId)) continue
      if (entry.status === 'DISRUPTED' && entry.alerts.length > 0) {
        map.setPaintProperty(layerId, 'line-color', '#ef4444')
      } else if (entry.status === 'DELAYED' && entry.alerts.length > 0) {
        map.setPaintProperty(layerId, 'line-color', '#d97706')
      } else {
        map.setPaintProperty(layerId, 'line-color', getLineColor(entry.route_id))
      }
    }
  }, [liveData.lineHealth, layersReady])

  // Nearby GPS marker (from useNearby)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const coords = nearbyState.status === 'tracking' && !nearbyState.manual
      ? nearbyState.coords
      : null

    if (!coords) {
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      return
    }

    if (!userMarkerRef.current) {
      const el = document.createElement('div')
      el.style.cssText = [
        'width:16px', 'height:16px', 'border-radius:50%',
        'background:var(--amber)',
        'border:2.5px solid #fff',
        'box-shadow:0 0 0 4px rgba(245,158,11,0.25)',
        'animation:pulse-glow-amber 1.4s ease-in-out infinite',
      ].join(';')
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([coords.lon, coords.lat])
        .addTo(map)
    } else {
      userMarkerRef.current.setLngLat([coords.lon, coords.lat])
    }
  }, [nearbyState])

  // Per-second animation ticker
  useEffect(() => {
    const id = setInterval(() => renderTrainsRef.current(), 1000)
    return () => clearInterval(id)
  }, [])

  // Keep refs current every render
  vehiclePositionsRef.current = liveData.vehiclePositions
  renderTrainsRef.current = () => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current || !stopsReady) return
    const bounds = map.getBounds()
    const now = Date.now()
    const features: GeoJSON.Feature[] = []

    for (const vp of vehiclePositionsRef.current) {
      // Resolve current stop coords
      const nextStop =
        stopsRef.current.get(vp.stop_id) ??
        stopsRef.current.get(vp.stop_id.slice(0, -1))
      if (!nextStop) continue

      let lon = nextStop.lon
      let lat = nextStop.lat
      let trainBearing = bearingsRef.current.get(vp.trip_id) ?? 0

      // Interpolate position for moving trains
      const prevStop = vp.prev_stop_id
        ? (stopsRef.current.get(vp.prev_stop_id) ?? stopsRef.current.get(vp.prev_stop_id.slice(0, -1)))
        : null

      if (
        vp.status !== 'STOPPED_AT' &&
        prevStop &&
        vp.prev_arrival_iso &&
        vp.next_arrival_iso
      ) {
        const t0 = new Date(vp.prev_arrival_iso).getTime()
        const t1 = new Date(vp.next_arrival_iso).getTime()
        const span = t1 - t0
        if (span > 0) {
          const progress = Math.max(0, Math.min(1, (now - t0) / span))
          if (vp.segment_coords && vp.segment_coords.length >= 2) {
            // Path-following: interpolate along the GTFS shape segment
            const pt = lerpAlongPath(vp.segment_coords, progress)
            lon = pt[0]
            lat = pt[1]
            // Bearing from current position toward a point slightly ahead on the path
            const ptAhead = lerpAlongPath(vp.segment_coords, Math.min(1, progress + 0.05))
            trainBearing = bearing(lat, lon, ptAhead[1], ptAhead[0])
          } else {
            // Fallback: straight-line interpolation between stop coordinates
            lon = lerp(prevStop.lon, nextStop.lon, progress)
            lat = lerp(prevStop.lat, nextStop.lat, progress)
            trainBearing = bearing(prevStop.lat, prevStop.lon, nextStop.lat, nextStop.lon)
          }
        }
        bearingsRef.current.set(vp.trip_id, trainBearing)
      } else if (prevStop) {
        // STOPPED_AT but we know where it came from — compute once and cache
        const b = bearing(prevStop.lat, prevStop.lon, nextStop.lat, nextStop.lon)
        bearingsRef.current.set(vp.trip_id, b)
        trainBearing = b
      }

      // Viewport cull
      if (bounds && !bounds.contains([lon, lat])) continue

      features.push({
        type: 'Feature',
        properties: {
          route_id: vp.route_id,
          trip_id: vp.trip_id,
          status: vp.status,
          stop_name: nextStop.name,
          bearing: trainBearing,
        },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      })
    }

    const source = map.getSource('trains') as mapboxgl.GeoJSONSource | undefined
    source?.setData({ type: 'FeatureCollection', features })
    setInViewCount(features.length)
  }

  // Update when new WebSocket data arrives
  useEffect(() => {
    renderTrainsRef.current()
  }, [liveData.vehiclePositions, stopsReady])

  if (tokenError) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', flexDirection: 'column', gap: 12,
        color: 'var(--text-faint)', fontSize: 11, letterSpacing: '0.08em',
        textAlign: 'center', padding: 24,
      }}>
        <div style={{ color: 'var(--amber)', marginBottom: 4 }}>MAP UNAVAILABLE</div>
        <div>Could not load map configuration.</div>
      </div>
    )
  }

  if (!tokenReady) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.1em',
      }}>
        LOADING MAP…
      </div>
    )
  }

  function handleLocate() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(pos => {
      const map = mapRef.current
      if (!map) return
      const { latitude: lat, longitude: lon } = pos.coords

      if (!locateMarkerRef.current) {
        const el = document.createElement('div')
        el.style.cssText = [
          'width:18px', 'height:18px', 'border-radius:50%',
          'background:#3b82f6',
          'border:3px solid #fff',
          'box-shadow:0 0 0 5px rgba(59,130,246,0.3)',
          'animation:pulse-glow-blue 1.6s ease-in-out infinite',
        ].join(';')
        locateMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([lon, lat])
          .addTo(map)
      } else {
        locateMarkerRef.current.setLngLat([lon, lat])
      }

      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14), duration: 1200 })
    })
  }

  const routes = Object.keys(MTA_LINE_COLORS)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{
        width: '100%',
        height: isMobile ? 'calc(100% - calc(56px + env(safe-area-inset-bottom)))' : '100%',
      }} />

      {/* Live train count badge */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        border: '1px solid var(--border)', borderRadius: 3,
        padding: '6px 10px', fontSize: 9, letterSpacing: '0.1em',
        color: 'var(--text-faint)', pointerEvents: 'none',
      }}>
        <span style={{ color: 'var(--green)', fontWeight: 700 }}>{inViewCount}</span>
        {' IN VIEW / '}
        <span style={{ color: 'var(--green)', fontWeight: 700 }}>{liveData.vehiclePositions.length}</span>
        {' LIVE'}
      </div>

      {/* Feature 1: Line filter badge row */}
      <div style={{
        position: 'absolute',
        bottom: isMobile
          ? 'calc(56px + env(safe-area-inset-bottom) + 52px)'
          : '52px',
        right: 12,
        display: 'flex',
        flexDirection: 'row',
        gap: 2,
        overflowX: 'auto',
        maxWidth: 'calc(100vw - 24px)',
        scrollbarWidth: 'none',
        padding: '4px 0',
      }}>
        {routes.map(route => {
          const color = MTA_LINE_COLORS[route]
          const isActive = activeFilter === route
          const isExpress = EXPRESS_ROUTES.has(route)
          const isYellow = ['N', 'Q', 'R', 'W'].includes(route)
          const fg = isYellow ? '#000' : '#fff'
          return (
            <button
              key={route}
              onClick={() => setActiveFilter(isActive ? null : route)}
              title={`Filter to ${route} line`}
              style={{
                all: 'unset',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                flexShrink: 0,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                opacity: isActive ? 1 : 0.55,
                transition: 'opacity 0.15s',
              }}
            >
              {isExpress ? (
                <span style={{
                  width: 30, height: 30,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  outline: isActive ? '2px solid #fff' : 'none',
                  outlineOffset: 1,
                  borderRadius: 2,
                }}>
                  <span style={{
                    width: 22, height: 22,
                    background: color,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transform: 'rotate(45deg)',
                  }}>
                    <span style={{
                      color: fg, fontWeight: 700, fontSize: 10, fontFamily: 'sans-serif',
                      transform: 'rotate(-45deg)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>{route}</span>
                  </span>
                </span>
              ) : (
                <span style={{
                  width: 30, height: 30,
                  borderRadius: '50%',
                  background: color,
                  border: isActive ? '2px solid #fff' : '2px solid transparent',
                  boxShadow: isActive ? '0 0 0 1px rgba(255,255,255,0.6)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: fg, fontWeight: 700, fontSize: 10,
                  flexShrink: 0,
                  transition: 'box-shadow 0.15s',
                }}>
                  {route}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Locate me button */}
      <button
        onClick={handleLocate}
        title="Show my location"
        style={{
          position: 'absolute', bottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom) + 12px)' : 12, right: 12,
          width: 36, height: 36,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          border: '1px solid var(--border)', borderRadius: 3,
          color: '#3b82f6', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}
      >
        ◎
      </button>
    </div>
  )
}
