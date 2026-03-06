# Task Plan - 2026-03-06 HiNotes → HiDockSkill Naming Cleanup

## Problem Statement
There are still legacy `HiNotes`/`HiNotesSkill` strings in docs, package metadata, and user-facing copy. We need a minimal-impact cleanup to align project naming to **HiDockSkill** without breaking runtime compatibility (especially existing command/skill IDs that still rely on `hinotes`).

## Lightweight SDD
### Scope
- Rename remaining user-facing/docs metadata strings from `HiNotes`/`HiNotesSkill` to `HiDockSkill` where safe.
- Keep compatibility-sensitive identifiers unchanged unless clearly safe.

### Interfaces / Surfaces
- Docs: `README.md`, `docs/SDD-HiDockSkill.md`, devlogs.
- Metadata: `package.json`, `package-lock.json` package name fields.
- User messages: `list-files-user.js` troubleshooting text.
- Process docs: `tasks/lessons.md`, `devlog-20260306.md`.

### Constraints
- Minimal-impact edits only (no functional refactor).
- Do not rename runtime command IDs / env keys unless safe.
- Preserve compatibility with existing OpenClaw skill install path `skills/hinotes` and `hinotes` command references where they may be operational.

### Failure Modes
- Over-renaming compatibility IDs could break existing workflows.
- Missing stale strings could leave inconsistent branding/docs.

### Rollback Plan
1. Revert commit containing naming cleanup.
2. Re-run verification (`npm test`, `npm run build`).
3. Restore prior docs/package naming if compatibility issues appear.

## Implementation Checklist
- [x] Inventory all remaining `HiNotes`/`HiNotesSkill` strings.
- [x] Update safe docs/user-facing strings to `HiDockSkill`.
- [x] Update package metadata naming fields consistently (`package.json`, lock file).
- [x] Keep explicit compatibility strings where necessary and document them.
- [x] Update devlog and lessons learned with this correction cycle.
- [x] Run verification (`npm test`, `npm run build`).
- [ ] Commit and push to `origin/master`.

## Acceptance Criteria
- No unintended `HiNotesSkill` branding remains in user-facing docs/metadata.
- Runtime behavior is unchanged (tests/build pass).
- Compatibility-sensitive `hinotes` identifiers are intentionally retained and documented.

## Verification Checklist
- [x] `npm test`
- [x] `npm run build`

## Final Review (to fill after implementation)
- Tests run:
  - `npm test`
  - `npm run build`
- Outcomes:
  - `npm test`: pass (11 files / 43 tests)
  - `npm run build`: pass
- Known limitations:
  - Intentionally retained compatibility identifiers: lowercase `hinotes` command/path/env conventions (e.g., `hinotes index verify`, `skills/hinotes`, memdock default collection/test fixtures) remain unchanged to avoid breaking existing automation/state.
