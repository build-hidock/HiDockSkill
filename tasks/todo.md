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

## Future Work
- [ ] Speaker enrollment with pyannote embeddings (interface designed in `SpeakerProfile`/`SpeakerEnrollmentConfig`)
- [ ] Evaluate better model for structured output (qwen3.5:9b unreliable for format compliance)
- [ ] Test with real HiDock device recordings via USB sync
- [ ] Add speaker color differentiation (assign unique colors per speaker)
