# subway-intel

Real-time NYC subway intelligence. Live train positions, countdowns, delay detection, and smart commute timing — powered by the MTA GTFS-Realtime feed.

**Live:** [mta.jamestannahill.com](https://mta.jamestannahill.com)

## Features

**Nearby** — auto-detects your location on arrival. Search any station or NYC address as an alternative. Shows the 3 nearest stations with distance in miles and blocks. Select any to see live arrivals with route badges and a full track diagram anchored to your position.

**My Stations** — choose uptown, downtown, or both directions before saving. Arrivals count down in m:ss format, ticking every second, with a route badge on each tile. Paired N+S stops render under a shared station header.

**Arrival Feedback Loop** — a HERE? prompt appears when a train is due NOW. Y/N responses are logged and used to compute per-route timing bias, which is applied as a correction to all displayed countdowns.

**Smart Commute** — enter your destination, get a "leave in X minutes" recommendation based on live train positions and current delays.

**Network Pulse** — system-wide health at a glance. Line status, active service alerts, and delay severity across all subway lines.

**Delay Intelligence** — heuristic delay scoring derived from live trip data. Surfaces delays before the MTA announces them.

**Track Diagram** — scrollable horizontal diagram per route showing uptown and downtown tracks, live train positions (interpolated by GTFS-RT status), and a YOU ARE HERE marker anchored to your station.

**Map View** — full-screen Mapbox GL JS map with live vehicle position markers, stop pins for all lines, and real-time updates via WebSocket.

**Plan View** — trip planning UI for querying routes between any two NYC stops.

**Mobile + iOS PWA** — bottom navigation bar, 100dvh layout with safe-area insets, larger touch targets. Add to Home Screen on iOS for a full-screen app experience.

## Architecture

```
MTA GTFS-Realtime feed (protobuf) + camsys alerts JSON
          │
          ▼
    Python / FastAPI (EC2 t3.small)
    ├── GTFS-RT parser (trips, vehicles, alerts)
    ├── In-memory live state (LiveState)
    ├── WebSocket broadcast → browsers
    ├── REST API (arrivals, stops, nearest, routes, alerts, vehicles)
    ├── config.py (Mapbox token via Secrets Manager or .env)
    └── TimescaleDB writer
          │
          ▼
    TimescaleDB (Postgres)
    ├── train_positions hypertable
    ├── service_alerts hypertable
    └── continuous aggregates (5m / 1h / 1d rollups)
          │
          ▼
    React 19 + Vite + Mapbox GL JS (served via FastAPI on same EC2)
```

## Stack

| Layer | Tech |
|---|---|
| Live feed | MTA GTFS-Realtime (protobuf) |
| Backend | Python, FastAPI, WebSockets |
| Database | TimescaleDB (Postgres) |
| Infrastructure | EC2 t3.small, Cloudflare SSL/DNS |
| Frontend | React 19, TypeScript, Vite, Mapbox GL JS |

## Roadmap

**Phase 1 — Live intelligence** ✓
- [x] GTFS-RT ingestion + normalization
- [x] WebSocket broadcast to frontend
- [x] My Stations — saved stops with live arrivals
- [x] Network Pulse — system-wide health
- [x] Smart Commute calculator
- [x] Nearby — GPS + address search, 3 nearest stations, mi + blocks
- [x] Track diagram — live train positions per route
- [x] Live m:ss countdown timers (ticking every second)
- [x] Arrival feedback loop — HERE? Y/N corrections applied to countdowns
- [x] Uptown/Downtown direction picker on save
- [x] Mobile-first layout + iOS PWA mode
- [x] TimescaleDB historical accumulation
- [x] Map View — live vehicle positions on Mapbox GL JS
- [x] Plan View — trip planning UI
- [x] OG image + full social/iMessage meta tags

**Phase 2 — ML layer**
- [ ] Delay prediction model (trained on accumulated history)
- [ ] Anomaly detection
- [ ] Trip planner backend (route graph + transfer logic)
- [ ] iOS app

## Getting Started

You'll need an MTA API key from [api.mta.info](https://api.mta.info).

```bash
git clone https://github.com/jtannahill/subway-intel
cd subway-intel
cp .env.example .env  # add your MTA API key and Mapbox token
```

Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

## License

MIT
