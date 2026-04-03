/**
 * Operations Health Scorecard — Dimension descriptions per score range.
 *
 * Used by both the results page (client-side) and the PDF report.
 * Written in second person, non-judgmental tone per content standards.
 *
 * @see docs/design/operations-health-scorecard.md — Section 5
 */

import type { DimensionId, ScoreLabel } from './questions.js'

export const SCORE_DESCRIPTIONS: Record<DimensionId, Record<ScoreLabel, string>> = {
  owner_bottleneck: {
    needs_attention:
      "Most decisions and processes run through you. That's common at this stage, but it means the business can't move without you.",
    room_to_grow:
      "You're still the go-to for a lot of decisions. Documenting key processes would let your team move without waiting on you.",
    getting_there:
      'Your team handles most of the day-to-day, but a few critical areas still depend on you.',
    strong:
      "Your team operates independently. You've built processes that work without you in the loop.",
  },

  lead_leakage: {
    needs_attention:
      "Leads are coming in, but there's no system catching them. Some are definitely slipping through.",
    room_to_grow:
      "You're following up on leads, but it depends on memory or manual effort. A consistent system would close the gap.",
    getting_there:
      'You have a handle on most leads, but there are still gaps in tracking and follow-through.',
    strong:
      'Every lead is tracked and followed up on. You know your numbers and your pipeline is visible.',
  },

  financial_blindness: {
    needs_attention:
      "You're running the business without a clear picture of the numbers. That's more common than you'd think, but it's risky.",
    room_to_grow:
      'You have a general sense of the money, but the details are fuzzy. Getting current books and real margin data would change how you make decisions.',
    getting_there:
      'Your financials are reasonably current. Closing the gap on job-level profitability would give you sharper pricing.',
    strong: 'You know your numbers. You price from real data and can see where the money goes.',
  },

  scheduling_chaos: {
    needs_attention:
      'Scheduling is mostly manual, and conflicts happen regularly. A centralized solution would save hours every week.',
    room_to_grow:
      'You have some structure, but it still depends on one person or breaks down under volume.',
    getting_there: "Scheduling mostly works, but changes don't always reach everyone in time.",
    strong: "Your scheduling is solid. It's automated, visible, and the team stays in sync.",
  },

  manual_communication: {
    needs_attention:
      'Customer communication is manual and reactive. Reminders, follow-ups, and invoices depend on someone remembering to send them.',
    room_to_grow:
      'Messages go out, but each one is a manual effort. Automating the routine stuff would free up real time.',
    getting_there:
      'Some communication is automated, but there are still gaps where things depend on a person.',
    strong:
      "Routine communication runs on autopilot. Your team's time goes to conversations that actually need a human.",
  },

  employee_retention: {
    needs_attention:
      "You don't have a clear picture of what your team is doing day-to-day. Issues surface late, usually when something breaks.",
    room_to_grow:
      "You check in with people individually, but there's no system giving you the full picture.",
    getting_there:
      'You have some visibility, but onboarding and performance feedback are still informal.',
    strong:
      'You know what your team is doing, new hires get up to speed fast, and performance issues surface early.',
  },
}
