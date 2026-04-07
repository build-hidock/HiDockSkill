# Speaker Enrollment — Plan (DRAFT, awaiting decisions)

**Status:** Planned, not started. Open questions below — implementation paused until answered.
**Created:** 2026-04-07
**Updated:** 2026-04-07 — revised after switching default ASR to Moonshine
**Source todo item:** `tasks/todo.md` → "Speaker enrollment with pyannote embeddings"

## Major change since first draft: ASR is now Moonshine, not Dicow/Whisper

The default ASR backend was switched from `dicow_transcribe.py` to `moonshine_transcribe.py`
on 2026-04-07. This changes the embedding-source picture significantly:

- The Moonshine pipeline does **not** expose speaker embeddings. Its diarization is
  internal to the C library — `speaker_index` is what comes out, but no vector behind it.
- `moonshine_voice` does ship `get_embedding_model()` / `embeddinggemma-300m`, but **that
  is a text-embedding model for `IntentRecognizer`, NOT a speaker embedding model**. My
  earlier note that we could "use moonshine_voice's embedding model" was wrong.
- The `dicow_transcribe.py` fallback is still in the tree (`ASR_BACKEND=dicow`) and still
  uses ECAPA-TDNN at `scripts/dicow_transcribe.py:167-194`. So the embeddings are still
  available — we just have to either (a) require the dicow backend for enrollment, or
  (b) run a parallel ECAPA-TDNN pass alongside Moonshine ASR.

## Key reframing — still no pyannote required

For the **enrollment side** specifically, we have two viable paths:

### Path A — Parallel ECAPA-TDNN pass (works with default Moonshine backend)
- Reuse the existing `_extract_embeddings()` from `dicow_transcribe.py` as a shared utility.
- During enrollment AND during transcription, run ECAPA-TDNN on the audio in parallel
  with Moonshine ASR.
