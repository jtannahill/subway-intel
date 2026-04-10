from __future__ import annotations
import logging
from datetime import datetime, timezone

import httpx
from google.transit import gtfs_realtime_pb2

from backend.gtfs.models import ArrivalRecord, ServiceAlert

logger = logging.getLogger(__name__)

MTA_FEED_URLS = {
    'gtfs':     'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
    'gtfs-ace': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
    'gtfs-bdfm':'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
    'gtfs-g':   'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
    'gtfs-jz':  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
    'gtfs-l':   'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
    'gtfs-nqrw':'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
    'gtfs-si':  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si',
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
    except Exception as e:
        logger.warning('Failed to parse GTFS-RT alerts: %s', e)
        return []

    alerts: list[ServiceAlert] = []
    for entity in feed.entity:
        if not entity.HasField('alert'):
            continue
        alert = entity.alert
        routes = [ie.route_id for ie in alert.informed_entity if ie.route_id]
        header = alert.header_text.translation[0].text if alert.header_text.translation else ''
        # Use Effect.Name() to get the human-readable string (e.g. 'NO_SERVICE', 'REDUCED_SERVICE')
        # rather than str(alert.effect) which yields the raw integer as a string (e.g. '6').
        effect = gtfs_realtime_pb2.Alert.Effect.Name(alert.effect)
        severity = 'HIGH' if 'SERVICE' in effect and 'NO' in effect else 'LOW'
        if not routes and header:
            routes = ['ALL']
        for route_id in routes:
            alerts.append(ServiceAlert(
                route_id=route_id,
                effect=effect,
                severity=severity,
                header=header,
            ))
    return alerts


async def fetch_feed(url: str, client: httpx.AsyncClient) -> bytes:
    """Fetch a single GTFS-RT feed URL. Returns empty bytes on failure."""
    try:
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        logger.warning('Feed fetch failed for %s: %s', url, e)
        return b''
