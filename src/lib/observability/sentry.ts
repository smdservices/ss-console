import * as Sentry from '@sentry/cloudflare'
import type { APIContext } from 'astro'
import { env } from 'cloudflare:workers'

/**
 * Workers-side Sentry integration. Wraps the Astro middleware request
 * handler with Sentry instrumentation when `SENTRY_DSN` is set; no-ops
 * otherwise.
 *
 * Why middleware-level wrapping (and not `withSentry` on the exported
 * fetch handler): the @astrojs/cloudflare adapter writes the Worker
 * entry at build time — there is no source-controlled handler to wrap.
 * `wrapRequestHandler` is the official @sentry/cloudflare path for
 * exactly this case (it's how the SvelteKit-on-Cloudflare integration
 * initialises Sentry from a per-request hook). See the Sentry SDK
 * README for `@sentry/cloudflare`.
 *
 * No-op behaviour: when `SENTRY_DSN` is unset, `withSentryRequestHandler`
 * returns the bare handler result. The Sentry SDK is imported but never
 * initialised, so no transport opens and no global handlers are wired.
 */

function buildOptions(dsn: string): Sentry.CloudflareOptions {
  return {
    dsn,
    environment: env.APP_BASE_URL?.includes('smd.services') ? 'production' : 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  }
}

export async function withSentryRequestHandler(
  context: APIContext,
  handler: () => Promise<Response>
): Promise<Response> {
  const dsn = env.SENTRY_DSN
  if (!dsn) return handler()

  return Sentry.wrapRequestHandler(
    {
      options: buildOptions(dsn),
      request: context.request,
      context: context.locals.cfContext,
    },
    handler
  )
}

/**
 * Report a caught-and-degraded error to Sentry without changing the
 * caller's control flow. Use at catch sites where the request continues
 * (or returns a handled 4xx/5xx) but the failure is operationally
 * significant — otherwise the graceful degrade makes the error invisible
 * to monitoring (2026-07-29 code review, Security §2.8).
 *
 * Only meaningful inside a request wrapped by `withSentryRequestHandler`
 * (the middleware wraps every request). No-ops when SENTRY_DSN is unset,
 * matching the wrapper's contract.
 */
export function captureError(err: unknown, area: string): void {
  if (!env.SENTRY_DSN) return
  Sentry.captureException(err, { tags: { area } })
}
