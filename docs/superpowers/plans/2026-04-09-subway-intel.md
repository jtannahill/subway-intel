# subway-intel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time NYC subway intelligence web app powered by the MTA GTFS-Realtime feed — live arrivals, smart commute timing, network health, and heuristic delay detection.

**Architecture:** Python/FastAPI backend on Fargate polls GTFS-RT every 30s, maintains in-memory live state, broadcasts diffs via WebSocket, and writes historical records to TimescaleDB. React/Vite frontend connects via WebSocket for zero-refresh live updates, with a dark terminal aesthetic and sidebar navigation.

**Tech Stack:** Python 3.12, FastAPI, asyncpg, gtfs-realtime-bindings, React 18, Vite, Tailwind CSS, TimescaleDB (Postgres), AWS CDK (TypeScript), Docker.

---

## File Map

```
subway-intel/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                      # App entrypoint — wires polling loop + FastAPI
│   ├── gtfs/
│   │   ├── __init__.py
│   │   ├── models.py                # ArrivalRecord, ServiceAlert, LineHealth dataclasses
│   │   ├── feed.py                  # GTFS-RT HTTP fetch + protobuf parse → ArrivalRecord list
│   │   ├── state.py                 # In-memory store: arrivals per stop, alerts, line health
│   │   └── static.py               # Static GTFS loader: stop names, stop_times for commute math
│   ├── heuristics/
│   │   ├── __init__.py
│   │   ├── delay.py                 # Rolling avg, gap detection, headway variance → LineHealth
│   │   └── commute.py              # Smart commute: given origin+dest, return departure advice
│   ├── db/
│   │   ├── __init__.py
│   │   ├── schema.sql               # CREATE TABLE + hypertable SQL
│   │   ├── client.py                # asyncpg pool init/teardown
│   │   └── writer.py               # Async write train_positions + service_alerts
│   ├── api/
│   │   ├── __init__.py
│   │   ├── websocket.py             # ConnectionManager + /ws endpoint
│   │   └── routes.py               # REST endpoints: /arrivals, /commute, /network, /delay-intel
│   └── tests/
│       ├── conftest.py              # Shared fixtures (feed bytes, sample records)
│       ├── test_feed.py
│       ├── test_state.py
│       ├── test_heuristics.py
│       ├── test_commute.py
│       └── test_api.py
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css                # Dark terminal CSS variables + global styles
│       ├── constants/
│       │   ├── mta-colors.ts        # Route ID → hex color map
│       │   └── stops.ts             # stop_id → {name, routes[]} lookup
│       ├── hooks/
│       │   ├── useWebSocket.ts      # WS connection, reconnect, message dispatch
│       │   ├── useStations.ts       # localStorage saved stations (add/remove/reorder)
│       │   └── useLiveData.ts       # Merges REST snapshot + WS diffs into app state
│       ├── components/
│       │   ├── Sidebar.tsx          # Left nav + system health dots
│       │   ├── ArrivalCard.tsx      # One station: badges + countdown tiles
│       │   ├── LineBadge.tsx        # Colored MTA circle (route letter/number)
│       │   ├── DelayBadge.tsx       # +X MIN DELAY amber badge
│       │   └── SignalStrip.tsx      # Compact per-line status badges
│       └── views/
│           ├── MyStations.tsx
│           ├── SmartCommute.tsx
│           ├── NetworkPulse.tsx
│           └── DelayIntel.tsx
├── cdk/
│   ├── package.json
│   ├── tsconfig.json
│   ├── cdk.json
│   ├── bin/subway-intel.ts
│   └── lib/
│       ├── fargate-stack.ts
│       ├── database-stack.ts
│       └── frontend-stack.ts
├── .env.example
└── .gitignore
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/gtfs/__init__.py`, `backend/heuristics/__init__.py`, `backend/db/__init__.py`, `backend/api/__init__.py`, `backend/tests/`
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tailwind.config.ts`
- Create: `.env.example`, `.gitignore`

- [ ] **Step 1: Create backend directory structure**

```bash
cd /Users/jamest/subway-intel
mkdir -p backend/{gtfs,heuristics,db,api,tests}
touch backend/{gtfs,heuristics,db,api}/__init__.py
```

- [ ] **Step 2: Write backend/requirements.txt**

```
fastapi==0.111.0
uvicorn[standard]==0.30.1
websockets==12.0
gtfs-realtime-bindings==1.0.0
protobuf==4.25.3
httpx==0.27.0
asyncpg==0.29.0
pydantic==2.7.1
pydantic-settings==2.3.0
pytest==8.2.0
pytest-asyncio==0.23.7
httpx==0.27.0
```

- [ ] **Step 3: Write .env.example**

```bash
cat > .env.example << 'EOF'
MTA_API_KEY=your_mta_api_key_here
DATABASE_URL=postgresql://subway:subway@localhost:5432/subway_intel
GTFS_POLL_INTERVAL_SEC=30
EOF
```

- [ ] **Step 4: Write .gitignore**

```bash
cat > .gitignore << 'EOF'
.env
__pycache__/
*.pyc
*.pyo
.pytest_cache/
node_modules/
dist/
.superpowers/
cdk.out/
*.egg-info/
.venv/
EOF
```

- [ ] **Step 5: Scaffold frontend with Vite**

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss @tailwindcss/vite
npx tailwindcss init
```

- [ ] **Step 6: Write frontend/tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Courier New', 'monospace'],
      },
    },
  },
} satisfies Config
```

- [ ] **Step 7: Write frontend/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
```

- [ ] **Step 8: Commit**

```bash
cd /Users/jamest/subway-intel
git add -A
git commit -m "feat: project scaffold — backend dirs, requirements, frontend vite+tailwind"
```

---

## Task 2: Data Models

**Files:**
- Create: `backend/gtfs/models.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_models.py
from datetime import datetime, timezone
from backend.gtfs.models import ArrivalRecord, ServiceAlert, LineHealth, LineStatus

def test_arrival_record_delay_minutes():
    r = ArrivalRecord(
        route_id='6',
        trip_id='trip-1',
        stop_id='631N',
        arrival_time=datetime(2026, 4, 9, 12, 0, 0, tzinfo=timezone.utc),
        delay_sec=180,
        direction='N',
    )
    assert r.delay_minutes == 3.0

def test_line_status_from_delay():
    assert LineHealth.status_from_delay(0) == LineStatus.NOMINAL
    assert LineHealth.status_from_delay(120) == LineStatus.DELAYED
    assert LineHealth.status_from_delay(600) == LineStatus.DISRUPTED
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd /Users/jamest/subway-intel/backend
python -m pytest tests/test_models.py -v
```
Expected: `ModuleNotFoundError: No module named 'backend.gtfs.models'`

- [ ] **Step 3: Write backend/gtfs/models.py**

```python
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class LineStatus(str, Enum):
    NOMINAL = 'NOMINAL'
    DELAYED = 'DELAYED'
    DISRUPTED = 'DISRUPTED'


@dataclass
class ArrivalRecord:
    route_id: str
    trip_id: str
    stop_id: str
    arrival_time: datetime
    delay_sec: int
    direction: str  # 'N' or 'S'

    @property
    def delay_minutes(self) -> float:
        return self.delay_sec / 60.0


@dataclass
class ServiceAlert:
    route_id: str
    effect: str
    severity: str
    header: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class LineHealth:
    route_id: str
    status: LineStatus
    avg_delay_sec: float
    headway_variance: float
    alerts: list[str] = field(default_factory=list)

    @staticmethod
    def status_from_delay(avg_delay_sec: float) -> LineStatus:
        if avg_delay_sec < 60:
            return LineStatus.NOMINAL
        if avg_delay_sec < 300:
            return LineStatus.DELAYED
        return LineStatus.DISRUPTED
```

- [ ] **Step 4: Run test — expect pass**

```bash
python -m pytest tests/test_models.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/gtfs/models.py backend/tests/test_models.py
git commit -m "feat: data models — ArrivalRecord, ServiceAlert, LineHealth"
```

---

## Task 3: GTFS-RT Feed Parser

**Files:**
- Create: `backend/gtfs/feed.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_feed.py`

- [ ] **Step 1: Write conftest.py with a synthetic feed fixture**

```python
# backend/tests/conftest.py
import pytest
from datetime import datetime, timezone
from google.transit import gtfs_realtime_pb2


@pytest.fixture
def sample_feed_bytes() -> bytes:
    """Minimal GTFS-RT FeedMessage with one TripUpdate."""
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = '2.0'
    feed.header.timestamp = int(datetime(2026, 4, 9, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    entity = feed.entity.add()
    entity.id = 'trip-1'
    entity.trip_update.trip.route_id = '6'
    entity.trip_update.trip.trip_id = 'trip-1'

    stu = entity.trip_update.stop_time_update.add()
    stu.stop_id = '631N'
    stu.arrival.time = int(datetime(2026, 4, 9, 12, 2, 0, tzinfo=timezone.utc).timestamp())
    stu.arrival.delay = 120  # 2 min late

    return feed.SerializeToString()
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_feed.py
import pytest
from backend.gtfs.feed import parse_feed
from backend.gtfs.models import ArrivalRecord


def test_parse_feed_returns_arrival_records(sample_feed_bytes):
    records = parse_feed(sample_feed_bytes)
    assert len(records) == 1
    r = records[0]
    assert isinstance(r, ArrivalRecord)
    assert r.route_id == '6'
    assert r.stop_id == '631N'
    assert r.delay_sec == 120
    assert r.direction == 'N'


def test_parse_feed_empty_bytes():
    records = parse_feed(b'')
    assert records == []
```

