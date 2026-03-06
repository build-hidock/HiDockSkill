# Executive Summary
HiDockSkill reliably pulls recordings from HiDock devices, transcribes them with OpenAI Whisper, and produces Markdown meeting notes. Usage revealed friction around throughput, resiliency, and extensibility. This SDD proposes a staged upgrade that keeps OpenAI as the summary provider (per product rule) while creating a clean abstraction so Claude or other providers can be added later without touching the storage or CLI layers. The design also introduces resumable/parallel processing, structured metadata, richer CLI ergonomics, and an expanded test/telemetry surface so we can treat HiDockSkill like a production pipeline instead of a single-run script.

## Problem & Goals
**Goals**
- Support clean provider/workflow boundaries so summaries continue using OpenAI but future engines plug in safely.
- Improve throughput by allowing resumable runs, bounded parallelism, and progress state tracking.
- Replace brittle string-matched indexes with structured metadata that powers dedupe, queries, and health checks.
- Level up the CLI UX with richer filtering, resume flags, and better live feedback / error handling.
- Expand tests + telemetry so we can detect regressions early and understand performance envelopes.

**Non-Goals**
- Shipping a cloud service; everything remains local/offline-first.
- Building a GUI; focus stays on CLI + OpenClaw integration.
- Replacing OpenAI Whisper or summary model (OpenAI remains the active summary provider by requirement).

## Current Architecture
```
[ HiDock USB Device ]
        │
  USB/WebUSB transport (src/transport.ts + node-usb bindings)
        │
  HiDockClient (src/client.ts) ──> list/download recordings
        │
  MeetingWorkflow (src/meetingWorkflow.ts)
        │   ├─ Whisper transcription (OpenAI)
        │   └─ OpenAI chat summary (gpt-4o-mini)
        │
  MeetingStorage (src/meetingStorage.ts)
        │
  meeting-storage/{meetings,whispers}/ + CLI logger (src/cli/meetingsSync.ts)
```

## Proposed Architecture & Changes
### Provider/Workflow Abstraction
- **Description**: Introduce a `SummaryProvider` + `TranscriptionProvider` interface and a `WorkflowOrchestrator` that receives concrete providers via DI. OpenAI remains the default summary provider, but the interface allows alternative providers (e.g., Claude) for other tasks without touching business logic.
- **Rationale**: Decouples workflow steps, keeps OpenAI summaries per rule, and prevents future rewrites.
- **Implementation Plan**:
  1. Create `src/providers/summaryProvider.ts` + `src/providers/transcriptionProvider.ts` with shared DTOs.
  2. Wrap existing OpenAI summary logic inside `OpenAISummaryProvider` (hard-wire gpt-4o-mini by default).
  3. Update `HiDockMeetingWorkflow` to depend on provider interfaces rather than instantiating OpenAI directly.
  4. Surface provider selection in CLI/env (with OpenAI as enforced default for summaries).
- **Acceptance Criteria**: Unit tests cover provider swap; runtime still uses OpenAI for summaries; CLI reports which provider handled each phase.

### Resumable & Parallel Processing
- **Description**: Persist a lightweight "sync ledger" (JSON or SQLite) tracking file hashes, status, and last processed timestamps. Add bounded parallel workers (e.g., 2 concurrent downloads/transcribes) with resume-from-last-state ability.
- **Rationale**: Current serial loop is slow and brittle; failures require rerunning whole backlog.
- **Implementation Plan**:
  1. Introduce `sync-state.json` capturing `fileName`, `status`, `startedAt`, `completedAt`, `notePath`.
  2. Wrap `processRecording` calls in a worker pool (Promise.all with concurrency limit from flag/env).
  3. Add `--resume`, `--from <timestamp>`, `--state-file <path>` CLI flags.
  4. On crash, CLI reloads state and skips completed entries.
- **Acceptance Criteria**: Killing a run mid-way and relaunching with `--resume` only processes unfinished files; telemetry shows parallel downloads; tests cover ledger read/write.

### Storage & Index Revamp
- **Description**: Maintain structured metadata (YAML front matter + `storage/index.json`) containing unique IDs, timestamps, and hashes. Markdown output references this metadata rather than embedding full context in a single line.
- **Rationale**: String `includes` dedupe is fragile; structured metadata unlocks search/auditing and avoids collisions.
- **Implementation Plan**:
  1. Add `storage/index.json` (or `.ndjson`) storing `{sourceFileName, documentType, notePath, checksum}`.
  2. Meeting/Whisper Markdown files get YAML front matter (title, attendee, summary provider, transcript hash).
  3. Update `MeetingStorage` methods to read JSON index for dedupe and append new entries atomically.
  4. Provide `hinotes index verify` helper to re-sync metadata.
