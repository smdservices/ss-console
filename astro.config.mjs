import { defineConfig, sessionDrivers } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import tailwindcss from '@tailwindcss/vite'
import sitemap from '@astrojs/sitemap'
import clerk from '@clerk/astro'
import { isPublicMarketingUrl } from './src/lib/seo/sitemap-filter.mjs'

// SS uses its own session layer backed by the SESSIONS KV namespace (see
// src/lib/auth/session.ts); we don't use Astro's built-in session API. Pin
// an in-memory LRU driver so the Cloudflare adapter doesn't auto-wire a
// SESSION KV binding that we wouldn't populate or provision.
// `imageService: 'passthrough'` avoids the Cloudflare Images binding — SS
// doesn't use `astro:assets` components.
//
// Clerk integration:
//   - Identity layer for portal.smd.services (users, orgs, memberships,
//     invitations, sessions). Application "SMD Services" in the existing
//     Clerk workspace; production instance bound to smd.services apex with
//     auth subdomains at clerk./accounts./clkmail.smd.services.
//   - Requires PUBLIC_CLERK_PUBLISHABLE_KEY at build time and
//     CLERK_SECRET_KEY at runtime. Both live in Infisical (/ path); pulled
//     into .dev.vars for local dev and into Workers secrets for deploys.
//   - Coexists with the legacy magic-link auth in src/lib/auth/session.ts
//     during the transition. Magic-link routes keep working unchanged.
export default defineConfig({
  site: 'https://smd.services',
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  session: { driver: sessionDrivers.lruCache() },
  integrations: [clerk(), sitemap({ filter: isPublicMarketingUrl })],
  vite: {
    ssr: { optimizeDeps: { exclude: ['@clerk/astro/components'] } },
    optimizeDeps: { exclude: ['@clerk/astro/components'] },
    // Astro 7 / Vite 8 replaced esbuild's transform with Oxc. Oxc honors
    // tsconfig's `jsx: "preserve"` (set by astro/tsconfigs/base) and so leaves
    // JSX untransformed, which Rolldown then fails to parse. esbuild used to
    // transform `.tsx` by extension regardless. src/lib/pdf/sow-template.tsx is
    // our only JSX file (server-side SOW PDF rendering via @formepdf/react); it
    // imports React and uses the classic runtime, so pin that here. Note the
    // object form is required: `vite.oxc` extends Oxc's TransformOptions, whose
    // `jsx` accepts only `'preserve' | JsxOptions` — the bare `'react'` string
    // is valid on rolldown's InputOptions but rejected here.
    oxc: { jsx: { runtime: 'classic' } },
    plugins: [tailwindcss()],
  },
})
