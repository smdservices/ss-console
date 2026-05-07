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
