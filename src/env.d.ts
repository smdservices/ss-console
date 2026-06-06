// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../.astro/types.d.ts" />

/** WASM module imports — handled by Cloudflare adapter at build time */
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

/** Raw-text imports (Vite ?raw) — used to load operator skill bodies as the single source of truth. */
declare module '*.md?raw' {
  const content: string
  export default content
}

/**
 * Service binding shape for the `ss-enrichment-workflow` Worker (#631).
 * ss-web's lead-gen workers and admin endpoints dispatch entity enrichment
 * by POSTing to the internal `/dispatch` endpoint on this binding. The
 * target Worker holds the `[[workflows]]` binding for the
 * `EnrichmentWorkflow` class.
 */
interface EnrichmentWorkflowServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/**
 * Cloudflare Worker bindings and env vars.
 *
 * Accessed via `import { env } from 'cloudflare:workers'` (adapter v13+).
 * The `Env` interface below augments the one exported by `cloudflare:workers`
 * so callsites get full typing.
 *
 *   D1            — structured data (clients, quotes, engagements, etc.)
 *   R2            — document storage (SOWs, transcripts, handoff docs)
 *   SESSIONS KV   — session storage for auth middleware (custom — separate
 *                   from Astro's built-in session KV, which we don't use)
 *   BOOKING_CACHE — rate-limit buckets for /api/booking/reserve
 *
 * Binding names must match wrangler.toml declarations.
 */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    STORAGE: R2Bucket
    /**
     * R2 bucket for consultant portrait photos. Separate from STORAGE because
     * this bucket is intended to be public (objects served directly to the
     * portal via a Cloudflare-managed public URL). See wrangler.toml.
     */
    CONSULTANT_PHOTOS: R2Bucket
    SESSIONS: KVNamespace
    BOOKING_CACHE: KVNamespace
    /**
     * Canonical absolute URL for the marketing/admin app, e.g.
     * `https://smd.services`. Used to build outbound auth, portal,
     * and webhook callback links — never derive from request host.
     * See `src/lib/config/app-url.ts` and GitHub issue #173.
     */
    APP_BASE_URL?: string
    /**
     * Canonical absolute URL for the client portal, e.g.
     * `https://portal.smd.services`. Optional — falls back to
     * `APP_BASE_URL` when unset (the portal is the same Worker
     * deployment served under a subdomain rewrite).
     */
    PORTAL_BASE_URL?: string
    /**
     * Canonical absolute URL for the admin console, e.g.
     * `https://admin.smd.services`. Required for OAuth redirect URIs
     * and outbound admin links. Unlike PORTAL_BASE_URL, this does NOT
     * fall back to APP_BASE_URL — silent fallback would emit the wrong
     * OAuth redirect and cause redirect_uri_mismatch errors.
     */
    ADMIN_BASE_URL?: string
    RESEND_API_KEY?: string
    /**
     * Resend webhook signing secret (`whsec_…` from the Resend dashboard
     * webhook detail page). Used to verify Svix-signed webhook deliveries
     * for the outreach attribution path. See
     * src/pages/api/webhooks/resend.ts and issue #587.
     */
    RESEND_WEBHOOK_SECRET?: string
    ANTHROPIC_API_KEY?: string
    SIGNWELL_API_KEY?: string
    SIGNWELL_WEBHOOK_SECRET?: string
    STRIPE_API_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string
    LEAD_INGEST_API_KEY?: string
    GOOGLE_PLACES_API_KEY?: string
    OUTSCRAPER_API_KEY?: string
    SERPAPI_API_KEY?: string
    PROXYCURL_API_KEY?: string
    // Booking system (Calendly replacement) — added with migration 0011
    /** Google Cloud OAuth 2.0 client ID for Calendar integration. */
    GOOGLE_CLIENT_ID?: string
    /** Google Cloud OAuth 2.0 client secret. */
    GOOGLE_CLIENT_SECRET?: string
    /**
     * 32-byte base64-encoded random key used to AES-GCM encrypt Google
     * refresh tokens at rest in the `integrations` table. Generate with
     * `openssl rand -base64 32`.
     */
    BOOKING_ENCRYPTION_KEY?: string
    /** Static video call URL for booking events (e.g. Zoom personal meeting link). */
    MEETING_URL?: string
    /**
     * Public base URL for the CONSULTANT_PHOTOS bucket, e.g.
     * `https://pub-<id>.r2.dev` (dev-time) or a custom domain like
     * `https://photos.smd.services` in production. When unset, the upload
     * endpoint falls back to streaming via `/api/portal/consultants/photo/[key]`.
     */
    CONSULTANT_PHOTOS_PUBLIC_BASE?: string
    /**
     * Lead-gen worker origins. Used by the admin "Run now" button to
     * invoke each worker's fetch handler on demand (bearer-authed via
     * LEAD_INGEST_API_KEY). Unset in dev — the admin UI degrades to a
     * disabled Run-now button when the URL or key is missing.
     */
    NEW_BUSINESS_WORKER_URL?: string
    JOB_MONITOR_WORKER_URL?: string
    REVIEW_MINING_WORKER_URL?: string
    SOCIAL_LISTENING_WORKER_URL?: string
    /**
     * Feature flag for the public /patterns aggregate page. Off by default.
     * Set to "1" or "true" in wrangler.toml once the unlock condition
     * documented in src/pages/patterns.astro is met (>=20 real assessments
     * with cross-vertical diversity, per CLAUDE.md no-fabrication rule).
     * Any other value keeps the page returning 404.
     */
    ENABLE_PUBLIC_PATTERNS?: string
    /**
     * Sentry DSN for Workers-side error monitoring. Optional — when unset,
     * the integration is a complete no-op (no SDK init, zero overhead).
     * Provisioned via `wrangler secret put SENTRY_DSN`. See
     * src/lib/observability/sentry.ts.
     */
    SENTRY_DSN?: string
    /**
     * Service binding to the `ss-enrichment-workflow` Worker (#631). Hosts
     * the EnrichmentWorkflow class for entity enrichment. Dispatched from
     * lead-gen workers and admin endpoints by POSTing to the binding's
     * internal `/dispatch` endpoint with `{ entityId, orgId, mode, triggered_by }`.
     * Optional in dev / vitest where the binding doesn't exist; the
     * dispatcher logs a warning and skips when absent in non-prod, throws
     * in prod (a missing binding in prod is a deploy ordering bug).
     */
    ENRICHMENT_WORKFLOW_SERVICE?: EnrichmentWorkflowServiceBinding
    /**
     * Clerk secret key (sk_test_* for dev, sk_live_* for prod). Used by
     * @clerk/astro middleware to authenticate Clerk sessions on
     * portal.smd.services. Pulled from Infisical at deploy time per the
     * standard wrangler secret bulk pattern documented in CLAUDE.md.
     */
    CLERK_SECRET_KEY?: string
    /**
     * Microsoft Graph OAuth 2.0 client ID and secret. Used by the
     * Operator OAuth callback (issue #879) to exchange authorization
     * codes for tokens during connector consent flows. Issued by an
     * Azure AD app registration whose redirect URI list includes
     * `${ADMIN_BASE_URL}/api/oauth/callback`.
     */
    MICROSOFT_GRAPH_CLIENT_ID?: string
    MICROSOFT_GRAPH_CLIENT_SECRET?: string
    /**
     * HMAC-SHA256 signing key for stateless OAuth state parameters used
     * by /api/oauth/callback (issue #879, Operator connector consent).
     * 32 random bytes, base64-encoded. Generate with
     * `openssl rand -base64 32`. Rotation: bump the secret in Workers
     * env; in-flight states issued under the old key fail validation at
     * the callback and the reviewer simply re-initiates consent. No
     * grace window required because state TTL is 10 minutes. See
     * src/lib/oauth/state.ts.
     */
    OAUTH_STATE_SIGNING_KEY?: string
    /**
     * Fly.io API token (SMD-owned, from Infisical) used by the OAuth token
     * relay (`src/lib/oauth/store.ts`) to set a customer app's
     * `GOOGLE_TOKEN_JSON` secret and restart its Machine on connect/re-consent.
     * Must be a Worker secret, never a `[vars]` entry. Scope it to the
     * customer apps it manages. See the OAuth-token-relay ADR.
     */
    FLY_API_TOKEN?: string
    /**
     * Cloudflare account id and D1 HTTP API token, used by the Captain
     * cost dashboard (issue #885) to read per-customer `cost_telemetry`
     * rows over HTTP. Per ADR 0009 each customer has their own D1
     * database; declaring N per-customer bindings at deploy time does
     * not scale, so the dashboard goes through the same HTTP path the
     * `ss-cost-telemetry` worker uses to write those tables.
     *
     * The token requires D1:Read scope across customer databases. When
     * unset the dashboard renders an explicit configuration warning
     * rather than fabricating zero-cost data.
     */
    CF_ACCOUNT_ID?: string
    CF_D1_API_TOKEN?: string
    /**
     * Shared bearer secret for the per-customer Operator Machine
     * heartbeat path (`POST /api/internal/heartbeat`). Wave 1 uses a
     * single shared key authenticating ANY Machine; the X-Tenant-Slug
     * header identifies the tenant. Single-secret shape is right-sized
     * for fleet-of-one (SMD customer-zero); per-tenant upgrade path is
     * documented in ADR 0023 §"Cross-cutting calls" #10 (gated on
     * customer #2 onboarding). Generated with `openssl rand -hex 32`.
     */
    MACHINE_HEARTBEAT_KEY?: string
    /**
     * Sentry Internal Integration Client Secret used to verify
     * `Sentry-Hook-Signature` headers on inbound alert-rule webhook
     * deliveries to `/api/webhooks/sentry`. Pulled from the SMD-owned
     * `smd-operator` Sentry project's Internal Integration settings
     * (ADR 0023 Wave 1).
     */
    SENTRY_WEBHOOK_SECRET?: string
    /**
     * Shared bearer token for inbound healthchecks.io webhook deliveries
     * to `/api/webhooks/healthchecks`. Healthchecks.io does NOT sign
     * webhooks, so the integration is configured with an
     * `Authorization: Bearer <secret>` header set in the healthchecks.io
     * UI (ADR 0023 Wave 1).
     */
    HEALTHCHECKS_WEBHOOK_SECRET?: string
  }
}

/**
 * Session data attached by auth middleware on authenticated routes.
 */
interface AuthSession {
  userId: string
  orgId: string
  role: string
  email: string
  expiresAt: string
}

declare namespace App {
  interface Locals {
    /** Populated by auth middleware on /admin/* and /portal/* routes. Null on public routes. */
    session: AuthSession | null
    /** Cloudflare execution context (waitUntil, passThroughOnException). Provided by adapter v13. */
    cfContext?: ExecutionContext
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_GA4_MEASUREMENT_ID?: string
  readonly PUBLIC_GA4_INTERNAL_HOST_PATTERNS?: string
  /**
   * Clerk publishable key (pk_test_* for dev, pk_live_* for prod). Required
   * at build time — @clerk/astro inlines it into the client bundle. Pulled
   * from Infisical into .dev.vars locally and into Workers env at deploy.
   */
  readonly PUBLIC_CLERK_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
