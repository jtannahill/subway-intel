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
    arrivals = _state.get_arrivals(origin, limit=3)
    if not arrivals:
        raise HTTPException(404, f'No upcoming trains at {origin}')
    travel_sec = get_travel_sec(origin, destination)
    if travel_sec is None:
        raise HTTPException(404, f'No route found from {origin} to {destination}')
    return {'options': [compute_departure(next_arrival=a, travel_sec=travel_sec) for a in arrivals]}


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
