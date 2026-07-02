/**
 * Serialize a JSON-LD schema object for safe embedding inside a
 * `<script type="application/ld+json">` element.
 *
 * `JSON.stringify` alone does not neutralize the substring `</script>`: inside a
 * script element the content is raw text terminated by the literal `</script`,
 * so a value containing `</script>` (authored today, or user-supplied in the
 * future) would break out of script context and into the HTML document.
 * Replacing every `<` with its JSON unicode escape keeps the output valid
 * JSON-LD (structured-data consumers decode the escape) while making a
 * `</script>` breakout impossible.
 *
 * Code review 2026-07-02 §2.3.
 */
export function serializeJsonLd(schema: unknown): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c')
}
