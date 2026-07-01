import { getMeeting } from '../db/meetings'

export interface AssessmentRedirectTarget {
  id: string
  entity_id: string
}

export async function getAssessmentRedirectTarget(
  db: D1Database,
  orgId: string,
  assessmentId: string
): Promise<AssessmentRedirectTarget | null> {
  const meeting = await getMeeting(db, orgId, assessmentId)
  if (!meeting) return null
  return { id: meeting.id, entity_id: meeting.entity_id }
}
