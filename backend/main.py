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
from backend.gtfs.feed import (
    MTA_ALERTS_JSON_URL,
    MTA_FEED_URLS,
    fetch_feed,
    parse_alerts,
    parse_alerts_json,
    parse_feed,
)
from backend.gtfs.state import LiveState
from backend.gtfs import static as gtfs_static
from backend.api.websocket import manager

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
logger = logging.getLogger(__name__)

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
                    data = await fetch_feed(url, client)
                    all_records.extend(parse_feed(data))
                    all_alerts.extend(parse_alerts(data))

                # Customer-facing alerts (JSON format — separate from GTFS-RT protobuf)
                alerts_json_data = await fetch_feed(MTA_ALERTS_JSON_URL, client)
                all_alerts.extend(parse_alerts_json(alerts_json_data))

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
