# Task 7 Report

## Status

Implemented and verified.

## Changes

- Added `POST /api/codebases/$codebaseId/features` with authentication, `api_call` rate limiting, ownership checks, snapshot readiness checks, prompt validation, transactional feature-project insertion, and persisted Ask handoff.
- Added `buildFeatureProjectValues` and `resolveAnalysisFeaturePrompt`.
- Updated codebase analysis to read the persisted handoff state and prefer its raw feature prompt, with safe structural narrowing and project-name fallback.
- Updated `POST /api/projects` to accept an owned `codebaseId`, bind the project, skip the sync-session insert for that branch, and preserve the existing greenfield and CLI-sync branches.
- Regenerated `src/routeTree.gen.ts`.
- Added focused helper tests in `src/routes/api/codebases/-features.test.ts`.

## Verification

- RED test: missing feature route module, as expected.
- Focused tests: `48 passed` across the feature and analysis test files.
- Full Vitest: `116 files, 1048 tests passed`.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Touched-file Biome check passed.
- `pnpm generate-routes` passed.
- `pnpm build` passed.
- `git diff --check` reported no whitespace errors.

## Review Notes

- The feature project does not create a sync session of its own.
- The raw feature prompt is persisted in `codebaseAskHandoffs.state.prompt` before downstream analysis is expected to run.
- `CODEBASE_NOT_SYNCED` is returned with HTTP 400 when no `uploaded` or `ready` snapshot exists.
- The brief required changing `src/routes/api/projects/index.ts`; the current route did not accept `codebaseId`, so the guarded binding branch was added. Existing greenfield and existing-codebase sync behavior remains in place.

## Worktree Note

`TODO.md` and `playwright-report/index.html` had pre-existing unrelated changes and were not staged.
