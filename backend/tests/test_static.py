import pytest
from unittest.mock import patch


MOCK_STOPS = {
    '127':  {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229},
    '127N': {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229},
    '127S': {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229},
    '631':  {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848},
    '631N': {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848},
    '631S': {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848},
    '901':  {'name': 'Canal St', 'lat': 40.718092, 'lon': -74.000494},
    '901N': {'name': 'Canal St', 'lat': 40.718092, 'lon': -74.000494},
}


def test_search_stops_deduplicates_by_name():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('42')
        names = [r['name'] for r in results]
        assert names.count('Times Sq-42 St') == 1
        assert names.count('Grand Central-42 St') == 1


def test_search_stops_prefers_parent_stop_id():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('times')
        assert len(results) == 1
        assert results[0]['stop_id'] == '127'  # parent, not 127N or 127S


def test_search_stops_returns_lat_lon():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('canal')
        assert len(results) == 1
        assert results[0]['lat'] == 40.718092
        assert results[0]['lon'] == -74.000494


def test_nearest_stops_returns_closest():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        # Query near Times Sq
        results = nearest_stops(lat=40.756, lon=-73.986, limit=1)
        assert len(results) == 1
        assert results[0]['stop_id'] == '127'
        assert results[0]['distance_mi'] < 0.1


def test_nearest_stops_excludes_directional_stops():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        results = nearest_stops(lat=40.756, lon=-73.986, limit=5)
        stop_ids = [r['stop_id'] for r in results]
        assert '127N' not in stop_ids
        assert '127S' not in stop_ids


def test_nearest_stops_includes_distance_mi():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        results = nearest_stops(lat=40.756, lon=-73.986, limit=1)
        assert 'distance_mi' in results[0]
        assert isinstance(results[0]['distance_mi'], float)
