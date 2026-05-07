# AGENTS.md

Instructions for AI agents (Codex CLI) working in this repository.

## Repository

venturecrane/ss-console - SmartStack operator console (Astro + React, services portfolio).

## Automatic Session Start

When you begin a session, immediately do these in order before any work:

1. Call `crane_preflight` (no arguments) - validates environment.
2. Call `crane_sos` with `venture: "ss"` - initializes session, shows P0 issues, cadence briefing, active sessions.
3. Read `CLAUDE.md` at the repo root - canonical Instruction Modules table (coding standards, guardrails, secrets, tooling, PR workflow, etc.).
4. Fetch `crane_doc('global', 'coding-standards.md')` before editing any TypeScript or JavaScript.

Do not start any work until preflight + sos succeed and CLAUDE.md is loaded. If preflight fails, show the error and stop.

## Coding Standards

All code edits MUST follow the Venture Crane portfolio coding standard, fetched via `crane_doc('global', 'coding-standards.md')`. Key directives that apply on every change:

- Parse external inputs with Zod; never `as` cast at trust boundaries.
- No floating Promises; explicitly `await` or attach a `.catch`.
- No module-level state in Cloudflare Workers (per-isolate state leaks across requests).
- File/function ceilings: 500 lines/file, 75 lines/function, complexity 15, depth 4, params 5.
- No default exports outside framework-required positions (Astro pages, Next.js App Router files, Workers entry).
- Fetch the global doc for the full 12 directives with good/bad examples and per-stack notes.

Mechanical enforcement: ss-console's `eslint.config.js` inlines the portfolio rule set. `npm run lint` and CI fail on violations. The standard is also published as `@venturecrane/eslint-config` (GitHub Packages) but ss-console deliberately inlines rather than depending on the package; the eslint config header documents this choice.

## Enterprise Rules

- All changes go through PRs. Never push directly to main.
- Work only on issues assigned to the current venture context (ss).
- If you detect scope drift (working on a different repo than session context), stop and verify with the user.
- All GitHub issues created this session must target `venturecrane/ss-console`.
- When encountering errors, fix root causes - not symptoms.

## Codex Environment

Codex strips `KEY`/`SECRET`/`TOKEN` vars from all subprocess environments (shell commands and MCP servers). The `crane` launcher configures `shell_environment_policy.ignore_default_excludes` and MCP `env_vars` to whitelist the vars agents need.

## Reference

CLAUDE.md (loaded at session start per step 3 above) contains the full Instruction Modules table covering environment variables, QA grades, secrets management, git authority, and per-domain runbooks. Fetch any module on demand via `crane_doc('global', '<module>')`.