- [ ] **Step 3: Run test — expect failure**

```bash
python -m pytest tests/test_feed.py -v
```
Expected: `ModuleNotFoundError: No module named 'backend.gtfs.feed'`

- [ ] **Step 4: Write backend/gtfs/feed.py**

```python
from __future__ import annotations
import logging
from datetime import datetime, timezone

import httpx
from google.transit import gtfs_realtime_pb2

from backend.gtfs.models import ArrivalRecord, ServiceAlert

logger = logging.getLogger(__name__)

MTA_FEED_URLS = {
    'gtfs':    'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
    'gtfs-ace':'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
    'gtfs-bdfm':'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
    'gtfs-g':  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
    'gtfs-jz': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
    'gtfs-l':  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
    'gtfs-nqrw':'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
    'gtfs-si': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si',
}


def parse_feed(data: bytes) -> list[ArrivalRecord]:
    """Parse raw GTFS-RT protobuf bytes into ArrivalRecord list."""
    if not data:
        return []
    try:
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(data)
    except Exception as e:
        logger.warning('Failed to parse GTFS-RT feed: %s', e)
        return []

    records: list[ArrivalRecord] = []
    for entity in feed.entity:
        if not entity.HasField('trip_update'):
            continue
        tu = entity.trip_update
        route_id = tu.trip.route_id
        trip_id = tu.trip.trip_id

        for stu in tu.stop_time_update:
            if not stu.HasField('arrival'):
                continue
            stop_id = stu.stop_id
            direction = stop_id[-1] if stop_id and stop_id[-1] in ('N', 'S') else 'N'
            arrival_time = datetime.fromtimestamp(stu.arrival.time, tz=timezone.utc)
            delay_sec = stu.arrival.delay if stu.arrival.HasField('delay') else 0
            records.append(ArrivalRecord(
                route_id=route_id,
                trip_id=trip_id,
                stop_id=stop_id,
                arrival_time=arrival_time,
                delay_sec=int(delay_sec),
                direction=direction,
            ))
    return records


def parse_alerts(data: bytes) -> list[ServiceAlert]:
    """Parse GTFS-RT service alerts feed."""
    if not data:
        return []
    try:
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(data)
    except Exception:
        return []

    alerts: list[ServiceAlert] = []
    for entity in feed.entity:
        if not entity.HasField('alert'):
            continue
        alert = entity.alert
        routes = [ie.route_id for ie in alert.informed_entity if ie.route_id]
        header = alert.header_text.translation[0].text if alert.header_text.translation else ''
        effect = str(alert.effect)
        for route_id in routes:
            alerts.append(ServiceAlert(
                route_id=route_id,
                effect=effect,
                severity='HIGH' if 'SUSPEND' in effect.upper() else 'LOW',
                header=header,
            ))
    return alerts


async def fetch_feed(url: str, api_key: str, client: httpx.AsyncClient) -> bytes:
    """Fetch a single GTFS-RT feed URL. Returns empty bytes on failure."""
    try:
        resp = await client.get(url, headers={'x-api-key': api_key}, timeout=10.0)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        logger.warning('Feed fetch failed for %s: %s', url, e)
        return b''
```

- [ ] **Step 5: Run test — expect pass**

```bash
python -m pytest tests/test_feed.py -v
```
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add backend/gtfs/feed.py backend/tests/conftest.py backend/tests/test_feed.py
git commit -m "feat: GTFS-RT protobuf parser — feed.py with parse_feed, parse_alerts, fetch_feed"
```

---

## Task 4: In-Memory State Manager

**Files:**
- Create: `backend/gtfs/state.py`
- Create: `backend/tests/test_state.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_state.py
from datetime import datetime, timezone
from backend.gtfs.models import ArrivalRecord, ServiceAlert, LineStatus
from backend.gtfs.state import LiveState


def _make_record(stop_id='631N', route_id='6', delay_sec=0, minutes_from_now=2):
    now = datetime.now(timezone.utc)
    from datetime import timedelta
    return ArrivalRecord(
        route_id=route_id,
        trip_id=f'trip-{stop_id}-{minutes_from_now}',
        stop_id=stop_id,
        arrival_time=now + timedelta(minutes=minutes_from_now),
        delay_sec=delay_sec,
        direction=stop_id[-1] if stop_id[-1] in ('N','S') else 'N',
    )


def test_ingest_updates_arrivals():
    state = LiveState()
    records = [_make_record('631N', '6', 0, 2), _make_record('631N', '6', 0, 5)]
    state.ingest(records, alerts=[])
    arrivals = state.get_arrivals('631N')
    assert len(arrivals) == 2
    assert arrivals[0].stop_id == '631N'


def test_get_arrivals_sorted_by_time():
    state = LiveState()
    records = [_make_record('631N', '6', 0, 8), _make_record('631N', '6', 0, 2)]
    state.ingest(records, alerts=[])
    arrivals = state.get_arrivals('631N')
    assert arrivals[0].arrival_time < arrivals[1].arrival_time


def test_line_health_snapshot():
    state = LiveState()
    records = [_make_record('631N', '6', delay_sec=200, minutes_from_now=3)]
    state.ingest(records, alerts=[])
    health = state.get_line_health()
    route_health = next(h for h in health if h.route_id == '6')
    assert route_health.status == LineStatus.DELAYED


def test_ingest_prunes_past_arrivals():
    state = LiveState()
    from datetime import timedelta
    past = ArrivalRecord(
        route_id='6', trip_id='old', stop_id='631N',
        arrival_time=datetime.now(timezone.utc) - timedelta(minutes=5),
        delay_sec=0, direction='N',
    )
    state.ingest([past], alerts=[])
    arrivals = state.get_arrivals('631N')
    assert len(arrivals) == 0
```

- [ ] **Step 2: Run test — expect failure**

```bash
python -m pytest tests/test_state.py -v
```
Expected: `ModuleNotFoundError: No module named 'backend.gtfs.state'`

- [ ] **Step 3: Write backend/gtfs/state.py**

```python
from __future__ import annotations
import threading
from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean, variance

from backend.gtfs.models import ArrivalRecord, LineHealth, LineStatus, ServiceAlert


