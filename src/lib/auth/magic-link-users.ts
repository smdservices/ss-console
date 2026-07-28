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

export async function recordUserLogin(db: D1Database, user: MagicLinkClientUser): Promise<void> {
  await db
    .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(user.id)
    .run()

  // Sign-in history (0098). Magic-link logins have no Clerk session id;
  // best-effort — a missing table on an un-migrated env must never break
  // the legacy verify path.
  try {
    await db
      .prepare(
        `INSERT INTO portal_login_events
           (id, user_id, entity_id, email, clerk_user_id, clerk_session_id, method, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, 'magic_link', ?)`
      )
      .bind(crypto.randomUUID(), user.id, user.entity_id, user.email, new Date().toISOString())
      .run()
  } catch (err) {
    console.error('magic-link-users: failed to record sign-in history', err)
  }
}
