/**
 * Operations Health Scorecard — Question bank and constants.
 *
 * Single source of truth for all scorecard content. Imported server-side
 * by the API endpoint and the Astro page. Scoring constants are serialized
 * into the page for client-side use.
 *
 * @see docs/design/operations-health-scorecard.md — full spec
 */

// ---------------------------------------------------------------------------
// Dimensions — maps to canonical problem IDs in extraction-schema.ts
// ---------------------------------------------------------------------------

export type DimensionId =
  | 'owner_bottleneck'
  | 'lead_leakage'
  | 'financial_blindness'
  | 'scheduling_chaos'
  | 'manual_communication'
  | 'employee_retention'

export interface Dimension {
  id: DimensionId
  label: string
  icon: string
  sectionHeader: string
}

export const DIMENSIONS: Dimension[] = [
  {
    id: 'owner_bottleneck',
    label: 'Owner Independence',
    icon: 'person_off',
    sectionHeader: "Let's start with your day-to-day",
  },
  {
    id: 'lead_leakage',
    label: 'Lead Follow-up',
    icon: 'leaderboard',
    sectionHeader: 'How new business comes in',
  },
  {
    id: 'financial_blindness',
    label: 'Financial Visibility',
    icon: 'account_balance',
    sectionHeader: 'The money side',
  },
  {
    id: 'scheduling_chaos',
    label: 'Scheduling',
    icon: 'calendar_month',
    sectionHeader: 'Keeping the calendar straight',
  },
  {
    id: 'manual_communication',
    label: 'Communication',
    icon: 'forum',
    sectionHeader: 'Staying in touch with customers',
  },
  {
    id: 'employee_retention',
    label: 'Employee Retention',
    icon: 'group_remove',
    sectionHeader: 'Your team',
  },
]

// ---------------------------------------------------------------------------
// Context questions (3 questions before the scored walkthrough)
// ---------------------------------------------------------------------------

export interface ContextOption {
  value: string
  label: string
}

export interface ContextQuestion {
  id: string
  label: string
  options: ContextOption[]
}