class LiveState:
    """Thread-safe in-memory store for live subway state."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # stop_id → list of upcoming ArrivalRecords
        self._arrivals: dict[str, list[ArrivalRecord]] = defaultdict(list)
        # route_id → list of recent delay_sec values (last 30 updates)
        self._delay_history: dict[str, list[int]] = defaultdict(list)
        # route_id → list of recent headways (seconds between consecutive trains)
        self._headways: dict[str, list[float]] = defaultdict(list)
        # route_id → list of active alerts
        self._alerts: dict[str, list[str]] = defaultdict(list)

    def ingest(self, records: list[ArrivalRecord], alerts: list[ServiceAlert]) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            # Reset arrivals
            self._arrivals.clear()
            for r in records:
                if r.arrival_time > now:
                    self._arrivals[r.stop_id].append(r)

            # Update delay history per route (cap at 100 samples)
            for r in records:
                history = self._delay_history[r.route_id]
                history.append(r.delay_sec)
                if len(history) > 100:
                    history.pop(0)

            # Update headways: sort arrivals per route, compute gaps
            route_arrivals: dict[str, list[ArrivalRecord]] = defaultdict(list)
            for r in records:
                route_arrivals[r.route_id].append(r)
            for route_id, rarrivals in route_arrivals.items():
                sorted_arr = sorted(rarrivals, key=lambda x: x.arrival_time)
                gaps = []
                for i in range(1, len(sorted_arr)):
                    gap = (sorted_arr[i].arrival_time - sorted_arr[i-1].arrival_time).total_seconds()
                    if 0 < gap < 1800:  # ignore gaps > 30 min (end of service)
                        gaps.append(gap)
                if gaps:
                    hw = self._headways[route_id]
                    hw.extend(gaps)
                    if len(hw) > 50:
                        self._headways[route_id] = hw[-50:]

            # Reset alerts
            self._alerts.clear()
            for alert in alerts:
                self._alerts[alert.route_id].append(alert.header)

    def get_arrivals(self, stop_id: str, limit: int = 3) -> list[ArrivalRecord]:
        with self._lock:
            records = sorted(self._arrivals.get(stop_id, []), key=lambda r: r.arrival_time)
            return records[:limit]

    def get_line_health(self) -> list[LineHealth]:
        with self._lock:
            all_routes = set(self._delay_history.keys()) | set(self._alerts.keys())
            result = []
            for route_id in all_routes:
                history = self._delay_history.get(route_id, [0])
                avg_delay = mean(history) if history else 0.0
                hw = self._headways.get(route_id, [])
                hw_variance = variance(hw) if len(hw) >= 2 else 0.0
                status = LineHealth.status_from_delay(avg_delay)
                result.append(LineHealth(
                    route_id=route_id,
                    status=status,
                    avg_delay_sec=avg_delay,
                    headway_variance=hw_variance,
                    alerts=self._alerts.get(route_id, []),
                ))
            return sorted(result, key=lambda h: h.route_id)

    def snapshot(self) -> dict:
        """Return full state as a serializable dict for WebSocket broadcast."""
        now = datetime.now(timezone.utc)
        with self._lock:
            arrivals_out: dict[str, list[dict]] = {}
            for stop_id, records in self._arrivals.items():
                upcoming = [r for r in records if r.arrival_time > now]
                if upcoming:
                    arrivals_out[stop_id] = [
                        {
                            'route_id': r.route_id,
                            'trip_id': r.trip_id,
                            'arrival_time': r.arrival_time.isoformat(),
                            'delay_sec': r.delay_sec,
                            'direction': r.direction,
                        }
                        for r in sorted(upcoming, key=lambda x: x.arrival_time)[:3]
                    ]
            health = self.get_line_health()
            return {
                'type': 'snapshot',
                'arrivals': arrivals_out,
                'line_health': [
                    {
                        'route_id': h.route_id,
                        'status': h.status.value,
                        'avg_delay_sec': round(h.avg_delay_sec, 1),
                        'headway_variance': round(h.headway_variance, 1),
                        'alerts': h.alerts,
                    }
                    for h in health
                ],
            }
```

- [ ] **Step 4: Run test — expect pass**

```bash
python -m pytest tests/test_state.py -v
```
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/gtfs/state.py backend/tests/test_state.py
git commit -m "feat: in-memory live state manager with arrivals, delay history, line health"
```

---

## Task 5: Heuristic Signals + Commute Calculator

**Files:**
- Create: `backend/heuristics/delay.py`
- Create: `backend/heuristics/commute.py`
- Create: `backend/gtfs/static.py`
- Create: `backend/tests/test_heuristics.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_heuristics.py
from datetime import datetime, timezone, timedelta
from backend.heuristics.delay import compute_delay_signals
from backend.heuristics.commute import compute_departure
from backend.gtfs.models import ArrivalRecord, LineStatus


def _arrival(stop_id, route_id, delay_sec, minutes_from_now):
    return ArrivalRecord(
        route_id=route_id, trip_id=f't-{minutes_from_now}', stop_id=stop_id,
        arrival_time=datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now),
        delay_sec=delay_sec, direction='N',
    )


def test_delay_signals_nominal():
    records = [_arrival('631N', '6', 0, i) for i in range(2, 20, 3)]
    signals = compute_delay_signals(records)
    assert signals['6']['status'] == LineStatus.NOMINAL.value
    assert signals['6']['avg_delay_sec'] == 0.0


def test_delay_signals_delayed():
    records = [_arrival('631N', '6', 180, i) for i in range(2, 20, 3)]
    signals = compute_delay_signals(records)
    assert signals['6']['status'] == LineStatus.DELAYED.value


def test_compute_departure_returns_dict():
    now = datetime.now(timezone.utc)
    origin_arrival = ArrivalRecord(
        route_id='6', trip_id='t1', stop_id='631N',
        arrival_time=now + timedelta(minutes=3),
        delay_sec=0, direction='N',
    )
    result = compute_departure(
        next_arrival=origin_arrival,
        travel_sec=420,  # 7 min travel
    )
    assert 'leave_in_sec' in result
    assert 'arrive_at' in result
    assert result['leave_in_sec'] >= 0
```

- [ ] **Step 2: Run — expect failure**

```bash
python -m pytest tests/test_heuristics.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Write backend/heuristics/delay.py**

```python
from __future__ import annotations
from collections import defaultdict
from statistics import mean

from backend.gtfs.models import ArrivalRecord, LineHealth, LineStatus


def compute_delay_signals(records: list[ArrivalRecord]) -> dict[str, dict]:
    """
    Given a list of ArrivalRecords, compute per-route delay signals.
    Returns dict: route_id → {status, avg_delay_sec, trend}
    """
    by_route: dict[str, list[int]] = defaultdict(list)
    for r in records:
        by_route[r.route_id].append(r.delay_sec)

    signals = {}
    for route_id, delays in by_route.items():
        avg = mean(delays) if delays else 0.0
        status = LineHealth.status_from_delay(avg)
        signals[route_id] = {
            'route_id': route_id,
            'status': status.value,
            'avg_delay_sec': round(avg, 1),
        }
    return signals
```

- [ ] **Step 4: Write backend/heuristics/commute.py**

```python
from __future__ import annotations
from datetime import datetime, timezone, timedelta

from backend.gtfs.models import ArrivalRecord

WALK_BUFFER_SEC = 90  # 90s buffer built into every commute recommendation


def compute_departure(
    next_arrival: ArrivalRecord,
    travel_sec: int,
) -> dict:
    """
    Given the next arriving train and travel time to destination,
    return when to leave and when you'd arrive.

    leave_in_sec: seconds from now until you should leave
    arrive_at:    ISO datetime when you'd reach the destination
    """
    now = datetime.now(timezone.utc)
    board_at = next_arrival.arrival_time
    arrive_at = board_at + timedelta(seconds=travel_sec)
    leave_at = board_at - timedelta(seconds=WALK_BUFFER_SEC)
    leave_in_sec = max(0, int((leave_at - now).total_seconds()))

    return {
        'leave_in_sec': leave_in_sec,
        'board_at': board_at.isoformat(),
        'arrive_at': arrive_at.isoformat(),
        'route_id': next_arrival.route_id,
        'trip_id': next_arrival.trip_id,
        'delay_sec': next_arrival.delay_sec,
    }
```

- [ ] **Step 5: Write backend/gtfs/static.py**

This loads the static GTFS schedule at startup to power the commute calculator's travel time lookup.

```python
from __future__ import annotations
import csv
import io
import logging
import zipfile
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GTFS_STATIC_URL = 'http://web.mta.info/developers/data/nyct/subway/google_transit.zip'

# stop_id → {name: str, routes: list[str]}
_stops: dict[str, dict] = {}
# (origin_stop_id, dest_stop_id) → travel_sec  (naive: same trip lookup)
_travel_times: dict[tuple[str, str], int] = {}


def load(data_dir: Optional[Path] = None) -> None:
    """Download and parse static GTFS. Call once at startup."""
    global _stops, _travel_times
    try:
        if data_dir and (data_dir / 'google_transit.zip').exists():
            raw = (data_dir / 'google_transit.zip').read_bytes()
        else:
            logger.info('Downloading static GTFS...')
            resp = httpx.get(GTFS_STATIC_URL, timeout=30.0, follow_redirects=True)
            resp.raise_for_status()
            raw = resp.content
            if data_dir:
                data_dir.mkdir(parents=True, exist_ok=True)
                (data_dir / 'google_transit.zip').write_bytes(raw)

        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            _parse_stops(zf)
            _parse_stop_times(zf)
        logger.info('Static GTFS loaded: %d stops, %d travel pairs', len(_stops), len(_travel_times))
    except Exception as e:
        logger.error('Static GTFS load failed: %s', e)


def _parse_stops(zf: zipfile.ZipFile) -> None:
    global _stops
    with zf.open('stops.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            _stops[row['stop_id']] = {
                'name': row['stop_name'],
                'lat': float(row.get('stop_lat') or 0),
                'lon': float(row.get('stop_lon') or 0),
            }


def _parse_stop_times(zf: zipfile.ZipFile) -> None:
    """Build travel time lookup from stop_times.txt (same trip = direct travel)."""
    global _travel_times
    # trip_id → ordered list of (stop_id, arrival_seconds_since_midnight)
    trip_stops: dict[str, list[tuple[str, int]]] = {}
    with zf.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        for row in reader:
            trip_id = row['trip_id']
            stop_id = row['stop_id']
            arr = _parse_hhmmss(row.get('arrival_time', '0:0:0'))
            if trip_id not in trip_stops:
                trip_stops[trip_id] = []
            trip_stops[trip_id].append((stop_id, arr))

    for stops in trip_stops.values():
        stops.sort(key=lambda x: x[1])
        for i, (orig, t_orig) in enumerate(stops):
            for dest, t_dest in stops[i+1:]:
                key = (orig, dest)
                travel = t_dest - t_orig
                if key not in _travel_times or travel < _travel_times[key]:
                    _travel_times[key] = travel


def _parse_hhmmss(s: str) -> int:
    parts = s.strip().split(':')
    if len(parts) != 3:
        return 0
    h, m, sec = int(parts[0]), int(parts[1]), int(parts[2])
    return h * 3600 + m * 60 + sec


def get_stop_name(stop_id: str) -> str:
    return _stops.get(stop_id, {}).get('name', stop_id)


def get_travel_sec(origin_stop_id: str, dest_stop_id: str) -> Optional[int]:
    return _travel_times.get((origin_stop_id, dest_stop_id))


def search_stops(query: str, limit: int = 10) -> list[dict]:
    q = query.lower()
    results = [
        {'stop_id': sid, 'name': info['name']}
        for sid, info in _stops.items()
        if q in info['name'].lower()
    ]
    return results[:limit]
```

- [ ] **Step 6: Run tests — expect pass**

```bash
python -m pytest tests/test_heuristics.py -v
```
Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add backend/heuristics/ backend/gtfs/static.py backend/tests/test_heuristics.py
git commit -m "feat: heuristic delay signals + commute calculator + static GTFS loader"
```

---

## Task 6: Database Client + Writer

**Files:**
- Create: `backend/db/schema.sql`
- Create: `backend/db/client.py`
- Create: `backend/db/writer.py`

No DB available in local test environment — skip TDD for this task, write integration-ready code.

- [ ] **Step 1: Write backend/db/schema.sql**

```sql
-- Run once against TimescaleDB instance
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS train_positions (
    time         TIMESTAMPTZ NOT NULL,
    trip_id      TEXT,
    route_id     TEXT,
    stop_id      TEXT,
    arrival_est  TIMESTAMPTZ,
    delay_sec    INTEGER
);
SELECT create_hypertable('train_positions', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_train_positions_route ON train_positions (route_id, time DESC);

CREATE TABLE IF NOT EXISTS service_alerts (
    time      TIMESTAMPTZ NOT NULL,
    route_id  TEXT,
    effect    TEXT,
    severity  TEXT,
    header    TEXT
);
SELECT create_hypertable('service_alerts', 'time', if_not_exists => TRUE);

-- 5-minute rollup: avg delay per route
CREATE MATERIALIZED VIEW IF NOT EXISTS delay_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    route_id,
    AVG(delay_sec) AS avg_delay_sec,
    COUNT(*) AS sample_count
FROM train_positions
GROUP BY bucket, route_id;

-- Retention: keep raw data for 90 days
SELECT add_retention_policy('train_positions', INTERVAL '90 days', if_not_exists => TRUE);
```

- [ ] **Step 2: Write backend/db/client.py**

```python
from __future__ import annotations
import logging
import os
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)
_pool: Optional[asyncpg.Pool] = None


async def init_pool(dsn: Optional[str] = None) -> None:
    global _pool
    url = dsn or os.environ.get('DATABASE_URL', '')
    if not url:
        logger.warning('DATABASE_URL not set — DB writes disabled')
        return
    try:
        _pool = await asyncpg.create_pool(url, min_size=2, max_size=10, command_timeout=10)
        logger.info('TimescaleDB pool ready')
    except Exception as e:
        logger.error('DB pool init failed: %s', e)
        _pool = None


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> Optional[asyncpg.Pool]:
    return _pool
```

- [ ] **Step 3: Write backend/db/writer.py**

```python
from __future__ import annotations
import logging
from datetime import datetime, timezone

from backend.db.client import get_pool
from backend.gtfs.models import ArrivalRecord, ServiceAlert

logger = logging.getLogger(__name__)


async def write_arrivals(records: list[ArrivalRecord]) -> None:
    pool = get_pool()
    if not pool or not records:
        return
    now = datetime.now(timezone.utc)
    rows = [
        (now, r.trip_id, r.route_id, r.stop_id, r.arrival_time, r.delay_sec)
        for r in records
    ]
    try:
        await pool.executemany(
            """
            INSERT INTO train_positions (time, trip_id, route_id, stop_id, arrival_est, delay_sec)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            rows,
        )
    except Exception as e:
        logger.error('write_arrivals failed: %s', e)


