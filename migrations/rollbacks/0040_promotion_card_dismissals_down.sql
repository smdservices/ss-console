-- Manual rollback for migration 0040. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE: dropping this table removes the per-entity promotion-card
-- dismissal history (the cooldown record behind which skill-promotion cards
-- have been dismissed). The runtime degrades safely — cards simply reappear —
-- but the dismissal state is gone. Only invoke after confirming no production
-- surface depends on the dismissal cooldown.

DROP INDEX IF EXISTS idx_promotion_card_dismissals_entity;
DROP TABLE IF EXISTS promotion_card_dismissals;
