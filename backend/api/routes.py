from __future__ import annotations
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.api.websocket import manager
from backend.gtfs import state as live_state_module
from backend.gtfs.static import get_parent_stops_by_name, get_route_stops, get_stop_name, get_travel_sec, nearest_stops, search_stops
from backend.heuristics.commute import compute_departure
from backend.heuristics.delay import compute_delay_signals
from backend.heuristics.feedback import get_corrections, record_feedback

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

    if best_arrivals is None or best_travel_sec is None:
        raise HTTPException(404, f'No route found from {origin_name} to {dest_name}')

    return {'options': [compute_departure(next_arrival=a, travel_sec=best_travel_sec) for a in best_arrivals]}


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