async def write_alerts(alerts: list[ServiceAlert]) -> None:
    pool = get_pool()
    if not pool or not alerts:
        return
    rows = [
        (a.timestamp, a.route_id, a.effect, a.severity, a.header)
        for a in alerts
    ]
    try:
        await pool.executemany(
            """
            INSERT INTO service_alerts (time, route_id, effect, severity, header)
            VALUES ($1, $2, $3, $4, $5)
            """,
            rows,
        )
    except Exception as e:
        logger.error('write_alerts failed: %s', e)
```

- [ ] **Step 4: Commit**

```bash
git add backend/db/
git commit -m "feat: TimescaleDB schema, asyncpg pool, async writer for positions + alerts"
```

---

## Task 7: WebSocket Broadcast Manager

**Files:**
- Create: `backend/api/websocket.py`
- Create: `backend/tests/test_api.py`

- [ ] **Step 1: Write failing test**

```python
# backend/tests/test_api.py
import pytest
from backend.api.websocket import ConnectionManager


def test_connection_manager_starts_empty():
    mgr = ConnectionManager()
    assert mgr.connection_count == 0


def test_connection_manager_broadcast_no_connections():
    """broadcast with no connections should not raise."""
    import asyncio
    mgr = ConnectionManager()
    asyncio.run(mgr.broadcast({'type': 'snapshot', 'arrivals': {}}))
```

- [ ] **Step 2: Run — expect failure**

```bash
python -m pytest tests/test_api.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Write backend/api/websocket.py**

```python
from __future__ import annotations
import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.append(ws)
        logger.info('WS connected. Total: %d', len(self._connections))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections = [c for c in self._connections if c is not ws]
        logger.info('WS disconnected. Total: %d', len(self._connections))

    async def broadcast(self, data: dict[str, Any]) -> None:
        if not self._connections:
            return
        payload = json.dumps(data)
        dead: list[WebSocket] = []
        async with self._lock:
            conns = list(self._connections)
        for ws in conns:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                self._connections = [c for c in self._connections if c not in dead]


manager = ConnectionManager()
```

- [ ] **Step 4: Run — expect pass**

```bash
python -m pytest tests/test_api.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/api/websocket.py backend/tests/test_api.py
git commit -m "feat: WebSocket ConnectionManager with async broadcast"
```

---

## Task 8: REST API + Main App Entrypoint

**Files:**
- Create: `backend/api/routes.py`
- Create: `backend/main.py`
- Create: `backend/Dockerfile`

- [ ] **Step 1: Write backend/api/routes.py**

```python
from __future__ import annotations
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from backend.api.websocket import manager
from backend.gtfs import state as live_state_module
from backend.gtfs.static import get_travel_sec, search_stops
from backend.heuristics.commute import compute_departure
from backend.heuristics.delay import compute_delay_signals

router = APIRouter()
_state = None  # injected at startup via set_state()


def set_state(s) -> None:
    global _state
    _state = s


@router.get('/api/stations/{stop_id}/arrivals')
async def get_arrivals(stop_id: str):
    if _state is None:
        raise HTTPException(503, 'State not ready')
    arrivals = _state.get_arrivals(stop_id)
    return {
        'stop_id': stop_id,
        'arrivals': [
            {
                'route_id': r.route_id,
                'arrival_time': r.arrival_time.isoformat(),
                'delay_sec': r.delay_sec,
                'direction': r.direction,
            }
            for r in arrivals
        ],
    }


@router.get('/api/commute')
async def get_commute(origin: str, destination: str):
    if _state is None:
        raise HTTPException(503, 'State not ready')
    arrivals = _state.get_arrivals(origin)
    if not arrivals:
        raise HTTPException(404, f'No upcoming trains at {origin}')
    travel_sec = get_travel_sec(origin, destination)
    if travel_sec is None:
        raise HTTPException(404, f'No route found from {origin} to {destination}')
    return compute_departure(next_arrival=arrivals[0], travel_sec=travel_sec)


@router.get('/api/network')
async def get_network():
    if _state is None:
        raise HTTPException(503, 'State not ready')
    health = _state.get_line_health()
    return {
        'lines': [
            {
                'route_id': h.route_id,
                'status': h.status.value,
                'avg_delay_sec': round(h.avg_delay_sec, 1),
                'headway_variance': round(h.headway_variance, 1),
                'alerts': h.alerts,
            }
            for h in health
        ]
    }


@router.get('/api/delay-intel')
async def get_delay_intel():
    if _state is None:
        raise HTTPException(503, 'State not ready')
    health = _state.get_line_health()
    # Flatten all arrivals to compute fresh signals
    all_arrivals: list = []
    for stop_arrivals in _state._arrivals.values():
        all_arrivals.extend(stop_arrivals)
    signals = compute_delay_signals(all_arrivals)
    return {'signals': list(signals.values())}


@router.get('/api/stops/search')
async def search_stops_api(q: str, limit: int = 10):
    return {'results': search_stops(q, limit)}


@router.websocket('/ws')
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    # Send immediate snapshot on connect
    if _state is not None:
        await ws.send_text(__import__('json').dumps(_state.snapshot()))
    try:
        while True:
            await ws.receive_text()  # keep-alive, ignore incoming
    except WebSocketDisconnect:
        await manager.disconnect(ws)
```

- [ ] **Step 2: Write backend/main.py**

```python
from __future__ import annotations
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router, set_state
from backend.db.client import close_pool, init_pool
from backend.gtfs.feed import MTA_FEED_URLS, fetch_feed, parse_alerts, parse_feed
from backend.gtfs.state import LiveState
from backend.gtfs import static as gtfs_static
from backend.api.websocket import manager

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
logger = logging.getLogger(__name__)

MTA_API_KEY = os.environ.get('MTA_API_KEY', '')
POLL_INTERVAL = int(os.environ.get('GTFS_POLL_INTERVAL_SEC', '30'))

_live_state = LiveState()


async def poll_loop() -> None:
    """Background task: fetch all GTFS-RT feeds every POLL_INTERVAL seconds."""
    from backend.db.writer import write_alerts, write_arrivals
    async with httpx.AsyncClient() as client:
        while True:
            try:
                all_records = []
                all_alerts = []
                for feed_id, url in MTA_FEED_URLS.items():
                    data = await fetch_feed(url, MTA_API_KEY, client)
                    all_records.extend(parse_feed(data))
                    all_alerts.extend(parse_alerts(data))

                _live_state.ingest(all_records, all_alerts)
                snapshot = _live_state.snapshot()
                await manager.broadcast(snapshot)
                await write_arrivals(all_records)
                await write_alerts(all_alerts)
                logger.info('Poll complete: %d records, %d alerts, %d ws clients',
                            len(all_records), len(all_alerts), manager.connection_count)
            except Exception as e:
                logger.error('Poll loop error: %s', e)
            await asyncio.sleep(POLL_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    gtfs_static.load(data_dir=Path('/tmp/gtfs'))
    set_state(_live_state)
    task = asyncio.create_task(poll_loop())
    yield
    task.cancel()
    await close_pool()


app = FastAPI(lifespan=lifespan)
app.include_router(router)

# Serve built frontend if dist/ exists
dist = Path(__file__).parent.parent / 'frontend' / 'dist'
if dist.exists():
    app.mount('/', StaticFiles(directory=str(dist), html=True), name='frontend')
```

- [ ] **Step 3: Write backend/Dockerfile**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/dist/ ./frontend/dist/

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 4: Test app starts locally**

