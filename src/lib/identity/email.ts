/**
 * The canonical form of an email address used as an identity key (ss#2315).
 *
 * Email is the join key between a person and their row in `users` or
 * `contacts`, and before this module it was normalized six different ways —
 * three with no trim, one case-sensitive on both sides. The consequences
 * ranged from a duplicate contact row to a silent lockout (#2282, fixed in
 * PR #2294) to a person stranded on a second, entity-less `users` row
 * (documented inline at `src/lib/auth/clerk-bridge.ts`).
 *
 * Two rules, and they are separate on purpose:
 *
 * 1. **Compare normalized.** Every lookup that treats an address as identity
 *    binds `normalizeEmail(input)` and — because neither `users.email`
 *    (`migrations/0001_create_tables.sql:136`) nor `contacts.email` (`:164`)
 *    carries `COLLATE NOCASE` — folds the column too: `lower(email) = ?`.
 *    Folding only the input is the bug this module exists to prevent.
 *
 * 2. **Store what was given.** Normalizing on the way IN is deliberately not
 *    this module's job. `users.email` is displayed to admins and echoed back
 *    to the person, and for Clerk-bridged rows it is the IdP's verified
 *    primary address — the trust anchor. Rewriting its casing to satisfy a
 *    lookup would be the lookup's problem leaking into the record. Sites
 *    that already stored a normalized value (`src/lib/sow/service-finalize.ts`)
 *    keep doing so; nothing new starts.
 *
 * Nothing here validates. Address syntax is checked at the API boundary by
 * the route's zod schema; this is normalization only.
 */

/**
 * Fold an address to its identity form: surrounding whitespace removed,
 * lowercased.
 *
 * Case-folding the local part is technically beyond what RFC 5321 permits a
 * receiver to assume, but every mail provider this venture transacts with
 * treats it case-insensitively, and an IdP echoes whatever casing its own
 * directory holds — Microsoft and Google both return the directory's spelling,
 * not the one the person typed. Treating the two as different people has only
 * ever produced defects.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * SQL predicate for an identity lookup on an `email` column, for use with a
 * `normalizeEmail`-normalized bind parameter.
 *
 * The column is folded here rather than at write time because existing rows
 * carry whatever casing they were created with — prod holds at least one
 * mixed-case `users` row (#2282). Callers that inline the fragment instead of
 * importing it are equally correct; the constant exists so the reason travels
 * with the pattern.
 */
export const EMAIL_IDENTITY_PREDICATE = 'lower(email) = ?'
