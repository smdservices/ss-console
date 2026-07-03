-- 0082: fleet_status gains the cost-breaker ladder level (ADR 0062, #1661).
--
-- The Machine-side heartbeat (overlay shared/heartbeat.py) now carries an
-- optional `sticky_stop_level` field read from the Machine-local breaker
-- state (OK | WARN | SOFT_STOP | HARD_STOP | unknown). The receiver stores
-- it verbatim; NULL means the Machine did not report a level this beat
-- (fresh Machine with no state file, or the read failed) — displayed as
-- unknown, never as OK. The fleet roster escalates the seat's dot on
-- SOFT_STOP (yellow) / HARD_STOP (red).

ALTER TABLE fleet_status ADD COLUMN sticky_stop_level TEXT;
