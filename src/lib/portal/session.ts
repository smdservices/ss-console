/**
 * Portal session helpers.
 *
 * Resolves the client record for an authenticated portal user.
 * Portal users are linked to clients via users.client_id.
 */

import type { Client } from '../db/clients'

interface UserRow {
  id: string
  org_id: string
  email: string
  name: string
  role: string
  client_id: string | null
}

/**
 * Resolve the client record for the current portal session.
 *
 * Looks up the user by session.userId to get client_id,
 * then fetches the client record.
 *
 * Returns null if the user or client is not found.
 */
export async function getPortalClient(
  db: D1Database,
  userId: string
): Promise<{ user: UserRow; client: Client } | null> {
  const user = await db
    .prepare(`SELECT * FROM users WHERE id = ? AND role = 'client'`)
    .bind(userId)
    .first<UserRow>()

  if (!user || !user.client_id) {
    return null
  }

  const client = await db
    .prepare('SELECT * FROM clients WHERE id = ?')
    .bind(user.client_id)
    .first<Client>()

  if (!client) {
    return null
  }

  return { user, client }
}