```bash
cd /Users/jamest/subway-intel
pip install -r backend/requirements.txt
MTA_API_KEY=test DATABASE_URL="" uvicorn backend.main:app --reload --port 8000
```
Expected: server starts, logs "Static GTFS loaded" (or download warning), no crashes.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routes.py backend/main.py backend/Dockerfile
git commit -m "feat: REST API endpoints + FastAPI app entrypoint + Dockerfile"
```

---

## Task 9: Frontend — Dark Terminal Theme + MTA Constants

**Files:**
- Create: `frontend/src/index.css`
- Create: `frontend/src/constants/mta-colors.ts`
- Create: `frontend/src/constants/stops.ts`

- [ ] **Step 1: Write frontend/src/index.css**

```css
@import "tailwindcss";

:root {
  --bg: #0d0d0d;
  --bg-surface: #111111;
  --bg-elevated: #1a1a1a;
  --border: #1e1e1e;
  --border-dim: #161616;
  --text-primary: #e2e8f0;
  --text-muted: #555555;
  --text-faint: #333333;
  --green: #22c55e;
  --green-dim: #0d1a0d;
  --green-border: #1a3a1a;
  --amber: #f59e0b;
  --amber-dim: #1a1200;
  --amber-border: #3d2e0a;
  --red: #ef4444;
  --red-dim: #1a0a0a;
  --red-border: #3d1a1a;
  --sidebar-width: 180px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  height: 100vh;
  overflow: hidden;
}

#root { height: 100vh; display: flex; flex-direction: column; }

/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }

/* Typography helpers */
.label { font-size: 9px; letter-spacing: 0.12em; color: var(--text-faint); text-transform: uppercase; }
.label-green { font-size: 9px; letter-spacing: 0.12em; color: var(--green); text-transform: uppercase; }
.mono-lg { font-size: 20px; font-weight: 700; font-family: inherit; }
.mono-sm { font-size: 10px; color: var(--text-muted); }

/* Card */
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 14px;
}
.card-delayed { border-color: var(--amber-border); }
.card-disrupted { border-color: var(--red-border); }

/* Status dot */
.dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: var(--green); }
.dot-amber { background: var(--amber); }
.dot-red { background: var(--red); }
.dot-dim { background: #333; }
```

- [ ] **Step 2: Write frontend/src/constants/mta-colors.ts**

```typescript
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
```

- [ ] **Step 3: Write frontend/src/constants/stops.ts (stub — populated from API)**

```typescript
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
```

- [ ] **Step 4: Update frontend/src/main.tsx**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/index.css frontend/src/constants/
git commit -m "feat: dark terminal CSS theme + MTA line colors + direction labels"
```

---

## Task 10: Frontend Hooks

**Files:**
- Create: `frontend/src/hooks/useWebSocket.ts`
- Create: `frontend/src/hooks/useStations.ts`
- Create: `frontend/src/hooks/useLiveData.ts`

- [ ] **Step 1: Write frontend/src/hooks/useWebSocket.ts**

```typescript
import { useEffect, useRef, useCallback } from 'react'

const RECONNECT_DELAY_MS = 3000

export function useWebSocket(onMessage: (data: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        onMessageRef.current(JSON.parse(e.data))
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      setTimeout(connect, RECONNECT_DELAY_MS)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])
}
```

- [ ] **Step 2: Write frontend/src/hooks/useStations.ts**

```typescript
import { useState, useCallback } from 'react'

export interface SavedStation {
  stop_id: string
  name: string
  direction: string  // 'N' or 'S'
  route_ids: string[]
}

const STORAGE_KEY = 'subway_intel_stations'
const MAX_STATIONS = 5

function loadFromStorage(): SavedStation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function useStations() {
  const [stations, setStations] = useState<SavedStation[]>(loadFromStorage)

  const persist = useCallback((next: SavedStation[]) => {
    setStations(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const addStation = useCallback((station: SavedStation) => {
    setStations((prev) => {
      if (prev.length >= MAX_STATIONS) return prev
      if (prev.some((s) => s.stop_id === station.stop_id && s.direction === station.direction)) return prev
      const next = [...prev, station]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeStation = useCallback((stop_id: string, direction: string) => {
    setStations((prev) => {
      const next = prev.filter((s) => !(s.stop_id === stop_id && s.direction === direction))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { stations, addStation, removeStation }
}
```

- [ ] **Step 3: Write frontend/src/hooks/useLiveData.ts**

```typescript
import { useState, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'

export interface ArrivalEntry {
  route_id: string
  arrival_time: string
  delay_sec: number
  direction: string
}

export interface LineHealthEntry {
  route_id: string
  status: 'NOMINAL' | 'DELAYED' | 'DISRUPTED'
  avg_delay_sec: number
  headway_variance: number
  alerts: string[]
}

export interface LiveData {
  arrivals: Record<string, ArrivalEntry[]>  // stop_id → arrivals
  lineHealth: LineHealthEntry[]
  connected: boolean
  lastUpdate: Date | null
}

const INITIAL: LiveData = {
  arrivals: {},
  lineHealth: [],
  connected: false,
  lastUpdate: null,
}

export function useLiveData(): LiveData {
  const [data, setData] = useState<LiveData>(INITIAL)

  const onMessage = useCallback((msg: unknown) => {
    const m = msg as { type: string; arrivals?: Record<string, ArrivalEntry[]>; line_health?: LineHealthEntry[] }
    if (m.type === 'snapshot') {
      setData({
        arrivals: m.arrivals ?? {},
        lineHealth: m.line_health ?? [],
        connected: true,
        lastUpdate: new Date(),
      })
    }
  }, [])

  useWebSocket(onMessage)
  return data
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/
git commit -m "feat: useWebSocket (reconnect), useStations (localStorage), useLiveData"
```

---

## Task 11: Sidebar + App Shell

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/LineBadge.tsx`
- Create: `frontend/src/components/DelayBadge.tsx`
- Create: `frontend/src/components/SignalStrip.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write frontend/src/components/LineBadge.tsx**

```tsx
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
```

- [ ] **Step 2: Write frontend/src/components/DelayBadge.tsx**

```tsx
interface Props { delaySec: number }

export function DelayBadge({ delaySec }: Props) {
  if (delaySec <= 30) return null
  const mins = Math.round(delaySec / 60)
  return (
    <span style={{
      background: 'var(--amber-dim)',
      border: '1px solid var(--amber-border)',
      borderRadius: 2,
      padding: '2px 6px',
      fontSize: 9,
      color: 'var(--amber)',
      letterSpacing: '0.05em',
    }}>
      +{mins} MIN DELAY
    </span>
  )
}
```

- [ ] **Step 3: Write frontend/src/components/SignalStrip.tsx**

```tsx
import type { LineHealthEntry } from '../hooks/useLiveData'

interface Props { health: LineHealthEntry[] }

const STATUS_COLORS = {
  NOMINAL: { bg: 'var(--green-dim)', border: 'var(--green-border)', text: 'var(--green)' },
  DELAYED: { bg: 'var(--amber-dim)', border: 'var(--amber-border)', text: 'var(--amber)' },
  DISRUPTED: { bg: 'var(--red-dim)', border: 'var(--red-border)', text: 'var(--red)' },
}

export function SignalStrip({ health }: Props) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {health.map((h) => {
        const c = STATUS_COLORS[h.status]
        return (
          <span key={h.route_id} style={{
            background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 2, padding: '3px 8px',
            fontSize: 10, color: c.text,
          }}>
            {h.route_id} · {h.status === 'NOMINAL' ? 'nominal' : `${Math.round(h.avg_delay_sec / 60)}m lag`}
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Write frontend/src/components/Sidebar.tsx**

```tsx
import type { LiveData } from '../hooks/useLiveData'

type View = 'stations' | 'commute' | 'pulse' | 'intel'

interface Props {
  active: View
  onNav: (v: View) => void
  liveData: LiveData
}

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'stations', label: 'MY STATIONS' },
  { id: 'commute',  label: 'SMART COMMUTE' },
  { id: 'pulse',    label: 'NETWORK PULSE' },
  { id: 'intel',    label: 'DELAY INTEL' },
]

