# Task Plan - 2026-03-06 Memdock Backend Integration for Synced Meeting Notes

## Problem Statement
HiNotes sync currently stores notes locally only. We need to integrate memdock as a notes storage + brain backend for meeting sync while keeping local markdown as resilient fallback when memdock is unavailable.

## Lightweight SDD
### Goal
Enable `meetings:sync` and USB-triggered auto-sync to use a typed storage adapter that can index/write via memdock with best-effort behavior and automatic local fallback.

### Interfaces
- `src/notesStorage.ts`
  - Provide concrete `MemdockNotesStorageAdapter` implementation for `saveMeeting`, `saveWhisper`, `isIndexed`, and index path reporting.
  - Keep `LocalMeetingStorageAdapter` as source-of-truth fallback path.
  - Add typed memdock config, including endpoint/auth/path options.
- `src/cli/meetingsSync.ts`
  - Parse memdock backend/config from env + CLI flags.
  - Construct storage adapter once and pass into workflow.
- `src/cli/usbWatch.ts`
  - Keep auto-sync pipeline calling `runMeetingsSync`, so memdock path is used transparently when configured.
- `README.md`
  - Document backend selection and explicit memdock env/CLI setup.

### Constraints
- Minimal-impact change: no broad refactor beyond storage adapter wiring.
- No hardcoded secrets.
- Local markdown storage must remain available and automatically used on memdock failures.
- Keep existing CLI behavior and test suite stable.

### Failure Modes
- **Memdock unreachable/timeout/5xx**: log warning and fallback to local adapter.
- **Memdock returns malformed payload**: treat as failure and fallback to local adapter.
- **Invalid backend/env values**: fail fast with clear parse error.
- **Auto-sync runs while memdock flaps**: each operation still succeeds via fallback; sync continues.
- **Index check API failure**: fallback to local index check to avoid duplicate writes.

### Rollback Plan
1. Revert memdock-specific adapter logic and CLI options.
2. Force backend to `local` in `meetings:sync` path.
3. Keep sync pipeline and state logic unchanged.
4. Re-run tests (`npm test`, `npm run build`) to verify baseline.

## Implementation Checklist
- [x] Review existing storage/sync wiring and confirm integration gaps.
- [x] Finalize memdock adapter implementation in `src/notesStorage.ts` (replace TODO behavior fully).
- [x] Add/adjust memdock config fields for endpoint/auth/path via env + CLI.
- [x] Ensure meetings sync + USB watch auto-sync flow writes/indexes through adapter.
- [x] Add unit tests for memdock adapter behavior and CLI/env parsing.
- [x] Update README with memdock setup/run instructions.
- [x] Update `devlog-20260306.md` and `tasks/lessons.md`.
- [x] Run required verification (`npm test`, `npm run build`).
- [ ] Commit with clear message and push current branch.

## Acceptance Criteria
- `src/notesStorage.ts` contains a real memdock adapter (no placeholder TODO behavior).
- Backend can be selected via config (`local|memdock`) without hardcoded secrets.
- Memdock endpoint/auth/path are configurable by env/CLI and documented.
- `meetings:sync` and USB auto-sync use storage adapter path.
- If memdock fails/unavailable, notes still persist locally and sync does not crash.
- Tests cover memdock adapter + arg/config parsing.
- Required commands succeed: `npm test`, `npm run build`.

## Verification Checklist
- [x] `npm test`
- [x] `npm run build`
- [x] Targeted checks for memdock fallback, request shape, and parsing behavior
- [x] Confirm docs updated for operator setup

## Final Review (to fill after implementation)
- Tests run:
  - `npm test`
  - `npm run build`
- Outcomes:
  - `npm test`: pass (11 files / 43 tests)
  - `npm run build`: pass
- Known limitations:
  - Direct clone/read of upstream `https://github.com/seanslab-org/memdock` could not be performed in this environment due blocked outbound DNS/network. Adapter behavior was implemented and validated locally with request/fallback tests.
