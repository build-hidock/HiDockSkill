# Task Plan — Speaker Diarization & Meeting Summary

## Completed (2026-03-19)

### Speaker Diarization Pipeline
- [x] Update `moonshine_transcribe.py` — JSON output with speaker segments
- [x] `SpeakerSegment` type, `parseMoonshineOutput()`, `formatSpeakerTranscript()` with timestamps
- [x] Speaker-aware LLM prompt with `SPEAKER_MAP`
- [x] `parseSpeakerMap()`, `applySpeakerNames()` (handles `@time` format)
- [x] Tests for all new functions (19 transcribe + 17 meetingWorkflow = 131 total)

### Speaker Name Resolution
- [x] Heuristic name extraction from transcript context (address patterns, self-introductions)
- [x] `parseSpeakerMapJson()` for JSON format from LLM
- [x] Dedicated `resolveSpeakerNames()` with hallucination filters
- [x] `sanitizeLlmOutput()` — strips Qwen special tokens
- [x] Fallback chain: summary SPEAKER_MAP → heuristic → dedicated LLM call

### Galaxy Dashboard UI
- [x] Two-column note modal (summary left, audio+transcript right)
- [x] Speaker labels as purple pill badges
- [x] Timestamps on each transcript line
- [x] Audio-transcript sync (timeupdate → highlight + auto-scroll)
- [x] Click-to-seek on transcript lines
- [x] User scroll priority (4s cooldown on manual scroll)
- [x] HTTP Range request support for audio seeking
- [x] Markdown summary rendering (headings, bullets, checkboxes)
- [x] Fix summary parsing regex for multi-section markdown

### Professional Summary Prompt
- [x] Replace simple format with comprehensive meeting assistant prompt
- [x] About Meeting, Meeting Outline, Overview, Todo List sections
- [x] Updated `/note` endpoint to capture full markdown between sections

### Scripts & Tooling
- [x] `scripts/ingest_local.mjs` — standalone local file ingestion
- [x] `scripts/transcribe_local_runner.mjs` — standalone transcription to markdown
- [x] `scripts/moonshine_transcribe.py` — JSON speaker segment output

### E2E Verification
- [x] steve.wav — 264 segments, 5 speakers, heuristic names (Speaker 1 = Steve)
- [x] jensen-Illya.mp3 — 96 segments, 2 speakers, LLM names (Ilya Sutskever, Jensen Huang)
- [x] Galaxy dashboard renders both with audio sync, speaker labels, markdown summary

## Completed (2026-04-07)

### Speaker Color Differentiation
- [x] 8-color palette (purple, cyan, amber, green, pink, blue, orange, lavender)
- [x] Stable per-speaker assignment by first appearance, keyed on rendered name
- [x] Same person across meetings → same color (palette is name-keyed)
- [x] Verified on Galaxy dashboard with multi-speaker notes

### ASR Switch: Whisper → Moonshine + Auto Language Detection
- [x] Default `ASR_BACKEND` flipped to `moonshine` (was `dicow`); `dicow` retained as fallback
- [x] Rewrote `scripts/moonshine_transcribe.py` with auto language detection via faster-whisper tiny
- [x] **Pinned to BASE model** (was defaulting to MEDIUM_STREAMING) — 8.8x faster
- [x] Per-language model selection — 8 languages supported (en, es, ar, ja, ko, vi, uk, zh)
- [x] `LANGUAGE_HINT` env override skips LID for known-language batches
- [x] Output JSON gains `detected_language` and `model_arch` fields
- [x] **Diarization fully preserved** — 96 segments / 2 speakers on jensen-Illya (matches 2026-03-19 milestone)
- [x] E2E perf on 5:07 audio: 14.8s wall (RTF ≈ 0.048, ~21x real-time) — matches asrbench Jetson numbers
- [x] All 262 tests pass

## Completed (2026-04-07 — afternoon)

### USB Multi-Device Picker + Device-File List in UI
- [x] Fix swapped product ID labels (P1 = 0xb00e, H1E = 0xb00d) in `nodeUsb.ts`
- [x] Add error logging to file-poll catch block (was silently swallowing LIBUSB errors)
- [x] New `enumerateHiDockBusDevices()` + `selectPreferredHiDock()` via `usb.getDeviceList()`
      (no cache) with deterministic preference order (P1 → H1E → H1 → unknown)
