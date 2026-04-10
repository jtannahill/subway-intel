import pytest
from unittest.mock import patch


MOCK_STOPS = {
    '127':  {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229, 'parent_station': ''},
    '127N': {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229, 'parent_station': '127'},
    '127S': {'name': 'Times Sq-42 St', 'lat': 40.755983, 'lon': -73.986229, 'parent_station': '127'},
    '631':  {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848, 'parent_station': ''},
    '631N': {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848, 'parent_station': '631'},
    '631S': {'name': 'Grand Central-42 St', 'lat': 40.751776, 'lon': -73.976848, 'parent_station': '631'},
    '901':  {'name': 'Canal St', 'lat': 40.718092, 'lon': -74.000494, 'parent_station': ''},
    '901N': {'name': 'Canal St', 'lat': 40.718092, 'lon': -74.000494, 'parent_station': '901'},
    'GS':   {'name': 'Grand Central Shuttle', 'lat': 40.751999, 'lon': -73.976006, 'parent_station': ''},
}


def test_search_stops_empty_query_returns_empty():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('')
        assert results == []


def test_search_stops_no_match_returns_empty():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import search_stops
        results = search_stops('zzznomatch')
        assert results == []


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
        # 4 parent stops in mock: 127, 631, 901, GS
        assert len(results) == 4


def test_nearest_stops_includes_distance_mi():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        results = nearest_stops(lat=40.756, lon=-73.986, limit=1)
        assert 'distance_mi' in results[0]
        assert isinstance(results[0]['distance_mi'], float)


def test_nearest_stops_includes_non_directional_s_suffix():
    with patch('backend.gtfs.static._stops', MOCK_STOPS):
        from backend.gtfs.static import nearest_stops
        results = nearest_stops(lat=40.752, lon=-73.976, limit=5)
        stop_ids = [r['stop_id'] for r in results]
        assert 'GS' in stop_ids  # ends in S but is a parent station, not directional


def test_get_route_stops_returns_ordered_list():
    """get_route_stops returns stops in stop_sequence order."""
    mock_route_stops = {
        ('6', 1): [
            {'stop_id': '640', 'name': 'Pelham Bay Park'},
            {'stop_id': '639', 'name': 'Buhre Av'},
            {'stop_id': '631', 'name': 'Grand Central-42 St'},
        ]
    }
    with patch('backend.gtfs.static._route_stops', mock_route_stops):
        from backend.gtfs.static import get_route_stops
        stops = get_route_stops('6', 1)
        assert len(stops) == 3
        assert stops[0]['stop_id'] == '640'
        assert stops[2]['stop_id'] == '631'


def test_get_route_stops_returns_empty_for_unknown_route():
    with patch('backend.gtfs.static._route_stops', {}):
        from backend.gtfs.static import get_route_stops
        assert get_route_stops('Z99', 0) == []
