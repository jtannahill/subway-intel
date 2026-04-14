from __future__ import annotations
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.api.websocket import manager
from backend import config
from backend.gtfs import state as live_state_module
from backend.gtfs.static import find_transfer_route, get_all_parent_stops, get_parent_stops_by_name, get_route_stops, get_stop_name, get_tracks_geojson, get_travel_sec, nearest_stops, search_stops
from backend.heuristics.commute import compute_departure
from backend.heuristics.delay import compute_delay_signals
from backend.heuristics.feedback import get_corrections, record_feedback

router = APIRouter()
_state = None  # injected at startup via set_state()


def set_state(s) -> None:
    global _state
    _state = s


@router.get('/api/config')
async def get_config():
    return {'mapbox_token': config.mapbox_token}


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

    # Expand origin and destination to all parent stops sharing the same station name.
    # This handles multi-line stations (e.g. "Times Sq-42 St" has 4 distinct parent
    # stops for different train groups — 127=1/2/3, 725=7, 902=S, R16=N/Q/R/W).
    origin_base = origin.rstrip('NS')
    dest_base = destination.rstrip('NS')
    origin_name = get_stop_name(origin_base) or get_stop_name(origin)
    dest_name = get_stop_name(dest_base) or get_stop_name(destination)
    origin_parents = get_parent_stops_by_name(origin_name) or [origin_base]
    dest_parents = get_parent_stops_by_name(dest_name) or [dest_base]

    # Try all (origin_dir, dest_dir) combinations to find a working route.
    best_arrivals = None
    best_travel_sec = None
    for o_parent in origin_parents:
        for direction in ('N', 'S'):
            o_stop = o_parent + direction
            arrivals = _state.get_arrivals(o_stop, limit=3)
            if not arrivals:
                continue
            for d_parent in dest_parents:
                for d_dir in ('N', 'S'):
                    d_stop = d_parent + d_dir
                    travel_sec = get_travel_sec(o_stop, d_stop)
                    if travel_sec is not None:
                        if best_travel_sec is None or travel_sec < best_travel_sec:
                            best_arrivals = arrivals
                            best_travel_sec = travel_sec

    if best_arrivals is not None and best_travel_sec is not None:
        return {
            'options': [compute_departure(next_arrival=a, travel_sec=best_travel_sec) for a in best_arrivals],
            'transfer': None,
        }

    # No direct route — try 1-transfer routing
    all_origin_stops = [o_parent + d for o_parent in origin_parents for d in ('N', 'S')]
    all_dest_stops   = [d_parent + d for d_parent in dest_parents   for d in ('N', 'S')]
    transfer = find_transfer_route(all_origin_stops, all_dest_stops)

    if transfer is None:
        raise HTTPException(404, f'No route found from {origin_name} to {dest_name}')

    arrivals = _state.get_arrivals(transfer['origin_stop'], limit=3)
    if not arrivals:
        raise HTTPException(404, f'No live arrivals found at {origin_name}')

    return {
        'options': [compute_departure(next_arrival=a, travel_sec=transfer['total_sec']) for a in arrivals],
        'transfer': {
            'at': transfer['transfer_name'],
            'leg1_min': round(transfer['leg1_sec'] / 60),
            'leg2_min': round(transfer['leg2_sec'] / 60),
        },
    }


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


@router.get('/api/stops/nearest')
async def get_nearest_stops(lat: float, lon: float, limit: int = 1):
    return {'results': nearest_stops(lat, lon, limit)}


@router.get('/api/stops/all')
async def get_all_stops(response: Response):
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return {'stops': get_all_parent_stops()}


@router.get('/api/tracks')
async def get_tracks(response: Response):
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return get_tracks_geojson()


# Cached in-memory to avoid repeated ArcGIS fetches (dataset is stable)
_subway_lines_cache: dict | None = None

_ARCGIS_SUBWAY_URL = (
    'https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/'
    'Subway_view/FeatureServer/0/query'
)

@router.get('/api/subway-lines')
async def get_subway_lines(response: Response):
    """NYC DOT subway line physical track geometries from ArcGIS (NYC geo-metadata dataset)."""
    global _subway_lines_cache
    if _subway_lines_cache is not None:
        response.headers['Cache-Control'] = 'public, max-age=86400'
        return _subway_lines_cache
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(_ARCGIS_SUBWAY_URL, params={
                'where': '1=1',
                'outFields': 'LINE,DIVISION,RAIL_TYPE,ROW_TYPE',
                'f': 'geojson',
                'outSR': '4326',
                'resultRecordCount': '10000',
            })
            r.raise_for_status()
            data = r.json()
            _subway_lines_cache = data
            response.headers['Cache-Control'] = 'public, max-age=86400'
            return data
    except Exception as exc:
        raise HTTPException(502, f'Failed to fetch subway lines: {exc}')


@router.get('/api/routes/{route_id}/stops')
async def get_route_stops_endpoint(route_id: str, direction: int = 1):
    stops = get_route_stops(route_id, direction)
    if not stops:
        raise HTTPException(404, f'No stop sequence for route {route_id} direction {direction}')
    return {'route_id': route_id, 'direction': direction, 'stops': stops}


class ArrivalFeedbackBody(BaseModel):
    stop_id: str
    route_id: str
    scheduled_arrival: str
    train_present: bool


@router.post('/api/feedback/arrival')
async def post_arrival_feedback(body: ArrivalFeedbackBody):
    record_feedback(
        stop_id=body.stop_id,
        route_id=body.route_id,
        scheduled_arrival=body.scheduled_arrival,
        train_present=body.train_present,
    )
    return {'ok': True}


@router.get('/api/feedback/corrections')
async def get_arrival_corrections():
    return {'corrections': get_corrections()}


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
