-- Trust-ceiling promotion-card dismissals (per #811)
-- ============================================================================
--
-- Adds the `promotion_card_dismissals` table that records when a customer's
-- principal dismisses a "Skill ready for promotion?" recommendation card on
-- the AI Employee landing page (Today tab per platform-prd.md §12.1).
--
-- The card surfaces a skill once its 4-week approval-rate threshold has been
-- met (per §11.3 Promotion mechanics). A principal who is not ready to
-- promote can dismiss the card; the resolver hides it for a cooldown window
-- (7 days). If the criteria continue to hold past the cooldown, the card
-- re-surfaces — this is the "dismiss but re-surface" contract called for in
-- issue #811 so a partner who deferred the conversation eventually sees it
-- again rather than the recommendation falling on the floor forever.
--
-- Identity tuple: (entity_id, skill) is the natural key. A given customer
-- (entity) has at most one active dismissal per skill at any time. A new
-- dismissal upserts the row; the resolver compares dismissed_at against the
-- cooldown window.
--
-- The actor (user who clicked dismiss) is recorded for audit but the
-- cooldown is shared across all principals on the customer — dismissing for
-- the firm dismisses for everyone, since the trust-ceiling decision is the
-- firm's, not an individual reviewer's.
--
-- Forward-only, additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS promotion_card_dismissals (
  entity_id     TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- Skill name as it appears in customer.yaml's persona.skills[].name.
  -- Free-form TEXT to track the canonical-config vocabulary without a
  -- portal-side enum (the vocabulary lives in customer.yaml, not here).
  skill         TEXT NOT NULL,

  -- The user who dismissed the card. Recorded for audit; the resolver does
  -- not key off this — the cooldown is per (entity, skill), not per user.
  dismissed_by  TEXT NOT NULL REFERENCES users(id),

  -- ISO 8601 UTC timestamp. The resolver compares this against the
  -- cooldown window (7 days at v1) to decide whether to suppress the card.
  dismissed_at  TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (entity_id, skill)
);

CREATE INDEX IF NOT EXISTS idx_promotion_card_dismissals_entity
  ON promotion_card_dismissals(entity_id);
