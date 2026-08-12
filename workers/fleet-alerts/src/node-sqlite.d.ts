/**
 * Minimal ambient declaration for `node:sqlite`, used only by
 * `stale-holds.test.ts` to execute the real stale-holds SQL (ss#2316).
 *
 * Deliberately NOT `@types/node` in the tsconfig `types` array: this Worker
 * compiles against `@cloudflare/workers-types` alone, and pulling the Node
 * globals in would let a Node-only API into `src/` without tsc objecting. This
 * declares the four members the test touches and nothing else.
 */
declare module 'node:sqlite' {
  export class StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
