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