- For matching: take ECAPA centroid per Moonshine cluster (need to align ECAPA window
  with Moonshine's `start_time`/`duration` fields), compare against enrolled profiles.
- **Pros:** works with the default backend, no user reconfiguration needed.
- **Cons:** keeps SpeechBrain dep alive, doubles audio processing (Moonshine VAD + ECAPA).

### Path B — Enrollment requires `ASR_BACKEND=dicow`
- Enrollment is only available when the user opts into the Whisper/ECAPA pipeline.
- Document this as a tradeoff: stable speaker identity ↔ Moonshine speed/size.
- **Pros:** simplest, zero cost when enrollment is unused.
- **Cons:** asks the user to pick between two desirable features.

**Recommendation:** **Path A** — the SpeechBrain dep is small (~50MB) and the ECAPA pass
adds negligible time vs Moonshine ASR (most of the wall time is the LLM summary anyway).
The user gets stable identities without giving up Moonshine.

## Existing TS surface to extend

`src/transcribe.ts:34-44` already has stub interfaces from the original devlog:

```ts
export interface SpeakerProfile {
  name: string;
  enrolledAt: string;
  // TO ADD:
  // embedding: number[];   // 192-dim ECAPA-TDNN centroid
  // sampleCount: number;   // for count-weighted re-enrollment
}

export interface SpeakerEnrollmentConfig {
  profilesPath?: string;
  enabled?: boolean;
  // TO ADD:
  // matchThreshold?: number;  // cosine similarity, default 0.70
}
```

## Proposed pipeline

1. **Profile store** — JSON at `~/.hidock/speaker_profiles.json` (location TBD — see Q2):
   ```json
   {
     "profiles": [
       {
         "name": "Sean Song",
         "embedding": [/* 192 floats */],
         "sampleCount": 3,
         "enrolledAt": "2026-04-07T..."
       }
     ]
   }
   ```

2. **Enrollment** — extend `scripts/dicow_transcribe.py` with an `--enroll <name>` flag:
   - Input: a wav/mp3 clip of the speaker.
   - Run VAD → extract ECAPA embedding(s) on speech segments → average → append/merge
     into the JSON store.
   - Idempotent: enrolling the same name again merges via count-weighted average.

3. **Matching during transcription**:
   - After clustering produces N speakers, compute each cluster's centroid embedding.
   - Cosine-compare each centroid against every enrolled profile.
   - If best match ≥ threshold (default `0.70`), attach the enrolled name to that
     cluster.
   - Unmatched clusters keep `Speaker N` and still flow through the existing heuristic
     + LLM name resolution chain. **Enrollment is additive, not replacing** the
     existing chain.

4. **JSON output** — emit `enrolled_name` (and optionally `match_confidence`) per
   segment when matched, so `parseMoonshineOutput()` in `src/transcribe.ts` can apply
   the name without an LLM round-trip.

5. **Display payoff** — combined with the speaker color work just landed
   (`src/galaxyHtml.ts:730-2105`), an enrolled match becomes a stable identity. The
   same person across multiple meetings gets the same display name *and* the same
   palette color (palette is keyed on the rendered name).

## Implementation steps (after answers)

1. Add `--enroll <name>` mode + threshold matching to `scripts/dicow_transcribe.py`.
2. Extend `SpeakerProfile` / `SpeakerEnrollmentConfig` in `src/transcribe.ts` with
   the embedding + sampleCount fields and a small profile-store loader.
3. Add `cli/enrollSpeaker.ts` entry + `npm run enroll` script.
4. Unit tests for the matching logic:
   - Cosine similarity on known vectors.
   - Threshold accept/reject.
   - Multi-cluster collision (two clusters matching same identity → highest wins,
     others stay unlabeled — see Q6).
   - Count-weighted re-enrollment math.
5. E2E verification on `tests/jensen-Illya.mp3`:
   - Enroll Jensen from one segment of the file.
   - Re-run full transcription.
   - Confirm Jensen is named without going through the LLM resolution path.
6. Update `tasks/todo.md`, add devlog entry.

## OPEN QUESTIONS (need user decisions before implementation)

### Q1 — Enrollment surface
CLI only (`npm run enroll -- <name> <wav>`), Galaxy UI button ("This is X" on a
transcript line), or both?
- **Recommendation:** Start CLI-only. UI button can come later once the matching
  pipeline is validated end-to-end.
- **Decision:** _open_

### Q2 — Profile storage location
- `~/.hidock/speaker_profiles.json` (user-scoped, survives repo clones)
- Project-local `data/speakers.json`
- Inside the existing notes dir
- **Recommendation:** `~/.hidock/speaker_profiles.json`. Matches typical app-data
  convention; profiles are tied to the user, not the checkout.
- **Decision:** _open_

### Q3 — Match threshold
Fixed default vs environment-tunable?
- **Recommendation:** Env-tunable `SPEAKER_MATCH_THRESHOLD`, default `0.70`. Cosine
  on ECAPA-TDNN is fairly stable in that range; tunability lets us calibrate per
  recording quality without rebuilding.
- **Decision:** _open_

### Q4 — Backend coverage
Local diarizer only, or also wire enrollment into `pyannote` / `diarizen` backends?
- **Recommendation:** Local only for v1. Document that `DIARIZER=local` is required
  for enrollment. Pyannote support deferred until there's a clear ask.
- **Decision:** _open_

### Q5 — Multi-clip enrollment behavior
Single clip per enroll (overwrite) vs accumulate (re-enrolling averages with prior)?
- **Recommendation:** Accumulate via count-weighted average — calling enroll a
  second time for the same name materially improves accuracy from short clips and
  is the user-intuitive behavior.
- **Decision:** _open_

### Q6 — Multi-cluster collision
What if two clusters in the same recording both match the same enrolled name?
- **Recommendation:** Take the highest similarity, leave the other(s) unlabeled
  (fall through to `Speaker N` + heuristic/LLM). Prevents collapsing two people
  into one identity.
- **Decision:** _open_

## Notes

- This plan does **not** alter the existing speaker name resolution chain (summary
  SPEAKER_MAP → heuristic → dedicated LLM call). Enrollment slots in *before* that
  chain and only labels clusters where confidence is high.
- The 192-dim embedding stored per profile is small (~1.5 KB JSON-encoded),
  so the file stays trivial even with hundreds of enrolled speakers.
- Lesson 2026-03-19 applies: keep the rule-based path (enrollment match) ahead of
  LLM-based name resolution wherever possible.
