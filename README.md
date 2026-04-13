# subway-intel

Real-time NYC subway intelligence. Live train positions, countdowns, delay detection, and smart commute timing — powered by the MTA GTFS-Realtime feed.

**Live:** [mta.jamestannahill.com](https://mta.jamestannahill.com)

## Features

**Nearby** — tap Use My Location or search any station or NYC address. Shows the 3 nearest stations with distance in miles and blocks. Select any to see live arrivals, route badges, and a full track diagram with moving train dots.

**My Stations** — save stops in either direction (uptown / downtown / both). Arrivals update live every second with wall-clock-synced countdown timers. Paired N+S stops render under a shared station header.

**Smart Commute** — enter your destination, get a "leave in X minutes" recommendation based on live train positions and current delays.

**Network Pulse** — system-wide health at a glance. Line status, active service alerts, and delay severity across all subway lines.

**Delay Intelligence** — heuristic delay scoring derived from live trip data. Surfaces delays before the MTA announces them.

**Track Diagram** — scrollable horizontal diagram per route showing uptown and downtown tracks, live train positions (interpolated by GTFS-RT status), and a YOU ARE HERE marker anchored to your station.

## Architecture

```
MTA GTFS-Realtime feed (protobuf)
          │
          ▼
    Python / FastAPI (EC2 t3.small)
    ├── GTFS-RT parser
    ├── In-memory live state
    ├── WebSocket broadcast → browsers
    ├── REST API (arrivals, stops, nearest, routes, alerts)
    └── TimescaleDB writer
          │
          ▼
    TimescaleDB (Postgres)
    ├── train_positions hypertable
    ├── service_alerts hypertable
    └── continuous aggregates (5m / 1h / 1d rollups)
          │
          ▼
    React 19 + Vite (served via nginx on same EC2)
```

## Stack

| Layer | Tech |
|---|---|
| Live feed | MTA GTFS-Realtime (protobuf) |
| Backend | Python, FastAPI, WebSockets |
| Database | TimescaleDB (Postgres) |
| Infrastructure | EC2 t3.small, Cloudflare SSL/DNS |
| Frontend | React 19, TypeScript, Vite |

## Roadmap

**Phase 1 — Live intelligence** ✓
- [x] GTFS-RT ingestion + normalization
- [x] WebSocket broadcast to frontend
- [x] My Stations — saved stops with live arrivals
- [x] Network Pulse — system-wide health
- [x] Smart Commute calculator
- [x] Nearby — GPS + address search, 3 nearest stations, mi + blocks
- [x] Track diagram — live train positions per route
- [x] Wall-clock-synced countdown timers
- [x] TimescaleDB historical accumulation

**Phase 2 — ML layer**
- [ ] Delay prediction model (trained on accumulated history)
- [ ] Anomaly detection
- [ ] iOS app

## Getting Started

You'll need an MTA API key from [api.mta.info](https://api.mta.info).

```bash
git clone https://github.com/jtannahill/subway-intel
cd subway-intel
cp .env.example .env  # add your MTA API key
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
