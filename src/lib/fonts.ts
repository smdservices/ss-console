/**
 * Single source of truth for the web font pipeline.
 *
 * The canonical typography system is exactly two families (Captain
 * ruling 2026-07-06): Archivo (display + body) and JetBrains Mono
 * (eyebrows, labels, chips, table headers, fixed-width data).
 * Archivo Narrow is retired.
 *
 * Every <head> that loads fonts must reference this constant instead
 * of hand-typing a fonts.googleapis.com URL, so the family set changes
 * in one place. Enforced by tests/typography-tokens.test.ts.
 *
 * JetBrains Mono loads 600/700 because label/eyebrow usage renders
 * semibold and bold; without them the browser synthesizes faux bold.
 */
export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap'