export const CONTEXT_QUESTIONS: ContextQuestion[] = [
  {
    id: 'vertical',
    label: 'What type of business do you run?',
    options: [
      { value: 'home_services', label: 'Home Services (plumber, HVAC, electrician, etc.)' },
      {
        value: 'professional_services',
        label: 'Professional Services (accountant, attorney, agency, etc.)',
      },
      { value: 'contractor_trades', label: 'Contractor / Trades' },
      { value: 'retail_salon', label: 'Retail / Salon / Spa' },
      { value: 'restaurant_food', label: 'Restaurant / Food Service' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'employee_range',
    label: 'How many people are on your team?',
    options: [
      { value: '1-5', label: '1-5' },
      { value: '6-10', label: '6-10' },
      { value: '11-25', label: '11-25' },
      { value: '26-50', label: '26-50' },
      { value: '50+', label: '50+' },
    ],
  },
  {
    id: 'role',
    label: "What's your role?",
    options: [
      { value: 'owner', label: 'Owner' },
      { value: 'office_manager', label: 'Office Manager' },
      { value: 'other', label: 'Other' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Scored questions (18 questions, 3 per dimension)
// ---------------------------------------------------------------------------

export interface QuestionOption {
  key: 'a' | 'b' | 'c' | 'd' | 'skip'
  score: 0 | 1 | 2 | 3 | -1
  text: string
}

export interface ScoredQuestion {
  id: string
  dimension: DimensionId
  text: string
  options: QuestionOption[]
}

export const QUESTIONS: ScoredQuestion[] = [
  // --- Owner Bottleneck ---
  {
    id: 'q1',
    dimension: 'owner_bottleneck',
    text: "When a team member needs to make a decision that's outside their normal routine, what happens?",
    options: [
      { key: 'a', score: 0, text: 'They wait for me — I make most of the calls' },
      { key: 'b', score: 1, text: 'They text or call me and I handle it when I can' },
      {
        key: 'c',
        score: 2,
        text: 'A few senior people can handle it, but anything big comes to me',
      },
      {
        key: 'd',
        score: 3,
        text: 'We have clear guidelines for who decides what — I rarely get pulled in',
      },
    ],
  },
  {
    id: 'q2',
    dimension: 'owner_bottleneck',
    text: 'If you had to take an unplanned week off tomorrow, what would happen to operations?',
    options: [
      { key: 'a', score: 0, text: "Things would stop — I'm involved in almost everything" },
      {
        key: 'b',
        score: 1,
        text: 'The basics would keep going, but nothing new would move forward',
      },
      { key: 'c', score: 2, text: 'Most things would be fine, but a few key areas need me' },
      { key: 'd', score: 3, text: 'The team would handle it — they know the playbook' },
    ],
  },
  {
    id: 'q3',
    dimension: 'owner_bottleneck',
    text: 'How are your core business processes (how jobs get done, how customers get served) documented?',
    options: [
      { key: 'a', score: 0, text: "They're not — it's all in my head or people just know" },
      { key: 'b', score: 1, text: "I've written some things down, but it's scattered or outdated" },
      { key: 'c', score: 2, text: "We have some docs, but they're not consistently followed" },
      { key: 'd', score: 3, text: 'Key processes are documented and the team actually uses them' },
    ],
  },

  // --- Lead Leakage ---
  {
    id: 'q4',
    dimension: 'lead_leakage',
    text: 'When a new lead comes in (call, form, referral), what happens next?',
    options: [
      { key: 'a', score: 0, text: 'Whoever answers deals with it — no set process' },
      { key: 'b', score: 1, text: 'I usually handle it personally when I get a chance' },
      { key: 'c', score: 2, text: "Someone follows up, but there's no system tracking it" },
      { key: 'd', score: 3, text: 'Every lead goes into a system with assigned follow-up steps' },
    ],
  },
  {
    id: 'q5',
    dimension: 'lead_leakage',
    text: 'How well do you know your lead numbers (how many came in last month, how many converted)?',
    options: [
      { key: 'a', score: 0, text: "I don't track that" },
      { key: 'b', score: 1, text: "I could guess, but I don't have real numbers" },
      { key: 'c', score: 2, text: 'I have a rough idea but nothing centralized' },
      { key: 'd', score: 3, text: 'I can pull up our numbers and close rate anytime' },
    ],
  },
  {
    id: 'q6',
    dimension: 'lead_leakage',
    text: "What happens to a lead that doesn't buy right away?",
    options: [
      { key: 'a', score: 0, text: 'We probably lose track of them' },
      { key: 'b', score: 1, text: "I might follow up if I remember, but there's no system" },
      { key: 'c', score: 2, text: "We try to follow up, but it's inconsistent" },
      {
        key: 'd',
        score: 3,
        text: 'They go into a nurture sequence — we stay in touch automatically',
      },
    ],
  },

  // --- Financial Blindness ---
  {
    id: 'q7',
    dimension: 'financial_blindness',
    text: 'How current are your books right now?',
    options: [
      {
        key: 'a',
        score: 0,
        text: "I'm not sure — my bookkeeper/accountant handles it and I don't check often",
      },
      { key: 'b', score: 1, text: "They're a few months behind, but I check the bank account" },
      { key: 'c', score: 2, text: 'Mostly current — within a couple of weeks' },
      { key: 'd', score: 3, text: 'Up to date — I can see where we stand anytime' },
    ],
  },
  {
    id: 'q8',
    dimension: 'financial_blindness',
    text: 'When you price a job or project, how do you decide what to charge?',
    options: [
      { key: 'a', score: 0, text: 'Gut feel based on experience' },
      {
        key: 'b',
        score: 1,
        text: "I know my rough costs and add a margin, but I don't track if I was right",
      },
      {
        key: 'c',
        score: 2,
        text: "I have a pricing framework, but I don't always go back and check profitability",
      },
      {
        key: 'd',
        score: 3,
        text: 'I price based on real cost data and review margins after each job',
      },
    ],
  },
  {
    id: 'q9',
    dimension: 'financial_blindness',
    text: 'How well do you know which services or jobs are most profitable?',
    options: [
      { key: 'a', score: 0, text: 'Not really — revenue comes in and bills go out' },
      { key: 'b', score: 1, text: "I have a sense, but I've never run the numbers" },
      { key: 'c', score: 2, text: 'I know broadly, but the details are fuzzy' },
      { key: 'd', score: 3, text: 'I track profitability by service or job type' },
    ],
  },

  // --- Scheduling Chaos ---
  {
    id: 'q10',
    dimension: 'scheduling_chaos',
    text: 'How do you schedule jobs, appointments, or shifts?',
    options: [
      { key: 'a', score: 0, text: "Phone calls, texts, maybe a whiteboard — it's manual" },
      {
        key: 'b',
        score: 1,
        text: "I use a calendar, but it's just mine — the team checks with me",
      },
      { key: 'c', score: 2, text: "We have a shared calendar, but people don't always update it" },
      { key: 'd', score: 3, text: 'We use a scheduling tool that the team and customers can see' },
    ],
  },
  {
    id: 'q11',
    dimension: 'scheduling_chaos',
    text: 'How often do scheduling conflicts (double-bookings, missed appointments, wrong times) happen?',
    options: [
      { key: 'a', score: 0, text: "More than I'd like to admit — at least weekly" },
      { key: 'b', score: 1, text: 'It happens a few times a month' },
      { key: 'c', score: 2, text: 'Occasionally, but we usually catch it' },
      { key: 'd', score: 3, text: 'Rarely — the system prevents most of it' },
    ],
  },
  {
    id: 'q12',
    dimension: 'scheduling_chaos',
    text: 'When a schedule changes (cancellation, delay, reschedule), how does everyone find out?',
    options: [
      { key: 'a', score: 0, text: 'Whoever knows calls or texts whoever needs to know' },
      { key: 'b', score: 1, text: 'I usually handle the communication myself' },
      { key: 'c', score: 2, text: 'We update the calendar, but sometimes people miss it' },
      { key: 'd', score: 3, text: 'Changes sync automatically and notify the right people' },
    ],
  },

  // --- Manual Communication ---
  {
    id: 'q13',
    dimension: 'manual_communication',
    text: 'How do appointment reminders, confirmations, or follow-ups go out to customers?',
    options: [
      { key: 'a', score: 0, text: "They don't, really — customers are expected to remember" },
      { key: 'b', score: 1, text: 'I or someone on the team manually texts or calls each one' },
      { key: 'c', score: 2, text: "We send them, but it's a manual process each time" },
      { key: 'd', score: 3, text: 'They go out automatically — we set it up once and it runs' },
    ],
  },
  {
    id: 'q14',
    dimension: 'manual_communication',
    text: 'When a job is done, how does the customer get their invoice?',
    options: [
      { key: 'a', score: 0, text: 'When I get around to it — sometimes it takes a while' },
      { key: 'b', score: 1, text: 'I manually create and send each one' },
      {
        key: 'c',
        score: 2,
        text: 'We have a process, but it depends on me or one person to do it',
      },
      {
        key: 'd',
        score: 3,
        text: 'Invoices generate and send automatically when the job is marked complete',
      },
    ],
  },
  {
    id: 'q15',
    dimension: 'manual_communication',
    text: "How easy is it for your team to pull up a past customer's full history?",
    options: [
      { key: 'a', score: 0, text: "We'd have to piece it together from texts, emails, and memory" },
      { key: 'b', score: 1, text: 'I could probably find it, but nobody else could' },
      { key: 'c', score: 2, text: "We have records, but they're in different places" },
      {
        key: 'd',
        score: 3,
        text: 'Full history is in one place anyone on the team can access',
      },
    ],
  },

  // --- Employee Retention ---
  {
    id: 'q16',
    dimension: 'employee_retention',
    text: 'How do you know what your team accomplished today?',
    options: [
      { key: 'a', score: 0, text: "I don't, unless I was there watching or they told me" },
      {
        key: 'b',
        score: 1,
        text: 'I check in with people individually — calls, texts, end-of-day chat',
      },
      { key: 'c', score: 2, text: "We have a loose check-in process, but it's not consistent" },
      {
        key: 'd',
        score: 3,
        text: 'We use a system where everyone logs their work — I can check anytime',
      },
    ],
  },
  {
    id: 'q17',
    dimension: 'employee_retention',
    text: 'When you onboard a new hire, how do they learn the job?',
    options: [
      { key: 'a', score: 0, text: 'They shadow someone and figure it out — trial by fire' },
      {
        key: 'b',
        score: 1,
        text: 'I personally train them, which takes me away from everything else',
      },
      { key: 'c', score: 2, text: "We have some training materials, but it's mostly hands-on" },
      {
        key: 'd',
        score: 3,
        text: "There's a structured onboarding process with documentation they follow",
      },
    ],
  },
  {
    id: 'q18',
    dimension: 'employee_retention',
    text: "How do you handle it when someone on the team isn't performing?",
    options: [
      {
        key: 'a',
        score: 0,
        text: "I usually don't notice until something breaks or a customer complains",
      },
      {
        key: 'b',
        score: 1,
        text: "I address it when I see it, but there's no regular feedback process",
      },
      { key: 'c', score: 2, text: 'We do occasional check-ins, but nothing formal' },
      {
        key: 'd',
        score: 3,
        text: 'We have clear expectations and regular reviews — issues surface early',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Scoring constants (embedded in page JSON for client-side use)
// ---------------------------------------------------------------------------

/** Raw dimension score (0-9) → scaled display score (0-100) */
export const SCALED_SCORES = [0, 11, 22, 33, 44, 56, 67, 78, 89, 100] as const

export type ScoreLabel = 'needs_attention' | 'room_to_grow' | 'getting_there' | 'strong'

export interface ScoreThreshold {
  min: number
  max: number
  label: ScoreLabel
  displayLabel: string
  color: string
}

export const SCORE_THRESHOLDS: ScoreThreshold[] = [
  { min: 0, max: 22, label: 'needs_attention', displayLabel: 'Needs attention', color: '#dc2626' },
  { min: 23, max: 44, label: 'room_to_grow', displayLabel: 'Room to grow', color: '#d97706' },
  { min: 45, max: 67, label: 'getting_there', displayLabel: 'Getting there', color: '#2563eb' },
  { min: 68, max: 100, label: 'strong', displayLabel: 'Strong', color: '#16a34a' },
]

/** Total number of steps: 3 context + 18 scored */
export const TOTAL_QUESTIONS = CONTEXT_QUESTIONS.length + QUESTIONS.length
