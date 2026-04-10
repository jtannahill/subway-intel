import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.api.websocket import ConnectionManager
from backend.main import app


_client = TestClient(app)


def test_connection_manager_starts_empty():
    mgr = ConnectionManager()
    assert mgr.connection_count == 0


def test_connection_manager_broadcast_no_connections():
    """broadcast with no connections should not raise."""
    import asyncio
    mgr = ConnectionManager()
    asyncio.run(mgr.broadcast({'type': 'snapshot', 'arrivals': {}}))


MOCK_STOPS_FOR_NEAREST = {
    '127':  {'name': 'Times Sq-42 St',     'lat': 40.755983, 'lon': -73.986229, 'parent_station': ''},
    '631':  {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848, 'parent_station': ''},
}


def test_nearest_stops_endpoint_returns_closest():
    with patch('backend.gtfs.static._stops', MOCK_STOPS_FOR_NEAREST):
        resp = _client.get('/api/stops/nearest?lat=40.756&lon=-73.986&limit=1')
    assert resp.status_code == 200
    data = resp.json()
    assert len(data['results']) == 1
    assert data['results'][0]['stop_id'] == '127'
    assert data['results'][0]['distance_mi'] < 0.1


def test_nearest_stops_endpoint_default_limit_is_one():
    with patch('backend.gtfs.static._stops', MOCK_STOPS_FOR_NEAREST):
        resp = _client.get('/api/stops/nearest?lat=40.755&lon=-73.986')
    assert resp.status_code == 200
    assert len(resp.json()['results']) == 1


def test_nearest_stops_endpoint_limit_multiple():
    with patch('backend.gtfs.static._stops', MOCK_STOPS_FOR_NEAREST):
        resp = _client.get('/api/stops/nearest?lat=40.756&lon=-73.986&limit=2')
    assert resp.status_code == 200
    data = resp.json()
    assert len(data['results']) == 2
    # Times Sq is closer to query coords than Grand Central
    assert data['results'][0]['stop_id'] == '127'
    assert data['results'][1]['stop_id'] == '631'


def test_nearest_stops_endpoint_empty_stops_returns_empty():
    with patch('backend.gtfs.static._stops', {}):
        resp = _client.get('/api/stops/nearest?lat=40.756&lon=-73.986')
    assert resp.status_code == 200
    assert resp.json() == {'results': []}


def test_route_stops_endpoint_returns_stop_list():
    mock_route_stops = {
        ('6', 1): [
            {'stop_id': '640', 'name': 'Pelham Bay Park'},
            {'stop_id': '631', 'name': 'Grand Central-42 St'},
        ]
    }
    with patch('backend.gtfs.static._route_stops', mock_route_stops):
        resp = _client.get('/api/routes/6/stops?direction=1')
    assert resp.status_code == 200
    data = resp.json()
    assert data['route_id'] == '6'
    assert data['direction'] == 1
    assert len(data['stops']) == 2
    assert data['stops'][0]['stop_id'] == '640'


def test_route_stops_endpoint_404_for_unknown_route():
    with patch('backend.gtfs.static._route_stops', {}):
        resp = _client.get('/api/routes/Z99/stops?direction=0')
    assert resp.status_code == 404
