import { getMeetingScheduleByMeetingId, type MeetingSchedule } from '../booking/meeting-schedule'
import { getScheduleByAssessmentId, type AssessmentSchedule } from '../booking/schedule'

export type AdminMeetingSchedule = Pick<
  MeetingSchedule | AssessmentSchedule,
  | 'slot_start_utc'
  | 'slot_end_utc'
  | 'timezone'
  | 'guest_timezone'
  | 'guest_name'
  | 'guest_email'
  | 'google_meet_url'
  | 'google_event_link'
>

export async function loadAdminMeetingSchedule(
  db: D1Database,
  orgId: string,
  meetingId: string
): Promise<AdminMeetingSchedule | null> {
  return (
    (await getMeetingScheduleByMeetingId(db, orgId, meetingId)) ??
    (await getScheduleByAssessmentId(db, orgId, meetingId))
  )
}
