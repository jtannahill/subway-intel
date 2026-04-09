from __future__ import annotations
import logging
import os
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)
_pool: Optional[asyncpg.Pool] = None


async def init_pool(dsn: Optional[str] = None) -> None:
    global _pool
    url = dsn or os.environ.get('DATABASE_URL', '')
    if not url:
        # Try assembling from individual Fargate-injected env vars
        host = os.environ.get('DB_HOST', '')
        port = os.environ.get('DB_PORT', '5432')
        name = os.environ.get('DB_NAME', '')
        user = os.environ.get('DB_USER', '')
        pw = os.environ.get('DB_PASS', '')
        if host and user and pw:
            url = f'postgresql://{user}:{pw}@{host}:{port}/{name}'
    if not url:
        logger.warning('DATABASE_URL not set — DB writes disabled')
        return
    try:
        _pool = await asyncpg.create_pool(url, min_size=2, max_size=10, command_timeout=10)
        logger.info('TimescaleDB pool ready')
    except Exception as e:
        logger.error('DB pool init failed: %s', e)
        _pool = None


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> Optional[asyncpg.Pool]:
    return _pool
