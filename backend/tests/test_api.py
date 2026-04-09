import pytest
from backend.api.websocket import ConnectionManager


def test_connection_manager_starts_empty():
    mgr = ConnectionManager()
    assert mgr.connection_count == 0


def test_connection_manager_broadcast_no_connections():
    """broadcast with no connections should not raise."""
    import asyncio
    mgr = ConnectionManager()
    asyncio.run(mgr.broadcast({'type': 'snapshot', 'arrivals': {}}))
