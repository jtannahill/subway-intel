from __future__ import annotations
import asyncio
import hashlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router, set_state
from backend import config
from backend.db.client import close_pool, init_pool
from backend.gtfs.feed import (
    MTA_ALERTS_JSON_URL,
    MTA_FEED_URLS,
    fetch_feed,
    parse_alerts,
    parse_alerts_json,
    parse_feed,
    parse_vehicle_positions,
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

    ALL_FEED_IDS = list(MTA_FEED_URLS.keys()) + ['alerts-json']

    # Per-feed state persisted across poll cycles
    _etags:   dict[str, str | None] = {k: None for k in ALL_FEED_IDS}
    _hashes:  dict[str, bytes]      = {k: b''  for k in ALL_FEED_IDS}
    # Cached parsed results per feed — reused when content hash is unchanged
    _parsed:  dict[str, tuple[list, list, list]] = {k: ([], [], []) for k in ALL_FEED_IDS}

    async with httpx.AsyncClient() as client:
        while True:
            try:
                all_records: list = []
                all_alerts:  list = []
                all_vehicles: list = []
                skipped = 0

                for feed_id, url in MTA_FEED_URLS.items():
                    data, etag = await fetch_feed(url, client, etag=_etags[feed_id])

                    if data is None:
                        # Server sent 304 — content identical, reuse parsed results
                        skipped += 1
                    else:
                        content_hash = hashlib.md5(data, usedforsecurity=False).digest()
                        if content_hash == _hashes[feed_id]:
                            # Bytes identical to last cycle — skip expensive protobuf parse
                            skipped += 1
                        else:
                            _hashes[feed_id]  = content_hash
                            _etags[feed_id]   = etag
                            _parsed[feed_id]  = (
                                parse_feed(data),
                                parse_alerts(data),
                                parse_vehicle_positions(data),
                            )

                    records, alerts, vehicles = _parsed[feed_id]
                    all_records.extend(records)
                    all_alerts.extend(alerts)
                    all_vehicles.extend(vehicles)

                # Customer-facing alerts JSON feed
                alerts_data, alerts_etag = await fetch_feed(MTA_ALERTS_JSON_URL, client, etag=_etags['alerts-json'])
                if alerts_data is None:
                    skipped += 1
                else:
                    content_hash = hashlib.md5(alerts_data, usedforsecurity=False).digest()
                    if content_hash == _hashes['alerts-json']:
                        skipped += 1
                    else:
                        _hashes['alerts-json'] = content_hash
                        _etags['alerts-json']  = alerts_etag
                        _parsed['alerts-json'] = (parse_alerts_json(alerts_data), [], [])
                all_alerts.extend(_parsed['alerts-json'][0])

                _live_state.ingest(all_records, all_alerts, all_vehicles)
                snapshot = _live_state.snapshot()
                await manager.broadcast(snapshot)
                await write_arrivals(all_records)
                await write_alerts(all_alerts)
                logger.info(
                    'Poll complete: %d records, %d alerts, %d vehicles, %d ws clients (%d/%d feeds skipped)',
                    len(all_records), len(all_alerts), len(all_vehicles),
                    manager.connection_count, skipped, len(ALL_FEED_IDS),
                )
            except Exception as e:
                logger.error('Poll loop error: %s', e)
            await asyncio.sleep(POLL_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.load()
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
