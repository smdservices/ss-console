/**
 * Cloudflare Worker entrypoint (#614).
 *
 * Why a custom worker entrypoint
 * ------------------------------
 * Cloudflare Workflows requires the WorkflowEntrypoint subclass to be a
 * named export from the Worker module that the runtime loads. The
 * `@astrojs/cloudflare` v13 adapter ships a default fetch-only entry
 * (`@astrojs/cloudflare/entrypoints/server`) that re-exports a single
 * `default` object. To attach a Workflow we must re-export both:
 *
 *   - `default`: the Astro SSR fetch handler (delegated to the adapter's
 *                handle() so subdomain rewriting + middleware all run)
 *   - `ScanDiagnosticWorkflow`: the workflow class bound in wrangler.toml
 *     under `[[workflows]]` with `class_name = "ScanDiagnosticWorkflow"`
 *
 * The wrangler.toml `main` field points at this file. Adding more
 * Workflow exports (or Durable Objects) in the future is a matter of
 * adding another `export { ... } from ...` line — same pattern.
 *
 * Anything not exported here is private to the Worker; the SSR handler
 * still imports the Astro app via the adapter's bundling.
 */

// Astro's Cloudflare adapter wraps its SSR pipeline in `handle()`. We
// re-export the default object the adapter would have emitted so the
// runtime sees a `fetch` member exactly the way it did before.
export { default } from '@astrojs/cloudflare/entrypoints/server'

// Workflow classes — must be named exports the wrangler.toml binding can
// reference by class_name. Adding new workflows is additive: add the
// class, re-export it here, add a [[workflows]] entry in wrangler.toml.
export { ScanDiagnosticWorkflow } from './lib/diagnostic/workflow'
