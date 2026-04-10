import pytest
from backend.api.websocket import ConnectionManager
from unittest.mock import patch


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
    from fastapi.testclient import TestClient
    with patch('backend.gtfs.static._stops', MOCK_STOPS_FOR_NEAREST):
        from backend.main import app
        client = TestClient(app)
        resp = client.get('/api/stops/nearest?lat=40.756&lon=-73.986&limit=1')
        assert resp.status_code == 200
        data = resp.json()
        assert len(data['results']) == 1
        assert data['results'][0]['stop_id'] == '127'
        assert data['results'][0]['distance_mi'] < 0.1


def test_nearest_stops_endpoint_default_limit_is_one():
    from fastapi.testclient import TestClient
    with patch('backend.gtfs.static._stops', MOCK_STOPS_FOR_NEAREST):
        from backend.main import app
        client = TestClient(app)
        resp = client.get('/api/stops/nearest?lat=40.755&lon=-73.986')
        assert resp.status_code == 200
        assert len(resp.json()['results']) == 1
