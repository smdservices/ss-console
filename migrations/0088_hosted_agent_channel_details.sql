-- 0088: persist the go-live channel details on the intake row (ADR 0067).
--
-- Found by the live dry-run: the Captain-authored channel details (how the
-- customer reaches their agent) were rendered into the one-time go-live
-- email and then dropped. The portal live view -- the page a subscriber
-- lives with -- had no way to show them. The activate action now persists
-- the authored text here, and the live view renders it verbatim.
ALTER TABLE hosted_agent_intake ADD COLUMN channel_details TEXT;
