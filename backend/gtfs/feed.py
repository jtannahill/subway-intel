from __future__ import annotations
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
from google.transit import gtfs_realtime_pb2

from backend.gtfs.models import ArrivalRecord, ServiceAlert, VehiclePosition
from backend.gtfs.static import get_scheduled_arrival_sec

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore

_NYC_TZ = ZoneInfo('America/New_York')

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
        start_date = tu.trip.start_date  # e.g. '20260413'

        for stu in tu.stop_time_update:
            if not stu.HasField('arrival'):
                continue
            stop_id = stu.stop_id
            direction = stop_id[-1] if stop_id and stop_id[-1] in ('N', 'S') else 'N'
            arrival_time = datetime.fromtimestamp(stu.arrival.time, tz=timezone.utc)

            # MTA rarely populates arrival.delay; compute it from scheduled time instead.
            delay_sec = 0
            sched_sec = get_scheduled_arrival_sec(trip_id, stop_id)
            if sched_sec is not None and start_date and len(start_date) == 8:
                try:
                    svc_day = datetime.strptime(start_date, '%Y%m%d').replace(tzinfo=_NYC_TZ)
                    # Service midnight in UTC (handles DST automatically)
                    svc_midnight_utc = svc_day.astimezone(timezone.utc).replace(
                        hour=0, minute=0, second=0, microsecond=0
                    )
                    scheduled_utc = svc_midnight_utc + timedelta(seconds=sched_sec)
                    computed = int((arrival_time - scheduled_utc).total_seconds())
                    # Clamp: ignore implausible values (> 2h late or > 30min early)
                    if -1800 <= computed <= 7200:
                        delay_sec = max(0, computed)
                except Exception:
                    pass

            records.append(ArrivalRecord(
                route_id=route_id,
                trip_id=trip_id,
                stop_id=stop_id,
                arrival_time=arrival_time,
                delay_sec=delay_sec,
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

        # MTA uses Mercury extension for alert type — standard 'effect' field is absent.
        mercury = alert_obj.get('transit_realtime.mercury_alert', {})
        alert_type = mercury.get('alert_type', '')

        # Also check standard effect field as a fallback
        raw_effect = alert_obj.get('effect', None)
        if raw_effect is not None:
            if isinstance(raw_effect, int):
                std_effect = _EFFECT_NAMES.get(raw_effect, 'UNKNOWN_EFFECT')
            else:
                std_effect = str(raw_effect)
        else:
            std_effect = 'UNKNOWN_EFFECT'

        # Mercury alert_type → normalized effect + severity
        # Covers all currently observed types from the MTA feed.
        _MERCURY_MAP: dict[str, tuple[str, str]] = {
            # Live disruptions
            'Delays':                    ('SIGNIFICANT_DELAYS', 'MEDIUM'),
            'Reduced Service':           ('REDUCED_SERVICE',    'HIGH'),
            'No Service':                ('NO_SERVICE',         'HIGH'),
            'Suspended Service':         ('NO_SERVICE',         'HIGH'),
            'No Scheduled Service':      ('NO_SERVICE',         'HIGH'),
            # Planned service changes (significant — trains not serving all stops/routes)
            'Planned - Suspended':       ('NO_SERVICE',         'HIGH'),
            'Planned - Part Suspended':  ('REDUCED_SERVICE',    'HIGH'),
            'Planned - Stops Skipped':   ('MODIFIED_SERVICE',   'MEDIUM'),
            'Stops Skipped':             ('MODIFIED_SERVICE',   'MEDIUM'),
            'Planned - Reroute':         ('MODIFIED_SERVICE',   'MEDIUM'),
            'Planned - Express to Local':('MODIFIED_SERVICE',   'MEDIUM'),
            'Express to Local':          ('MODIFIED_SERVICE',   'MEDIUM'),
            'Special Schedule':          ('MODIFIED_SERVICE',   'LOW'),
            # Informational only — no status change
            'Boarding Change':           ('OTHER_EFFECT',       'LOW'),
            'Extra Service':             ('OTHER_EFFECT',       'LOW'),
            'Station Notice':            ('OTHER_EFFECT',       'LOW'),
        }
        effect, severity = _MERCURY_MAP.get(
            alert_type,
            (std_effect, 'HIGH' if std_effect in ('NO_SERVICE', 'REDUCED_SERVICE') else 'LOW'),
        )

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


async def fetch_feed(
    url: str,
    client: httpx.AsyncClient,
    etag: str | None = None,
) -> tuple[bytes | None, str | None]:
    """Fetch a single GTFS-RT feed URL with ETag caching.

    Returns:
        (content, etag)  — new data received; etag may be None if server doesn't send one
        (None,   etag)   — 304 Not Modified; caller should reuse cached data
        (b'',    None)   — fetch or parse error
    """
    headers = {}
    if etag:
        headers['If-None-Match'] = etag

    try:
        resp = await client.get(url, headers=headers, timeout=10.0)
        if resp.status_code == 304:
            return None, etag
        resp.raise_for_status()
        new_etag = resp.headers.get('etag') or resp.headers.get('ETag')
        return resp.content, new_etag
    except Exception as e:
        logger.warning('Feed fetch failed for %s: %s', url, e)
        return b'', None