- [x] Env override `HIDOCK_PREFERRED_PRODUCT_ID` (decimal or hex) for explicit selection
- [x] 10 new unit tests for the picker (mocked `usb.getDeviceList`)
- [x] List view: device files with inline recorder badge (P1/H1E/H1) — design option B
- [x] Pending rows: empty title/brief, italic gray styling, "Pending" type, raw filename hint
- [x] `setDeviceFiles` server method: server enriches by matching `node.source === fileName`
- [x] File-poll decoupled from `runAutoSync` — device-file enrichment runs independently
- [x] Discovered + worked around production webusb hang via libusb device reset
      (`resetDeviceBeforeClaim` in `nodeUsb.ts`) — was causing infinite hangs after
      "Incomplete transfer" errors left H1E in a wedged kernel state
- [x] All 272 tests pass; verified end-to-end on live H1E (27 files, 20 transcribed, 7 pending)

## Completed (2026-04-08)

- [x] USB sync stability: scale `readLimit` by file size in `client.ts:collectCommandBytes`
      (root cause of every "Incomplete transfer" we'd been seeing — fixed truncation at 8-32 MB)
- [x] Sync state correctness: stop marking FAILED files as processed in `meetingsSync.ts`
      (caused today's recording to vanish from the candidate list after one truncated download)
- [x] Added README warning about HiNotes Web tabs taking exclusive WebUSB control
- [x] List view: per-row delete button (hover-only, hidden on pending rows)
- [x] List view: periodic /data.json poll so device files refresh without page reload
- [x] Click-to-rename speaker labels in note modal — bulk update across all matching badges,
      persists to disk via POST /note/speaker, color stays stable across renames

## Completed (2026-04-08)

### Speaker Rename Feature — full identity migration
- [x] Layered rename across the four storage locations: note transcript, note summary,
      meeting index row, wiki (people page rename or merge + cross-reference rewrite +
      master index regen + search index rebuild)
- [x] Single-instance vs bulk modes via `lineStart` parameter on the backend helper
- [x] Frontend modal-based mode selection (`Cancel · Just this line · All N lines`)
      shown only when matchCount > 1 — explicit user choice instead of failed heuristics
- [x] Color harmonization on rename: adopts target speaker's palette when merging,
      assigns fresh palette index when introducing a novel name in single-line mode
- [x] Per-row delete button on the list view (hover-only)
- [x] readLimit truncation fix for large file downloads (was capped at ~8-32 MB)
- [x] Sync state correctness: failed files are no longer marked as "processed"
- [x] All 307 tests pass; modal flow verified live on the running watcher

## Future Work
- [ ] Speaker enrollment (interface designed in `SpeakerProfile`/`SpeakerEnrollmentConfig`).
      Plan documented in `tasks/speaker-enrollment-plan.md` — needs update for moonshine-default world.
- [ ] Evaluate better model for structured output (qwen3.5:9b unreliable for format compliance)
- [ ] Surface `detected_language` in Galaxy UI (small badge on the note modal)
- [ ] Test multilingual Moonshine on a non-English recording (zh/ja/ko/etc.) — verify diarization
      works for non-English BASE models too
- [ ] Multi-device sync UI: add an in-app device picker so the user can pick which HiDock
      to sync from when multiple are connected (currently uses preference order or env var)
- [ ] Investigate why "Incomplete transfer for command=0x5" still happens on some files —
      the readLimit fix solved the most common cause but USB transfer reliability on huge
      files (>100 MB) is still a separate intermittent issue worth root-causing
- [ ] Click-to-sync on pending device-file rows (currently no-op; future: enqueue manual sync)
- [ ] Surface speaker rename response counts as a small toast (e.g. "✓ Renamed 47 lines · 4 wiki pages updated")
- [ ] Multi-device aware plug-in detection: track each connected HiDock by serial, fire a
      plug-in event for each NEW device (currently single-boolean — plugging P1 while H1E
      is already connected doesn't fire a fresh popup)
