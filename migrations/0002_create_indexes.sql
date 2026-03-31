-- ============================================================================
-- Migration 0002: Create indexes for common query patterns
-- ============================================================================
--
-- Indexes are designed around the API query patterns defined in the PRD:
--   - Pipeline views: clients by status, assessments by status, quotes by status
--   - Engagement dashboards: engagements by status, milestones by engagement
--   - Invoicing: invoices by status, invoices by client
--   - Scheduling: follow-ups by scheduled date and status
--   - Time tracking: entries by engagement, entries by date
--   - Auth: magic links by token, users by email
--   - Multi-tenancy: org_id on all tenant-scoped tables
--
-- All composite indexes place org_id first to support multi-tenant query patterns.
-- ============================================================================


-- ============================================
-- CLIENTS indexes
-- ============================================
-- Pipeline view: list clients by status within an org
CREATE INDEX idx_clients_org_status ON clients(org_id, status);

-- Search by business name
CREATE INDEX idx_clients_org_name ON clients(org_id, business_name);


-- ============================================
-- USERS indexes
-- ============================================
-- Auth: look up user by email within org (covered by UNIQUE constraint)
-- Additional: look up users linked to a client record
CREATE INDEX idx_users_client_id ON users(client_id);


-- ============================================
-- CONTACTS indexes
-- ============================================
-- List contacts for a client
CREATE INDEX idx_contacts_client_id ON contacts(client_id);

-- Email lookup across org
CREATE INDEX idx_contacts_org_email ON contacts(org_id, email);


-- ============================================
-- ASSESSMENTS indexes
-- ============================================
-- Pipeline view: assessments by status within an org
CREATE INDEX idx_assessments_org_status ON assessments(org_id, status);

-- Look up assessments for a specific client
CREATE INDEX idx_assessments_client_id ON assessments(client_id);


-- ============================================
-- QUOTES indexes
-- ============================================
-- Pipeline view: quotes by status within an org
CREATE INDEX idx_quotes_org_status ON quotes(org_id, status);

-- Look up quotes for a specific client
CREATE INDEX idx_quotes_client_id ON quotes(client_id);

-- Look up quotes derived from an assessment
CREATE INDEX idx_quotes_assessment_id ON quotes(assessment_id);

-- Quote versioning: find child quotes
CREATE INDEX idx_quotes_parent_id ON quotes(parent_quote_id);


-- ============================================
-- ENGAGEMENTS indexes
-- ============================================
-- Dashboard view: engagements by status within an org
CREATE INDEX idx_engagements_org_status ON engagements(org_id, status);

-- Look up engagements for a specific client
CREATE INDEX idx_engagements_client_id ON engagements(client_id);

-- Look up engagement by quote
CREATE INDEX idx_engagements_quote_id ON engagements(quote_id);


-- ============================================
-- ENGAGEMENT CONTACTS indexes
-- ============================================
-- List contacts for an engagement (covered partially by UNIQUE constraint)
CREATE INDEX idx_engagement_contacts_engagement ON engagement_contacts(engagement_id);

-- Reverse lookup: find engagements a contact is involved in
CREATE INDEX idx_engagement_contacts_contact ON engagement_contacts(contact_id);


-- ============================================
-- MILESTONES indexes
-- ============================================
-- List milestones for an engagement in order
CREATE INDEX idx_milestones_engagement_order ON milestones(engagement_id, sort_order);

-- Find milestones by status (e.g., pending payment triggers)
CREATE INDEX idx_milestones_status ON milestones(status);


-- ============================================
-- PARKING LOT indexes
-- ============================================
-- List parking lot items for an engagement
CREATE INDEX idx_parking_lot_engagement ON parking_lot(engagement_id);

-- Find unresolved items (no disposition yet)
CREATE INDEX idx_parking_lot_disposition ON parking_lot(disposition);


-- ============================================
-- INVOICES indexes
-- ============================================
-- Dashboard view: invoices by status within an org
CREATE INDEX idx_invoices_org_status ON invoices(org_id, status);

-- Look up invoices for a specific client
CREATE INDEX idx_invoices_client_id ON invoices(client_id);

-- Look up invoices for an engagement
CREATE INDEX idx_invoices_engagement_id ON invoices(engagement_id);

-- Stripe reconciliation
CREATE INDEX idx_invoices_stripe_id ON invoices(stripe_invoice_id);

-- Overdue invoice tracking
CREATE INDEX idx_invoices_due_date ON invoices(due_date);


-- ============================================
-- FOLLOW-UPS indexes
-- ============================================
-- Scheduling view: upcoming follow-ups by date and status within an org
CREATE INDEX idx_follow_ups_org_scheduled ON follow_ups(org_id, status, scheduled_for);

-- Look up follow-ups for a specific client
CREATE INDEX idx_follow_ups_client_id ON follow_ups(client_id);

-- Look up follow-ups for an engagement
CREATE INDEX idx_follow_ups_engagement_id ON follow_ups(engagement_id);

-- Look up follow-ups for a quote (proposal follow-up cadence)
CREATE INDEX idx_follow_ups_quote_id ON follow_ups(quote_id);


-- ============================================
-- TIME ENTRIES indexes
-- ============================================
-- Hours tracking: entries for an engagement
CREATE INDEX idx_time_entries_engagement ON time_entries(engagement_id);

-- Date-based reporting within an org
CREATE INDEX idx_time_entries_org_date ON time_entries(org_id, date);


-- ============================================
-- MAGIC LINKS indexes
-- ============================================
-- Auth: look up by token (covered by UNIQUE constraint on token)
-- Cleanup: find expired/used links
CREATE INDEX idx_magic_links_email ON magic_links(email);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
