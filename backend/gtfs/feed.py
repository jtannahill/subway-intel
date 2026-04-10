from __future__ import annotations
import json
import logging
from datetime import datetime, timezone

import httpx
from google.transit import gtfs_realtime_pb2

from backend.gtfs.models import ArrivalRecord, ServiceAlert, VehiclePosition

logger = logging.getLogger(__name__)

MTA_ALERTS_JSON_URL = (
    'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json'
)

# GTFS-RT Effect integer → name mapping (subset used for severity classification)
_EFFECT_NAMES: dict[int, str] = {
    1: 'NO_SERVICE',
    2: 'REDUCED_SERVICE',
    3: 'SIGNIFICANT_DELAYS',
    4: 'DETOUR',
    5: 'ADDITIONAL_SERVICE',
    6: 'MODIFIED_SERVICE',
    7: 'OTHER_EFFECT',
    8: 'UNKNOWN_EFFECT',
    9: 'STOP_MOVED',
}

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


def parse_alerts_json(data: bytes) -> list[ServiceAlert]:
    """Parse the MTA camsys subway-alerts JSON feed.

    The feed mirrors the GTFS-RT Alert structure serialised as JSON:
      { "entity": [ { "id": "...", "alert": { "informed_entity": [...],
                       "header_text": {"translation": [{"text": "..."}]},
                       "effect": <int or str> } } ] }
    """
    if not data:
        return []
    try:
        payload = json.loads(data)
    except Exception as e:
        logger.warning('Failed to parse MTA alerts JSON: %s', e)
        return []

    alerts: list[ServiceAlert] = []
    for entity in payload.get('entity', []):
        alert_obj = entity.get('alert', {})
        if not alert_obj:
            continue

        # Informed entities → route IDs
        routes = [
            ie['route_id']
            for ie in alert_obj.get('informed_entity', [])
            if ie.get('route_id')
        ]

        # Header text (English preferred)
        header = ''
        for t in alert_obj.get('header_text', {}).get('translation', []):
            if t.get('language', 'en') == 'en' or not header:
                header = t.get('text', '')
                if t.get('language', '') == 'en':
                    break

        # Effect — integer enum or string name
        raw_effect = alert_obj.get('effect', 8)  # 8 = UNKNOWN_EFFECT
        if isinstance(raw_effect, int):
            effect = _EFFECT_NAMES.get(raw_effect, 'UNKNOWN_EFFECT')
        else:
            effect = str(raw_effect)

        severity = 'HIGH' if effect in ('NO_SERVICE', 'REDUCED_SERVICE') else 'LOW'

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


def parse_vehicle_positions(data: bytes) -> list[VehiclePosition]:
    """Parse GTFS-RT VehiclePosition entities. Returns empty list on failure."""
    if not data:
        return []
    try:
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(data)
    except Exception as e:
        logger.warning('Failed to parse GTFS-RT vehicle positions: %s', e)
        return []

    positions: list[VehiclePosition] = []
    for entity in feed.entity:
        if not entity.HasField('vehicle'):
            continue
        v = entity.vehicle
        stop_id = v.stop_id
        route_id = v.trip.route_id
        if not stop_id or not route_id:
            continue
        status = gtfs_realtime_pb2.VehiclePosition.VehicleStopStatus.Name(v.current_status)
        ts = datetime.fromtimestamp(v.timestamp, tz=timezone.utc) if v.timestamp else datetime.now(timezone.utc)
        positions.append(VehiclePosition(
            trip_id=v.trip.trip_id,
            route_id=route_id,
            stop_id=stop_id,
            current_status=status,
            timestamp=ts,
        ))
    return positions


async def fetch_feed(url: str, client: httpx.AsyncClient) -> bytes:
    """Fetch a single GTFS-RT feed URL. Returns empty bytes on failure."""
    try:
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        logger.warning('Feed fetch failed for %s: %s', url, e)
        return b''
