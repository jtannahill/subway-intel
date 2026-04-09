# subway-intel — Design Spec
**Date:** 2026-04-09
**Status:** Approved

---

## Overview

subway-intel is a personal web application that surfaces real-time NYC subway intelligence from the MTA GTFS-Realtime feed. It is not a commuter app that wraps MTA's own data display — it is an intelligence layer that detects delays before they're announced, computes smart departure timing, and accumulates a historical dataset for future ML modeling.

Personal project. No auth, no payments, no growth requirements.

---

## Architecture

### Backend — Fargate (Python)

A single always-on container running two servers:

**GTFS-RT Consumer**
- Polls MTA GTFS-Realtime protobuf feeds every 30 seconds (subway vehicle positions, trip updates, service alerts)
- Parses protobuf into normalized internal state: `{route_id, trip_id, stop_id, arrival_time, delay_seconds, timestamp}`
- Maintains in-memory live state: current arrivals per stop, line health scores, active alerts
- Computes heuristic delay signals on each update cycle (rolling average lag per route, gap detection, headway variance)
- Broadcasts diffs to all connected WebSocket clients on each update

**FastAPI (REST)**
- `/api/stations/{stop_id}/arrivals` — live + next 3 arrivals for a stop
- `/api/commute` — smart commute calculation (departure time given origin stop + destination stop)
- `/api/network` — system-wide line health snapshot
- `/api/delay-intel` — per-line delay signals + recent anomalies
- `/api/history/{route_id}` — historical delay patterns from TimescaleDB

### Database — TimescaleDB

Postgres with TimescaleDB extension. Two hypertables:

```sql
train_positions (
  time        TIMESTAMPTZ NOT NULL,
  trip_id     TEXT,
  route_id    TEXT,
  stop_id     TEXT,
  arrival_est TIMESTAMPTZ,
  delay_sec   INTEGER
)

service_alerts (
  time      TIMESTAMPTZ NOT NULL,
  route_id  TEXT,
  effect    TEXT,
  severity  TEXT,
  header    TEXT
)
```

Continuous aggregates compute 5-minute, 1-hour, and 1-day rollups per route automatically. This accumulating dataset is the ML training set for Phase 2.

Hosted on a small EC2 instance (t3.micro) or RDS Postgres with the TimescaleDB extension.

### Frontend — React + Vite

Static build deployed to S3 + CloudFront. Mobile-first but designed for desktop sidebar layout.

**Visual style:** Dark terminal. Near-black background (`#0d0d0d`), monospace typography, green (`#22c55e`) for nominal/good state, amber (`#f59e0b`) for delays, red (`#ef4444`) for disruptions. MTA official line colors used for route badges only.

**Navigation:** Fixed left sidebar, 180px wide. Four sections listed vertically with active indicator (green left border). System health status (Feed / DB / active alerts) at the bottom of the sidebar.

**WebSocket:** Single persistent connection to Fargate. On reconnect, fetches current snapshot via REST then resumes live updates.

### Infrastructure — CDK

- `FargateStack` — ECS Fargate service, ALB, ECR repo, Secrets Manager (MTA API key)
- `DatabaseStack` — EC2 t3.micro with TimescaleDB, or RDS Postgres
- `FrontendStack` — S3 bucket, CloudFront distribution, Route53 alias

---

## Features

### My Stations

Default landing view. User saves 1–5 stops (stored in localStorage — no backend auth needed).

For each saved stop:
- Station name + line badge (MTA official color)
- Direction label (Uptown/Downtown/Queens-bound etc.)
- Next 3 arrival times as large monospace countdown tiles
- Delay badge if the next arrival is running late (e.g., `+3 MIN DELAY` in amber)
- Updates live via WebSocket — no manual refresh

`+ ADD STATION` opens a search input (fuzzy search over MTA stop list, ~500 stations).

### Smart Commute

User enters origin stop + destination stop. The system returns:

- **Leave in X minutes** — computed from: current arrival time at origin + estimated travel time to destination (static GTFS schedule) + 90-second walk buffer
- If the next train is delayed, the recommendation adjusts automatically
- Shows the specific trip it's based on (e.g., "Take the 6 at 3:42pm, arrives Grand Central 3:49pm")
- Updates live — if conditions change, the recommendation updates in place

Travel time uses static GTFS schedule data (pre-loaded at startup). No routing API needed.

### Network Pulse

System-wide health view. One row per subway line group (IRT, BMT, IND):

| Line | Status | Avg Delay | Alerts |
|------|--------|-----------|--------|
| 4/5/6 | NOMINAL | 0.4 min | — |
| 7 | DELAYED | 3.2 min | Signal issue reported |
| L | DISRUPTED | — | Service suspended btwn stations |

Clicking a line expands to show: per-direction status, last 5 service alerts (from TimescaleDB), and a 24-hour delay trend sparkline.

Status is computed from live heuristics — not pulled from MTA's status page. This means it can surface real conditions before MTA updates their status feed.

### Delay Intel

Per-line heuristic signals derived from the live feed:

- **Avg lag** — rolling 15-minute average of `delay_sec` per route
- **Gap detection** — headway variance: if trains on a line are bunching or gapping, flagged
- **Trend** — is the delay getting better or worse over the last 30 minutes?

Displayed as a signal strip (compact colored badges in My Stations) and a full table in the Delay Intel view.

Phase 2 will replace heuristics with an ML model trained on the accumulated TimescaleDB history.

---

## Data Flow

```
MTA GTFS-RT (every 30s)
  → Fargate parser
  → in-memory state + heuristic signals
  → WebSocket broadcast → browser (live updates)
  → TimescaleDB write (historical accumulation)

Browser request
  → REST API (historical queries, commute math)
  → TimescaleDB read
```

---

## Phase Roadmap

**Phase 1 — Feed-smart (now)**
- GTFS-RT ingestion, normalization, WebSocket broadcast
- All four views implemented with heuristic signals
- TimescaleDB accumulating history
- CDK deploy

**Phase 2 — ML layer (after ~30 days of history)**
- Delay prediction model: predict delays 10–15 min before MTA announces
- Line health scoring: composite score per route
- Anomaly detection: unusual gap or bunching patterns
- iOS app (React Native or Swift)

---

## Tech Stack Summary

| Layer | Choice |
|---|---|
| Feed | MTA GTFS-Realtime (protobuf) |
| Backend | Python, FastAPI, WebSockets, gtfs-realtime-bindings |
| Database | TimescaleDB on EC2 t3.micro |
| Infra | AWS CDK — Fargate, ALB, S3, CloudFront |
| Frontend | React, Vite, Tailwind CSS |
| State | localStorage (no auth) |
