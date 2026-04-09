# subway-intel

Real-time NYC subway intelligence. Live train positions, delay prediction, and smart commute timing — powered by the MTA GTFS-Realtime feed.

## What It Does

**My Stations** — real-time arrivals for saved stops, pushed live via WebSocket. No polling, no refresh.

**Smart Commute** — enter your destination, get a "leave in X minutes" recommendation based on live train positions and current delays.

**Network Pulse** — system-wide health at a glance. Line status, active service alerts, and delay severity across all subway lines.

**Delay Intelligence** — heuristic delay scoring derived from live trip data. Detects and surfaces delays before the MTA announces them. ML prediction layer planned once historical data accumulates.

## Architecture

```
MTA GTFS-RT feed
       │
       ▼
  Fargate (Python)
  ├── GTFS-RT parser (protobuf)
  ├── In-memory live state
  ├── WebSocket server → browsers
  ├── FastAPI (REST) → historical queries, commute math
  └── TimescaleDB writer
       │
       ▼
  TimescaleDB (Postgres)
  ├── train_positions hypertable
  ├── service_alerts hypertable
  └── continuous aggregates (5m / 1h / 1d rollups)
       │
       ▼
  React + Vite (S3 + CloudFront)
```

## Stack

| Layer | Tech |
|---|---|
| Live data | MTA GTFS-Realtime (protobuf) |
| Backend | Python, FastAPI, WebSockets |
| Database | TimescaleDB (Postgres) |
| Infrastructure | AWS CDK — Fargate, ALB, RDS, S3, CloudFront |
| Frontend | React, Vite |

## Roadmap

**Phase 1 — Feed-smart**
- [ ] GTFS-RT ingestion + normalization
- [ ] WebSocket broadcast to frontend
- [ ] My Stations view
- [ ] Network Pulse view
- [ ] Smart Commute calculator
- [ ] TimescaleDB historical accumulation

**Phase 2 — ML layer**
- [ ] Delay prediction model (trained on accumulated history)
- [ ] Line health scoring
- [ ] Anomaly detection
- [ ] iOS app

## Getting Started

You'll need an MTA API key from [api.mta.info](https://api.mta.info).

```bash
git clone https://github.com/jtannahill/subway-intel
cd subway-intel
cp .env.example .env  # add your MTA API key
```

Infrastructure:
```bash
cd cdk
npm install
cdk deploy
```

## License

MIT
