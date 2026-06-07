/**
 * Public surface of the assessment-eval harness.
 *
 * Re-exports the pure / testable pieces. llm.ts is deliberately NOT exported
 * here: it is the only module that imports src/lib/llm/models.ts, and it is
 * wired solely by cli.ts. Keeping it out of this barrel means the unit test
 * (which imports from here) never pulls network code into its graph.
 */

export * from './types.js'
export * from './conversation.js'
export * from './fixtures/loader.js'
export * from './interviewer.js'
export * from './owner.js'
export * from './run-writer.js'
