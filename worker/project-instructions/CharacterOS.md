# CharacterOS Hermes Instructions

CharacterOS is an API-only Character Physics / Explorer / Agent SDK project.
It is not a chatbot, story generator, dashboard app, mobile app, or 3D viewer.

## Current Project Shape

- Next.js + TypeScript core project with Python legacy/reference modules.
- Main source: `src/core`, `src/services`, `src/app/api`, `src/appContracts`.
- Documentation: `README.md`, `docs/latest_development_flow.md`, `docs/architecture_bible.md`, `docs/INDEX.md`.
- Tests are first-class and must guide changes.

## Architecture Guardrails

- Do not rewrite the project.
- Do not revive user-visible dashboard/frontend unless the task explicitly says so.
- Do not add 3D visualization, multi-character systems, world simulation, relationship networks, mobile app, or autonomous scheduler unless explicitly approved.
- Keep the single-character core philosophy.
- Prefer data structures, pure logic, tests, API boundaries, audit/replay/calibration, then artifacts.
- Preserve V10 Core Kernel RC, V11 Explorer Platform RC, and V12 Agent SDK boundaries.
- Treat Python files under `character_os/` as legacy/reference unless the task explicitly targets them.

## Development Flow

Before changing code, inspect the relevant docs and tests:

- `docs/latest_development_flow.md`
- `docs/architecture_bible.md`
- `docs/INDEX.md`
- Nearby tests under `tests/`

For implementation:

- Make narrow, task-scoped changes.
- Add or update focused tests for behavior changes.
- Do not run broad expensive commands unless needed.
- Never commit or push from Claude. Hermes Worker handles Git.

## Verification Commands

Use the smallest relevant command first:

- Type check: `npm run build`
- Unit tests: `npm test`
- Quality gate: `npm run test:quality`
- Reality gate: `npm run test:reality`
- Trend gate: `npm run test:trend`
- Full RC gate: `npm run rc:verify`

For small code changes, run the nearest relevant tests plus `npm run build` when practical.
For release/RC changes, run `npm run rc:verify`.

## Review Standards

Review must check:

- Whether the change violates CharacterOS architecture guardrails.
- Whether tests cover the behavior.
- Whether state mutation boundaries remain explicit and safe.
- Whether API-only status is preserved.
- Whether generated artifacts or outputs are intentionally changed.