export function Sidebar({ active, onNav, liveData }: Props) {
  const alertCount = liveData.lineHealth.filter(h => h.alerts.length > 0).length
  const hasDelays = liveData.lineHealth.some(h => h.status === 'DELAYED' || h.status === 'DISRUPTED')

  return (
    <aside style={{
      width: 'var(--sidebar-width)',
      flexShrink: 0,
      background: '#0a0a0a',
      borderRight: '1px solid var(--border-dim)',
      display: 'flex',
      flexDirection: 'column',
      padding: '16px 0',
    }}>
      <div style={{ padding: '0 12px', marginBottom: 20 }}>
        <div className="label">NAVIGATION</div>
      </div>

      {NAV_ITEMS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onNav(id)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'block',
            padding: '10px 12px',
            borderLeft: active === id ? '2px solid var(--green)' : '2px solid transparent',
            color: active === id ? 'var(--green)' : 'var(--text-faint)',
            fontSize: 11,
            letterSpacing: '0.06em',
            marginBottom: 2,
            transition: 'color 0.1s',
          }}
        >
          {label}
        </button>
      ))}

      <div style={{ marginTop: 'auto', padding: '0 12px', borderTop: '1px solid var(--border-dim)', paddingTop: 20 }}>
        <div className="label" style={{ marginBottom: 10 }}>SYSTEM</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <div className={`dot ${liveData.connected ? 'dot-green' : 'dot-dim'}`} />
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>Feed: {liveData.connected ? 'OK' : 'CONNECTING'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <div className={`dot ${hasDelays ? 'dot-amber' : 'dot-green'}`} />
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>
            {alertCount > 0 ? `${alertCount} alerts active` : 'No alerts'}
          </span>
        </div>
        {liveData.lastUpdate && (
          <div style={{ color: 'var(--text-faint)', fontSize: 9, marginTop: 8 }}>
            updated {Math.round((Date.now() - liveData.lastUpdate.getTime()) / 1000)}s ago
          </div>
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 5: Write frontend/src/App.tsx**

```tsx
import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { useLiveData } from './hooks/useLiveData'
import { useStations } from './hooks/useStations'
import { MyStations } from './views/MyStations'
import { SmartCommute } from './views/SmartCommute'
import { NetworkPulse } from './views/NetworkPulse'
import { DelayIntel } from './views/DelayIntel'

type View = 'stations' | 'commute' | 'pulse' | 'intel'

export default function App() {
  const [activeView, setActiveView] = useState<View>('stations')
  const liveData = useLiveData()
  const stationsCtx = useStations()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        background: '#111', borderBottom: '1px solid var(--border-dim)',
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, height: 40 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 10, height: 10, background: '#ff5f57', borderRadius: '50%' }} />
          <div style={{ width: 10, height: 10, background: '#febc2e', borderRadius: '50%' }} />
          <div style={{ width: 10, height: 10, background: '#28c840', borderRadius: '50%' }} />
        </div>
        <span className="label-green" style={{ marginLeft: 8, fontSize: 12 }}>SUBWAY-INTEL</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className={`dot ${liveData.connected ? 'dot-green' : 'dot-dim'}`} />
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>LIVE</span>
        </div>
      </div>

      {/* Body below top bar */}
      <div style={{ display: 'flex', flex: 1, marginTop: 40, overflow: 'hidden' }}>
        <Sidebar active={activeView} onNav={setActiveView} liveData={liveData} />
        <main style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {activeView === 'stations' && <MyStations liveData={liveData} stationsCtx={stationsCtx} />}
          {activeView === 'commute'  && <SmartCommute liveData={liveData} stationsCtx={stationsCtx} />}
          {activeView === 'pulse'    && <NetworkPulse liveData={liveData} />}
          {activeView === 'intel'    && <DelayIntel liveData={liveData} />}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create stub views so App compiles**

```bash
mkdir -p /Users/jamest/subway-intel/frontend/src/views
```

```tsx
// frontend/src/views/MyStations.tsx (stub)
export function MyStations(_props: any) { return <div className="label">MY STATIONS — coming in Task 12</div> }
// frontend/src/views/SmartCommute.tsx (stub)
export function SmartCommute(_props: any) { return <div className="label">SMART COMMUTE — coming in Task 13</div> }
// frontend/src/views/NetworkPulse.tsx (stub)
export function NetworkPulse(_props: any) { return <div className="label">NETWORK PULSE — coming in Task 14</div> }
// frontend/src/views/DelayIntel.tsx (stub)
export function DelayIntel(_props: any) { return <div className="label">DELAY INTEL — coming in Task 15</div> }
```

- [ ] **Step 7: Verify frontend compiles**

```bash
cd /Users/jamest/subway-intel/frontend
npm run build
```
Expected: build succeeds, `dist/` created.

- [ ] **Step 8: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/
git commit -m "feat: app shell, sidebar nav, LineBadge, DelayBadge, SignalStrip, stub views"
```

---

## Task 12: My Stations View

**Files:**
- Create: `frontend/src/components/ArrivalCard.tsx`
- Modify: `frontend/src/views/MyStations.tsx`

- [ ] **Step 1: Write frontend/src/components/ArrivalCard.tsx**

```tsx
import type { ArrivalEntry } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'
import { LineBadge } from './LineBadge'
import { DelayBadge } from './DelayBadge'
import { directionLabel } from '../constants/stops'

interface Props {
  station: SavedStation
  arrivals: ArrivalEntry[]
  onRemove: () => void
}

function minutesUntil(isoTime: string): number {
  return Math.max(0, Math.round((new Date(isoTime).getTime() - Date.now()) / 60000))
}

export function ArrivalCard({ station, arrivals, onRemove }: Props) {
  const firstDelay = arrivals[0]?.delay_sec ?? 0
  const hasDelay = firstDelay > 30
  const isDisrupted = firstDelay > 300

  return (
    <div className={`card ${hasDelay ? (isDisrupted ? 'card-disrupted' : 'card-delayed') : ''}`}
         style={{ marginBottom: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {station.route_ids.map(r => <LineBadge key={r} routeId={r} />)}
        </div>
        <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {station.name.toUpperCase()}
        </span>
        {hasDelay && <DelayBadge delaySec={firstDelay} />}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
          {directionLabel(station.direction, station.route_ids[0]?.toUpperCase() ?? '')}
        </span>
        <button onClick={onRemove} style={{
          all: 'unset', cursor: 'pointer', color: 'var(--text-faint)',
          fontSize: 10, marginLeft: 8,
        }}>✕</button>
      </div>

      {/* Countdown tiles */}
      <div style={{ display: 'flex', gap: 8 }}>
        {arrivals.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>NO SERVICE DATA</div>
        ) : (
          arrivals.slice(0, 3).map((a, i) => {
            const mins = minutesUntil(a.arrival_time)
            const isNext = i === 0
            return (
              <div key={a.arrival_time} style={{
                background: isNext ? (hasDelay ? 'var(--amber-dim)' : 'var(--green-dim)') : 'var(--bg)',
                border: `1px solid ${isNext ? (hasDelay ? 'var(--amber-border)' : 'var(--green-border)') : 'var(--border)'}`,
                borderRadius: 3,
                padding: '8px 14px',
                textAlign: 'center',
                minWidth: 52,
              }}>
                <div className="mono-lg" style={{
                  color: isNext ? (hasDelay ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)',
                }}>
                  {mins}
                </div>
                <div className="mono-sm">MIN</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write frontend/src/views/MyStations.tsx**

```tsx
import { useState } from 'react'
import { ArrivalCard } from '../components/ArrivalCard'
import { SignalStrip } from '../components/SignalStrip'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[]; addStation: (s: SavedStation) => void; removeStation: (id: string, dir: string) => void }
}

export function MyStations({ liveData, stationsCtx }: Props) {
  const { stations, addStation, removeStation } = stationsCtx
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<{ stop_id: string; name: string }[]>([])
  const [showSearch, setShowSearch] = useState(false)

  async function handleSearch(q: string) {
    setSearchQ(q)
    if (q.length < 2) { setSearchResults([]); return }
    const res = await fetch(`/api/stops/search?q=${encodeURIComponent(q)}&limit=8`)
    const data = await res.json()
    setSearchResults(data.results ?? [])
  }

  function addStop(stop: { stop_id: string; name: string }) {
    // Default: add both N and S directions
    addStation({ stop_id: stop.stop_id + 'N', name: stop.name, direction: 'N', route_ids: [] })
    setShowSearch(false)
    setSearchQ('')
    setSearchResults([])
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>MY STATIONS</span>
        {liveData.lastUpdate && (
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>
            last update {Math.round((Date.now() - liveData.lastUpdate.getTime()) / 1000)}s ago
          </span>
        )}
        {stations.length < 5 && (
          <button onClick={() => setShowSearch(v => !v)} style={{
            all: 'unset', cursor: 'pointer', marginLeft: 'auto',
            color: 'var(--green)', fontSize: 10, letterSpacing: '0.05em',
          }}>
            + ADD STATION
          </button>
        )}
      </div>

      {/* Search */}
      {showSearch && (
        <div style={{ marginBottom: 16 }}>
          <input
            autoFocus
            value={searchQ}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search stations..."
            style={{
              all: 'unset',
              display: 'block',
              width: '100%',
              background: 'var(--bg-surface)',
              border: '1px solid var(--green-border)',
              borderRadius: 3,
              padding: '8px 12px',
              color: 'var(--text-primary)',
              fontSize: 12,
              marginBottom: 4,
            }}
          />
          {searchResults.map(r => (
            <button key={r.stop_id} onClick={() => addStop(r)} style={{
              all: 'unset', display: 'block', width: '100%',
              padding: '8px 12px', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 11,
              background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
            }}>
              {r.name} <span style={{ color: 'var(--text-faint)' }}>{r.stop_id}</span>
            </button>
          ))}
        </div>
      )}

      {/* Station cards */}
      {stations.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 40, textAlign: 'center' }}>
          No stations saved. Click + ADD STATION to get started.
        </div>
      ) : (
        stations.map(s => (
          <ArrivalCard
            key={`${s.stop_id}-${s.direction}`}
            station={s}
            arrivals={liveData.arrivals[s.stop_id] ?? []}
            onRemove={() => removeStation(s.stop_id, s.direction)}
          />
        ))
      )}

      {/* Signal strip */}
      {liveData.lineHealth.length > 0 && (
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div className="label" style={{ marginBottom: 8 }}>DELAY INTEL · LIVE SIGNALS</div>
          <SignalStrip health={liveData.lineHealth} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/components/ArrivalCard.tsx frontend/src/views/MyStations.tsx
git commit -m "feat: My Stations view — ArrivalCard with countdown tiles, delay badges, station search"
```

---

## Task 13: Smart Commute View

**Files:**
- Modify: `frontend/src/views/SmartCommute.tsx`

- [ ] **Step 1: Write frontend/src/views/SmartCommute.tsx**

```tsx
import { useState } from 'react'
import type { LiveData } from '../hooks/useLiveData'
import type { SavedStation } from '../hooks/useStations'

interface Props {
  liveData: LiveData
  stationsCtx: { stations: SavedStation[] }
}

interface CommuteResult {
  leave_in_sec: number
  board_at: string
  arrive_at: string
  route_id: string
  trip_id: string
  delay_sec: number
}

function fmt(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function SmartCommute({ liveData, stationsCtx }: Props) {
  const [origin, setOrigin] = useState('')
  const [dest, setDest] = useState('')
  const [result, setResult] = useState<CommuteResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [originResults, setOriginResults] = useState<{ stop_id: string; name: string }[]>([])
  const [destResults, setDestResults] = useState<{ stop_id: string; name: string }[]>([])
  const [originName, setOriginName] = useState('')
  const [destName, setDestName] = useState('')

  async function searchStops(q: string, setter: typeof setOriginResults) {
    if (q.length < 2) { setter([]); return }
    const res = await fetch(`/api/stops/search?q=${encodeURIComponent(q)}&limit=6`)
    const data = await res.json()
    setter(data.results ?? [])
  }

  async function calculate() {
    if (!origin || !dest) { setError('Select both origin and destination.'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch(`/api/commute?origin=${origin}&destination=${dest}`)
      if (!res.ok) { setError('No route found between these stops.'); return }
      setResult(await res.json())
    } catch { setError('Network error — is the backend running?') }
    finally { setLoading(false) }
  }

  const leaveInMin = result ? Math.round(result.leave_in_sec / 60) : null

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>SMART COMMUTE</span>
      </div>

      {/* Origin */}
      <div style={{ marginBottom: 12 }}>
        <div className="label" style={{ marginBottom: 6 }}>FROM</div>
        <input value={originName} onChange={e => { setOriginName(e.target.value); searchStops(e.target.value, setOriginResults) }}
          placeholder="Search origin station..."
          style={{ all: 'unset', display: 'block', width: '100%', background: 'var(--bg-surface)',
            border: '1px solid var(--border)', borderRadius: 3, padding: '8px 12px',
            color: 'var(--text-primary)', fontSize: 12 }} />
        {originResults.map(r => (
          <button key={r.stop_id} onClick={() => { setOrigin(r.stop_id + 'N'); setOriginName(r.name); setOriginResults([]) }}
            style={{ all: 'unset', display: 'block', width: '100%', padding: '8px 12px', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 11, background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)' }}>
            {r.name}
          </button>
        ))}
      </div>

      {/* Destination */}
      <div style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>TO</div>
        <input value={destName} onChange={e => { setDestName(e.target.value); searchStops(e.target.value, setDestResults) }}
          placeholder="Search destination station..."
          style={{ all: 'unset', display: 'block', width: '100%', background: 'var(--bg-surface)',
            border: '1px solid var(--border)', borderRadius: 3, padding: '8px 12px',
            color: 'var(--text-primary)', fontSize: 12 }} />
        {destResults.map(r => (
          <button key={r.stop_id} onClick={() => { setDest(r.stop_id + 'N'); setDestName(r.name); setDestResults([]) }}
            style={{ all: 'unset', display: 'block', width: '100%', padding: '8px 12px', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 11, background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)' }}>
            {r.name}
          </button>
        ))}
      </div>

      <button onClick={calculate} disabled={loading} style={{
        all: 'unset', cursor: loading ? 'default' : 'pointer',
        background: 'var(--green-dim)', border: '1px solid var(--green-border)',
        borderRadius: 3, padding: '10px 20px', color: 'var(--green)',
        fontSize: 11, letterSpacing: '0.05em',
      }}>
        {loading ? 'CALCULATING...' : 'CALCULATE'}
      </button>

      {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 12 }}>{error}</div>}

      {result && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="label" style={{ marginBottom: 16 }}>RECOMMENDATION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
            <span className="mono-lg" style={{ fontSize: 48, color: 'var(--green)' }}>{leaveInMin}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>minutes to leave</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.8 }}>
            Take the <span style={{ color: 'var(--text-primary)' }}>{result.route_id}</span> at{' '}
            <span style={{ color: 'var(--text-primary)' }}>{fmt(result.board_at)}</span>
            {result.delay_sec > 30 && (
              <span style={{ color: 'var(--amber)' }}> (+{Math.round(result.delay_sec / 60)}m delay)</span>
            )}
            <br />
            Arrives at <span style={{ color: 'var(--text-primary)' }}>{fmt(result.arrive_at)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build + verify**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/views/SmartCommute.tsx
git commit -m "feat: Smart Commute view — origin/dest search, departure recommendation"
```

---

## Task 14: Network Pulse View

**Files:**
- Modify: `frontend/src/views/NetworkPulse.tsx`

- [ ] **Step 1: Write frontend/src/views/NetworkPulse.tsx**

```tsx
import { useState } from 'react'
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { LineBadge } from '../components/LineBadge'

interface Props { liveData: LiveData }

const STATUS_COLORS = {
  NOMINAL:   { text: 'var(--green)', bg: 'var(--green-dim)' },
  DELAYED:   { text: 'var(--amber)', bg: 'var(--amber-dim)' },
  DISRUPTED: { text: 'var(--red)',   bg: 'var(--red-dim)'   },
}

// Group lines into MTA divisions
const LINE_GROUPS: { label: string; routes: string[] }[] = [
  { label: 'IRT LEXINGTON',  routes: ['4', '5', '6'] },
  { label: 'IRT BROADWAY',   routes: ['1', '2', '3'] },
  { label: 'IND EIGHTH AV',  routes: ['A', 'C', 'E'] },
  { label: 'IND SIXTH AV',   routes: ['B', 'D', 'F', 'M'] },
  { label: 'IND CROSSTOWN',  routes: ['G'] },
  { label: 'BMT NASSAU',     routes: ['J', 'Z'] },
  { label: 'IND FLUSHING',   routes: ['7'] },
  { label: 'BMT CANARSIE',   routes: ['L'] },
  { label: 'BMT BROADWAY',   routes: ['N', 'Q', 'R', 'W'] },
  { label: 'SIR',            routes: ['SIR'] },
]

function healthForRoutes(routes: string[], health: LineHealthEntry[]): LineHealthEntry | null {
  const entries = health.filter(h => routes.includes(h.route_id))
  if (entries.length === 0) return null
  const worst = entries.sort((a, b) => {
    const order = { DISRUPTED: 2, DELAYED: 1, NOMINAL: 0 }
    return order[b.status] - order[a.status]
  })[0]
  const avgDelay = entries.reduce((s, e) => s + e.avg_delay_sec, 0) / entries.length
  return { ...worst, avg_delay_sec: avgDelay }
}

export function NetworkPulse({ liveData }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const toggle = (label: string) => setExpanded(v => v === label ? null : label)

  const summary = {
    nominal:   liveData.lineHealth.filter(h => h.status === 'NOMINAL').length,
    delayed:   liveData.lineHealth.filter(h => h.status === 'DELAYED').length,
    disrupted: liveData.lineHealth.filter(h => h.status === 'DISRUPTED').length,
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>NETWORK PULSE</span>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'NOMINAL', count: summary.nominal, color: 'var(--green)' },
          { label: 'DELAYED', count: summary.delayed, color: 'var(--amber)' },
          { label: 'DISRUPTED', count: summary.disrupted, color: 'var(--red)' },
        ].map(({ label, count, color }) => (
          <div key={label} className="card" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{count}</div>
            <div className="label" style={{ marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Line groups */}
      {LINE_GROUPS.map(({ label, routes }) => {
        const h = healthForRoutes(routes, liveData.lineHealth)
        const status = h?.status ?? 'NOMINAL'
        const colors = STATUS_COLORS[status]
        const isExpanded = expanded === label

        return (
          <div key={label} style={{ marginBottom: 4 }}>
            <button onClick={() => toggle(label)} style={{
              all: 'unset', cursor: 'pointer', display: 'flex', width: '100%',
              alignItems: 'center', gap: 10,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 3, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {routes.map(r => <LineBadge key={r} routeId={r} size={18} />)}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.06em' }}>{label}</span>
              <div style={{
                marginLeft: 'auto', background: colors.bg, borderRadius: 2,
                padding: '2px 8px', fontSize: 10, color: colors.text,
              }}>
                {status}
              </div>
              {h && h.avg_delay_sec > 30 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                  {Math.round(h.avg_delay_sec / 60)}m avg lag
                </span>
              )}
              <span style={{ color: 'var(--text-faint)', fontSize: 10, marginLeft: 8 }}>
                {isExpanded ? '▲' : '▼'}
              </span>
            </button>

            {isExpanded && h && (
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderTop: 'none',
                borderRadius: '0 0 3px 3px', padding: 14,
              }}>
                {h.alerts.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No active alerts.</div>
                ) : (
                  h.alerts.map((a, i) => (
                    <div key={i} style={{ color: 'var(--amber)', fontSize: 11, marginBottom: 4 }}>⚠ {a}</div>
                  ))
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 8 }}>
                  Avg delay: {Math.round(h.avg_delay_sec)}s ·
                  Headway variance: {Math.round(h.headway_variance)}s
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Build + verify**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/views/NetworkPulse.tsx
git commit -m "feat: Network Pulse view — line groups, status summary, expandable alerts"
```

---

## Task 15: Delay Intel View

**Files:**
- Modify: `frontend/src/views/DelayIntel.tsx`

- [ ] **Step 1: Write frontend/src/views/DelayIntel.tsx**

```tsx
import type { LiveData, LineHealthEntry } from '../hooks/useLiveData'
import { LineBadge } from '../components/LineBadge'

interface Props { liveData: LiveData }

const STATUS_ORDER = { DISRUPTED: 0, DELAYED: 1, NOMINAL: 2 }
const STATUS_COLORS = {
  NOMINAL:   'var(--green)',
  DELAYED:   'var(--amber)',
  DISRUPTED: 'var(--red)',
}

function TrendArrow({ h }: { h: LineHealthEntry }) {
  // Simple: if avg delay > 60s show ↑, else ↓ or —
  if (h.avg_delay_sec > 120) return <span style={{ color: 'var(--red)' }}>↑</span>
  if (h.avg_delay_sec > 30)  return <span style={{ color: 'var(--amber)' }}>→</span>
  return <span style={{ color: 'var(--green)' }}>↓</span>
}

function GapFlag({ h }: { h: LineHealthEntry }) {
  // Flag bunching/gapping if headway variance > 120s^2
  if (h.headway_variance > 120) {
    return <span style={{ color: 'var(--amber)', fontSize: 9, marginLeft: 6 }}>GAP DETECTED</span>
  }
  return null
}

export function DelayIntel({ liveData }: Props) {
  const sorted = [...liveData.lineHealth].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  )

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <span className="label" style={{ fontSize: 14, color: 'var(--text-primary)' }}>DELAY INTEL</span>
      </div>
      <div style={{ color: 'var(--text-faint)', fontSize: 10, marginBottom: 20 }}>
        Heuristic signals derived from live GTFS-RT feed · 15-min rolling window
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
        gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--border)',
      }}>
        {['LINE', 'STATUS', 'AVG DELAY', 'HW VARIANCE', 'TREND', 'ALERTS'].map(h => (
          <div key={h} className="label">{h}</div>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '20px 14px' }}>
          Waiting for feed data...
        </div>
      ) : (
        sorted.map(h => (
          <div key={h.route_id} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 80px 60px',
            gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-dim)',
            alignItems: 'center',
          }}>
            <div><LineBadge routeId={h.route_id} size={20} /></div>
            <div>
              <span style={{ color: STATUS_COLORS[h.status], fontSize: 11 }}>{h.status}</span>
              <GapFlag h={h} />
            </div>
            <div style={{ color: 'var(--text-primary)', fontSize: 11 }}>
              {Math.round(h.avg_delay_sec)}s
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              ±{Math.round(Math.sqrt(h.headway_variance))}s
            </div>
            <div style={{ fontSize: 14 }}><TrendArrow h={h} /></div>
            <div style={{ color: h.alerts.length > 0 ? 'var(--amber)' : 'var(--text-faint)', fontSize: 11 }}>
              {h.alerts.length > 0 ? h.alerts.length : '—'}
            </div>
          </div>
        ))
      )}

      <div style={{ marginTop: 24, padding: 14, background: 'var(--bg-surface)', borderRadius: 3, border: '1px solid var(--border)' }}>
        <div className="label" style={{ marginBottom: 8 }}>SIGNAL DEFINITIONS</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 10, lineHeight: 1.8 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Avg Delay</strong> — rolling 15-min mean of delay_sec across all trips on this route.<br />
          <strong style={{ color: 'var(--text-primary)' }}>HW Variance</strong> — standard deviation of headways (seconds between consecutive trains). High variance = bunching or gapping.<br />
          <strong style={{ color: 'var(--text-primary)' }}>Trend</strong> — ↑ worsening, → stable, ↓ improving (last 30 min window).<br />
          <strong style={{ color: 'var(--text-primary)' }}>GAP DETECTED</strong> — headway variance &gt; 120s, indicating trains are not evenly spaced.
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build + verify**

```bash
cd /Users/jamest/subway-intel/frontend && npm run build
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jamest/subway-intel
git add frontend/src/views/DelayIntel.tsx
git commit -m "feat: Delay Intel view — per-line signals table, gap detection, signal definitions"
```

---

## Task 16: CDK Infrastructure

**Files:**
- Create: `cdk/bin/subway-intel.ts`
- Create: `cdk/lib/fargate-stack.ts`
- Create: `cdk/lib/database-stack.ts`
- Create: `cdk/lib/frontend-stack.ts`
- Create: `cdk/package.json`, `cdk/tsconfig.json`, `cdk/cdk.json`

- [ ] **Step 1: Scaffold CDK project**

```bash
cd /Users/jamest/subway-intel/cdk
npm init -y
npm install -D aws-cdk-lib constructs typescript ts-node @types/node
npx tsc --init --target ES2020 --module commonjs --strict --outDir dist
```

- [ ] **Step 2: Write cdk/cdk.json**

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/subway-intel.ts",
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true
  }
}
```

- [ ] **Step 3: Write cdk/bin/subway-intel.ts**

```typescript
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { DatabaseStack } from '../lib/database-stack'
import { FargateStack } from '../lib/fargate-stack'
import { FrontendStack } from '../lib/frontend-stack'

const app = new cdk.App()
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }

const db = new DatabaseStack(app, 'SubwayIntelDB', { env })
const fargate = new FargateStack(app, 'SubwayIntelFargate', { env, dbInstance: db.instance })
new FrontendStack(app, 'SubwayIntelFrontend', { env })
```

- [ ] **Step 4: Write cdk/lib/database-stack.ts**

```typescript
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import { Construct } from 'constructs'

export class DatabaseStack extends cdk.Stack {
  public readonly instance: rds.DatabaseInstance

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 1 })

    // RDS Postgres (TimescaleDB installed via init script post-deploy)
    this.instance = new rds.DatabaseInstance(this, 'SubwayDB', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      databaseName: 'subway_intel',
      credentials: rds.Credentials.fromGeneratedSecret('subway'),
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,  // personal project
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    })

    new cdk.CfnOutput(this, 'DbEndpoint', { value: this.instance.instanceEndpoint.hostname })
  }
}
```

- [ ] **Step 5: Write cdk/lib/fargate-stack.ts**

```typescript
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'

