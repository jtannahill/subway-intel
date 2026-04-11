from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

FEEDBACK_FILE = Path(__file__).parent.parent.parent / 'data' / 'arrival_feedback.ndjson'


def record_feedback(
    stop_id: str,
    route_id: str,
    scheduled_arrival: str,
    train_present: bool,
) -> None:
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        'stop_id': stop_id,
        'route_id': route_id,
        'scheduled_arrival': scheduled_arrival,
        'train_present': train_present,
        'reported_at': datetime.now(timezone.utc).isoformat(),
    }
    try:
        with FEEDBACK_FILE.open('a') as f:
            f.write(json.dumps(entry) + '\n')
    except OSError as e:
        logger.error('Failed to write feedback: %s', e)


def get_corrections() -> dict[str, float]:
    """Return per-route average bias in seconds (positive = trains arrive later than GTFS-RT says).

    Only uses Y (train_present=True) responses, which give an exact observed offset.
    N responses are lower-bound observations — excluded from the point estimate.
    """
    if not FEEDBACK_FILE.exists():
        return {}

    offsets: dict[str, list[float]] = {}
    with FEEDBACK_FILE.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not entry.get('train_present'):
                continue
            try:
                scheduled = datetime.fromisoformat(entry['scheduled_arrival'])
                reported = datetime.fromisoformat(entry['reported_at'])
            except (KeyError, ValueError):
                continue
            offset_sec = (reported - scheduled).total_seconds()
            route = entry.get('route_id', '')
            if not route:
                continue
            offsets.setdefault(route, []).append(offset_sec)

    return {
        route: round(sum(vals) / len(vals), 1)
        for route, vals in offsets.items()
        if vals
    }
