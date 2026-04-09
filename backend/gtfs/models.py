from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class LineStatus(str, Enum):
    NOMINAL = 'NOMINAL'
    DELAYED = 'DELAYED'
    DISRUPTED = 'DISRUPTED'


@dataclass
class ArrivalRecord:
    route_id: str
    trip_id: str
    stop_id: str
    arrival_time: datetime
    delay_sec: int
    direction: str  # 'N' or 'S'

    @property
    def delay_minutes(self) -> float:
        return self.delay_sec / 60.0


@dataclass
class ServiceAlert:
    route_id: str
    effect: str
    severity: str
    header: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class LineHealth:
    route_id: str
    status: LineStatus
    avg_delay_sec: float
    headway_variance: float
    alerts: list[str] = field(default_factory=list)

    @staticmethod
    def status_from_delay(avg_delay_sec: float) -> LineStatus:
        if avg_delay_sec < 60:
            return LineStatus.NOMINAL
        if avg_delay_sec < 300:
            return LineStatus.DELAYED
        return LineStatus.DISRUPTED
