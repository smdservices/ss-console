/**
 * Operations Health Scorecard — Scoring logic.
 *
 * Pure functions with no side effects. Imported by the API endpoint
 * for canonical scoring. Client-side scoring reads the constants from
 * embedded JSON and implements the same summation + lookup mechanically.
 *
 * @see docs/design/operations-health-scorecard.md — Section 4
 */

import {
  DIMENSIONS,
  QUESTIONS,
  SCALED_SCORES,
  SCORE_THRESHOLDS,
  type DimensionId,
  type ScoreLabel,
  type ScoreThreshold,
} from './questions.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DimensionScore {
  id: DimensionId
  label: string
  raw: number
  scaled: number
  scoreLabel: ScoreLabel
  displayLabel: string
  color: string
}

export interface ScorecardScores {
  dimensions: DimensionScore[]
  overall: number
  overallLabel: ScoreLabel
  overallDisplayLabel: string
  overallColor: string
  topProblems: DimensionId[]
}

// ---------------------------------------------------------------------------
// Threshold lookup
// ---------------------------------------------------------------------------

export function getThreshold(scaled: number): ScoreThreshold {
  for (const t of SCORE_THRESHOLDS) {
    if (scaled >= t.min && scaled <= t.max) return t
  }
  return SCORE_THRESHOLDS[0]
}

// ---------------------------------------------------------------------------
// Dimension scoring
// ---------------------------------------------------------------------------

export function computeDimensionScores(answers: Record<string, number>): DimensionScore[] {
  return DIMENSIONS.map((dim) => {
    const dimQuestions = QUESTIONS.filter((q) => q.dimension === dim.id)
    const raw = dimQuestions.reduce((sum, q) => sum + (answers[q.id] ?? 0), 0)
    const scaled = SCALED_SCORES[raw] ?? 0
    const threshold = getThreshold(scaled)

    return {
      id: dim.id,
      label: dim.label,
      raw,
      scaled,
      scoreLabel: threshold.label,
      displayLabel: threshold.displayLabel,
      color: threshold.color,
    }
  })
}

// ---------------------------------------------------------------------------
// Overall score
// ---------------------------------------------------------------------------

export function computeOverallScore(dimensions: DimensionScore[]): number {
  if (dimensions.length === 0) return 0
  const sum = dimensions.reduce((total, d) => total + d.scaled, 0)
  return Math.round(sum / dimensions.length)
}

// ---------------------------------------------------------------------------
// Top problems
// ---------------------------------------------------------------------------

export function identifyTopProblems(dimensions: DimensionScore[]): DimensionId[] {
  return [...dimensions]
    .sort((a, b) => a.scaled - b.scaled)
    .filter((d) => d.scoreLabel !== 'strong')
    .slice(0, 3)
    .map((d) => d.id)
}

// ---------------------------------------------------------------------------
// Full scorecard computation
// ---------------------------------------------------------------------------

export function computeScores(answers: Record<string, number>): ScorecardScores {
  const dimensions = computeDimensionScores(answers)
  const overall = computeOverallScore(dimensions)
  const overallThreshold = getThreshold(overall)
  const topProblems = identifyTopProblems(dimensions)

  return {
    dimensions,
    overall,
    overallLabel: overallThreshold.label,
    overallDisplayLabel: overallThreshold.displayLabel,
    overallColor: overallThreshold.color,
    topProblems,
  }
}

// ---------------------------------------------------------------------------
// Pain score (for entity pipeline — inverted health score)
// ---------------------------------------------------------------------------

export function computePainScore(healthScore: number): number {
  if (healthScore <= 22) return 10
  if (healthScore <= 44) return 8
  if (healthScore <= 66) return 6
  if (healthScore <= 88) return 4
  return 2
}

// ---------------------------------------------------------------------------
// Auto-stage (pain 7+ → prospect, else signal)
// ---------------------------------------------------------------------------

export function computeAutoStage(painScore: number): 'signal' | 'prospect' {
  return painScore >= 7 ? 'prospect' : 'signal'
}

// ---------------------------------------------------------------------------
// Employee range → midpoint (for entity employee_count)
// ---------------------------------------------------------------------------

export function parseEmployeeCount(range: string): number | null {
  const map: Record<string, number> = {
    '1-5': 3,
    '6-10': 8,
    '11-25': 18,
    '26-50': 38,
    '50+': 75,
  }
  return map[range] ?? null
}
