/**
 * HTML escaping for outbound alert emails.
 *
 * Both email paths in this Worker interpolate text that originates on a
 * customer Machine — `connector_down` details carry the seat's
 * `last_error_message`, and `source='sentry'` sink summaries carry an issue
 * title derived from an exception message. Neither is trusted input.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
