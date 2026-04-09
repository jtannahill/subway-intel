-- Run once against TimescaleDB instance
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS train_positions (
    time         TIMESTAMPTZ NOT NULL,
    trip_id      TEXT,
    route_id     TEXT,
    stop_id      TEXT,
    arrival_est  TIMESTAMPTZ,
    delay_sec    INTEGER
);
SELECT create_hypertable('train_positions', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_train_positions_route ON train_positions (route_id, time DESC);

CREATE TABLE IF NOT EXISTS service_alerts (
    time      TIMESTAMPTZ NOT NULL,
    route_id  TEXT,
    effect    TEXT,
    severity  TEXT,
    header    TEXT
);
SELECT create_hypertable('service_alerts', 'time', if_not_exists => TRUE);

-- 5-minute rollup: avg delay per route
CREATE MATERIALIZED VIEW IF NOT EXISTS delay_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    route_id,
    AVG(delay_sec) AS avg_delay_sec,
    COUNT(*) AS sample_count
FROM train_positions
GROUP BY bucket, route_id;

-- Retention: keep raw data for 90 days
SELECT add_retention_policy('train_positions', INTERVAL '90 days', if_not_exists => TRUE);
