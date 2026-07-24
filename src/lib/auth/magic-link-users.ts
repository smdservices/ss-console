export interface MagicLinkClientUser {
  id: string
  org_id: string
  email: string
  name: string
  role: string
  entity_id: string | null
}

export async function getMagicLinkClientUser(
  db: D1Database,
  orgId: string,
  userId: string
): Promise<MagicLinkClientUser | null> {
  return await db
    .prepare(`SELECT * FROM users WHERE id = ? AND org_id = ? AND role = 'client'`)
    .bind(userId, orgId)
    .first<MagicLinkClientUser>()
}

export async function recordUserLogin(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(userId)
    .run()
}