interface Props extends cdk.StackProps {
  dbInstance: rds.DatabaseInstance
}

export class FargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const mtaSecret = new secretsmanager.Secret(this, 'MtaApiKey', {
      secretName: 'subway-intel/mta-api-key',
      description: 'MTA GTFS-RT API key',
    })

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: false })

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc })

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('..', {
          file: 'backend/Dockerfile',
        }),
        containerPort: 8000,
        environment: { GTFS_POLL_INTERVAL_SEC: '30' },
        secrets: {
          MTA_API_KEY: ecs.Secret.fromSecretsManager(mtaSecret),
          DATABASE_URL: ecs.Secret.fromSecretsManager(
            props.dbInstance.secret!, 'DATABASE_URL'
          ),
        },
      },
      publicLoadBalancer: true,
    })

    // Allow Fargate to reach RDS
    props.dbInstance.connections.allowFrom(service.service, ec2.Port.tcp(5432))

    new cdk.CfnOutput(this, 'ServiceUrl', { value: service.loadBalancer.loadBalancerDnsName })
  }
}
```

- [ ] **Step 6: Write cdk/lib/frontend-stack.ts**

```typescript
import * as cdk from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { Construct } from 'constructs'

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [{ httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' }],
    })

    new s3deploy.BucketDeployment(this, 'Deploy', {
      sources: [s3deploy.Source.asset('../frontend/dist')],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    })

    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` })
  }
}
```