- **Acceptance Criteria**: Duplicate runs skip correctly even when file names are substrings; index verify passes; existing Markdown consumers still work.

### CLI & UX Enhancements
- **Description**: Enrich `meetings:sync` CLI with better progress, filtering, and dry-run insights.
- **Key additions**:
  - `--resume`, `--since <ISO>` and `--ids <file1,file2>` filters.
  - Structured progress bar (per file download %, transcription %, summary %).
  - Retry/backoff when USB read fails; automatic re-open on disconnect.
  - Colored status output and optional JSON logs for automation.
- **Acceptance Criteria**: CLI help reflects new options; failure mid-run surfaces actionable error + hints; user can run `--dry-run --json` to inspect plan without touching device.

### Testing & Telemetry
- **Description**: Expand automated coverage and collect local metrics for build confidence.
- **Implementation Plan**:
  1. Add integration tests with mocked WebUSB to simulate frame streams + partial transfers.
  2. Snapshot tests for Markdown/YAML output plus CLI smoke test via `vitest` + `execa`.
  3. Add optional `HINOTES_METRICS_FILE` env; workflow logs durations (download_ms, whisper_ms, summary_ms) to NDJSON.
  4. Wire GitHub Actions (Node LTS) running lint, typecheck, tests.
- **Acceptance Criteria**: CI green; metrics file contains entries per recording when env set; coverage includes provider interfaces.

## Data & API Impacts
- **Metadata**: Introduce `storage/index.json` (or `.ndjson`) with schema `{id, sourceFileName, documentType, checksum, provider, createdAt, notePath}`. Markdown files receive YAML front matter mirroring these fields.
- **Environment variables**:
  - `HINOTES_STATE_PATH` (optional override for resume ledger).
  - `HINOTES_MAX_CONCURRENCY` (default 2) controlling workers.
  - `HINOTES_SUMMARY_PROVIDER=openai` enforced by default; CLI rejects other values unless explicitly allowed in config.
  - `HINOTES_METRICS_FILE` for telemetry.
- **CLI flags**: `--resume`, `--since`, `--ids`, `--state-file`, `--max-concurrency`, `--json-log`, `--metrics-file`.
- **Backward compatibility**: Existing envs (`OPENAI_API_KEY`, `WHISPER_MODEL`, `SUMMARY_MODEL`) continue to work; summary model is still OpenAI but can be overridden with another OpenAI model ID.

## Risks & Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Added state files increase corruption surface | Resume ledger/index could get out of sync | Write atomically + provide `hinotes index verify` fixer |
| Parallelism might overwhelm HiDock bandwidth | Transfers could fail more often | Default to low concurrency (2) and expose flag; auto backoff on USB stalls |
| Provider abstraction adds complexity | Longer learning curve | Keep OpenAI default hard-coded + thorough docs/tests |
| YAML front matter breaks downstream tooling | Existing scripts expect previous format | Keep Markdown body identical; front matter is additive and documented |

## Milestones & Validation Plan
| Milestone | Description | Owner | ETA | Validation |
| --- | --- | --- | --- | --- |
| M1 – Provider abstraction | Introduce provider interfaces, refactor workflow to use OpenAI provider | Sean + seansclaw | Mar 3 | Unit tests + manual regression run on sample device |
| M2 – Resume + concurrency | Implement ledger, resume flags, limited worker pool | seansclaw | Mar 7 | Kill a run mid-sync, resume successfully; verify ledger file |
| M3 – Storage/index revamp | YAML front matter + structured index + verify tool | Sean | Mar 11 | Run `hinotes index verify`, ensure dedupe works on sample data |
| M4 – CLI/UX + telemetry | New flags, progress UI, metrics logging | seansclaw | Mar 14 | CLI help screenshot, dry-run JSON diff, metrics file captured |
| M5 – Testing & CI | Add integration tests + GitHub Actions workflow | Sean | Mar 17 | CI badge green, coverage report includes new modules |

---
This plan preserves OpenAI for meeting summaries as required today, while giving us the modularity to plug in future providers (e.g., Claude for engineering helpers) without reshaping the workflow or storage foundations.