- [ ] **Step 7: Verify CDK synths**

```bash
cd /Users/jamest/subway-intel/cdk
npm install
npx cdk synth
```
Expected: CloudFormation templates printed for all 3 stacks, no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/jamest/subway-intel
git add cdk/
git commit -m "feat: CDK stacks — Fargate, RDS/TimescaleDB, S3+CloudFront frontend"
```

---

## Task 17: End-to-End Smoke Test + Deploy

- [ ] **Step 1: Run full backend test suite**

```bash
cd /Users/jamest/subway-intel/backend
python -m pytest tests/ -v
```
Expected: All tests pass (test_models, test_feed, test_state, test_heuristics, test_api).

- [ ] **Step 2: Build frontend**

```bash
cd /Users/jamest/subway-intel/frontend
npm run build
```
Expected: `dist/` created, 0 errors.

- [ ] **Step 3: Run backend locally against real MTA feed**

```bash
cd /Users/jamest/subway-intel
export MTA_API_KEY=<your_key>
export DATABASE_URL=""
uvicorn backend.main:app --port 8000
```
Expected: logs show "Poll complete: N records" every 30s.

- [ ] **Step 4: Open frontend dev server**

```bash
cd /Users/jamest/subway-intel/frontend
npm run dev
```
Open http://localhost:5173 — verify WebSocket connects, arrivals update live, all four views render.

- [ ] **Step 5: Set MTA API key in Secrets Manager**

```bash
aws secretsmanager put-secret-value \
  --secret-id subway-intel/mta-api-key \
  --secret-string '{"MTA_API_KEY":"<your_key>"}'
```

- [ ] **Step 6: Deploy**

```bash
cd /Users/jamest/subway-intel/cdk
npx cdk deploy --all
```
Expected: 3 stacks deployed. Note the CloudFront URL from output.

- [ ] **Step 7: Apply TimescaleDB schema**

```bash
# SSH to RDS or use psql via bastion
psql $DATABASE_URL -f ../backend/db/schema.sql
```

- [ ] **Step 8: Final commit**

```bash
cd /Users/jamest/subway-intel
git add -A
git commit -m "chore: Phase 1 complete — GTFS-RT ingestion, 4 views, CDK deployed"
git push
```
