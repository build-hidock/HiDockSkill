#!/usr/bin/env python3
"""
Speaker-diarized transcription: local diarization + Whisper ASR.

Pipeline:
  1. Silero VAD — speech activity detection
  2. SpeechBrain ECAPA-TDNN — speaker embeddings (fully local, no token)
  3. Spectral clustering — assign speaker IDs
  4. faster-whisper large-v3-turbo — ASR with VAD (CPU int8)
  5. Time-overlap alignment — assign speaker IDs to ASR segments

Upgrade path: Replace with DiariZen (13.9% DER) or pyannote 4.0
when HF_TOKEN is available.

Usage: dicow_transcribe.py <wav_path> [language]
Output: JSON compatible with HiDockSkill transcribe.ts interface.

Environment:
  DIARIZER        — "local" (default), "pyannote", or "diarizen"
  WHISPER_MODEL   — faster-whisper model ID (default: "large-v3-turbo")
  HF_TOKEN        — HuggingFace token (only needed for pyannote/diarizen)
"""

import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: dicow_transcribe.py <wav_path> [language]", file=sys.stderr)
        sys.exit(1)

    wav_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else None

    # Step 1: Speaker diarization (also returns VAD speech segments)
    diar_segments: list[tuple[float, float, int]] = []
    try:
        sys.stderr.write("Diarizing...\n")
        diar_segments = diarize(wav_path)
        n_speakers = len(set(s[2] for s in diar_segments)) if diar_segments else 0
        sys.stderr.write(f"  {n_speakers} speakers, {len(diar_segments)} segments\n")
    except Exception as e:
        sys.stderr.write(f"  Diarization skipped: {e}\n")

    # Step 2: ASR — transcribe each diarization segment individually for accuracy
    sys.stderr.write("Transcribing...\n")
    if diar_segments:
        asr_segments = transcribe_by_segments(wav_path, diar_segments, language)
    else:
        asr_segments = transcribe_whisper(wav_path, language)
    sys.stderr.write(f"  {len(asr_segments)} ASR segments\n")

    # Step 3: Build aligned output (segments already have speaker IDs if diarized)
    if diar_segments:
        aligned = build_output(asr_segments)
    else:
        aligned = align(asr_segments, diar_segments)

    # Output JSON to stdout
    print(json.dumps(aligned, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Diarization
# ---------------------------------------------------------------------------

def diarize(wav_path: str) -> list[tuple[float, float, int]]:
    """Run speaker diarization. Returns [(start, end, speaker_idx), ...]."""
    backend = os.environ.get("DIARIZER", "local").lower()
    if backend == "pyannote":
        return _diarize_pyannote(wav_path)
    if backend == "diarizen":
        return _diarize_diarizen(wav_path)
    return _diarize_local(wav_path)


def _diarize_local(wav_path: str) -> list[tuple[float, float, int]]:
    """Fully local diarization: Silero VAD + SpeechBrain ECAPA-TDNN + clustering."""
    import numpy as np
    import torch
    import torchaudio

    sys.stderr.write("  Loading audio...\n")
    waveform, sr = torchaudio.load(wav_path)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000
    # Mono
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    audio = waveform.squeeze(0)

    # Step 1: VAD — find speech segments
    sys.stderr.write("  Running VAD...\n")
    speech_segments = _silero_vad(audio, sr)
    if not speech_segments:
        sys.stderr.write("  No speech detected\n")
        return []
    sys.stderr.write(f"  {len(speech_segments)} speech segments\n")

    # Merge very short gaps (< 0.5s) between segments
    speech_segments = _merge_segments(speech_segments, gap_threshold=0.5)

    # Step 2: Extract speaker embeddings for each segment
    sys.stderr.write("  Extracting speaker embeddings...\n")
    embeddings = _extract_embeddings(audio, sr, speech_segments)
    if len(embeddings) < 2:
        return [(s, e, 0) for s, e in speech_segments]

    # Step 3: Cluster embeddings
    sys.stderr.write("  Clustering speakers...\n")
    labels = _cluster_embeddings(embeddings)

    return [(s, e, int(lbl)) for (s, e), lbl in zip(speech_segments, labels)]


def _silero_vad(
    audio: "torch.Tensor", sr: int, threshold: float = 0.4
) -> list[tuple[float, float]]:
    """Run Silero VAD, return speech segments as [(start_sec, end_sec), ...]."""
    import torch

    model, utils = torch.hub.load(
        "snakers4/silero-vad", "silero_vad", trust_repo=True
    )
    get_speech_timestamps = utils[0]

    timestamps = get_speech_timestamps(
        audio, model, sampling_rate=sr, threshold=threshold,
        min_speech_duration_ms=250, min_silence_duration_ms=300,
    )

    return [(ts["start"] / sr, ts["end"] / sr) for ts in timestamps]


def _merge_segments(
    segments: list[tuple[float, float]], gap_threshold: float = 0.5
) -> list[tuple[float, float]]:
    """Merge segments separated by less than gap_threshold seconds."""
    if not segments:
        return segments
    merged = [segments[0]]
    for start, end in segments[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end < gap_threshold:
            merged[-1] = (prev_start, end)
        else:
            merged.append((start, end))
    return merged


def _extract_embeddings(
    audio: "torch.Tensor", sr: int, segments: list[tuple[float, float]]
) -> "np.ndarray":
    """Extract ECAPA-TDNN speaker embeddings for each segment."""
    import numpy as np
    from speechbrain.inference.speaker import EncoderClassifier

    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        run_opts={"device": "cpu"},
    )

    embeddings = []
    for start, end in segments:
        start_sample = int(start * sr)
        end_sample = int(end * sr)
        chunk = audio[start_sample:end_sample]

        # Skip very short chunks (< 0.3s)
        if len(chunk) < sr * 0.3:
            embeddings.append(np.zeros(192))
            continue

        # ECAPA-TDNN expects [batch, time] — 2D tensor
        emb = classifier.encode_batch(chunk.unsqueeze(0))
        embeddings.append(emb.squeeze().detach().numpy())

    return np.array(embeddings)


def _cluster_embeddings(embeddings: "np.ndarray", max_speakers: int = 8) -> "np.ndarray":
    """Cluster speaker embeddings using agglomerative clustering with auto num_speakers."""
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.metrics import silhouette_score
    import numpy as np

    n = len(embeddings)
    if n < 2:
        return np.zeros(n, dtype=int)

    # Normalize embeddings
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    embeddings = embeddings / norms

    # Try different numbers of clusters, pick best silhouette score
    best_labels = np.zeros(n, dtype=int)
    best_score = -1.0
    max_k = min(max_speakers, n)

    for k in range(2, max_k + 1):
        clustering = AgglomerativeClustering(
            n_clusters=k, metric="cosine", linkage="average"
        )
        labels = clustering.fit_predict(embeddings)

        if len(set(labels)) < 2:
            continue
        score = silhouette_score(embeddings, labels, metric="cosine")
        if score > best_score:
            best_score = score
            best_labels = labels

    # If silhouette is very low, likely 1 speaker
    if best_score < 0.15:
        return np.zeros(n, dtype=int)

    return best_labels


def _diarize_pyannote(wav_path: str) -> list[tuple[float, float, int]]:
    from pyannote.audio import Pipeline
    import torch

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        raise RuntimeError("HF_TOKEN required for pyannote. Set DIARIZER=local for token-free mode.")

    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    )

    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    try:
        pipeline.to(device)
    except Exception:
        pipeline.to(torch.device("cpu"))

    diarization = pipeline(wav_path)

    segments: list[tuple[float, float, int]] = []
    speaker_map: dict[str, int] = {}
    counter = 0
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        if speaker not in speaker_map:
            speaker_map[speaker] = counter
            counter += 1
        segments.append((turn.start, turn.end, speaker_map[speaker]))

    return segments


def _diarize_diarizen(wav_path: str) -> list[tuple[float, float, int]]:
    raise NotImplementedError(
        "DiariZen backend not yet configured. "
        "Install from https://github.com/BUTSpeechFIT/DiariZen"
    )


# ---------------------------------------------------------------------------
# ASR
# ---------------------------------------------------------------------------

def transcribe_by_segments(
    wav_path: str,
    diar_segments: list[tuple[float, float, int]],
    language: str | None = None,
) -> list[dict]:
    """Transcribe each diarization segment individually. Returns pre-labeled segments."""
    import numpy as np
    import torch
    import torchaudio
    from faster_whisper import WhisperModel
    import tempfile

    model_id = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
    model = WhisperModel(model_id, device="cpu", compute_type="int8")

    waveform, sr = torchaudio.load(wav_path)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    audio = waveform.squeeze(0).numpy()

    # Merge adjacent same-speaker segments for fewer Whisper calls
    merged = _merge_speaker_segments(diar_segments, gap_threshold=1.0)

    results = []
    for start, end, speaker_id in merged:
        start_sample = int(start * sr)
        end_sample = int(end * sr)
        chunk = audio[start_sample:end_sample]

        if len(chunk) < sr * 0.3:
            continue

        # Write chunk to temp file for faster-whisper
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        import soundfile as sf
        sf.write(tmp_path, chunk, sr)

        try:
            kwargs: dict = {"vad_filter": False, "word_timestamps": False}
            if language:
                kwargs["language"] = language
            segs, _ = model.transcribe(tmp_path, **kwargs)
            texts = []
            for seg in segs:
                t = seg.text.strip()
                if t:
                    texts.append(t)
            text = " ".join(texts)
            if text:
                results.append({
                    "text": text,
                    "speaker_index": speaker_id,
                    "has_speaker_id": True,
                    "start_time": start,
                    "duration": round(end - start, 3),
                })
        finally:
            os.unlink(tmp_path)

    return results


def _merge_speaker_segments(
    segments: list[tuple[float, float, int]], gap_threshold: float = 1.0
) -> list[tuple[float, float, int]]:
    """Merge adjacent segments from the same speaker."""
    if not segments:
        return segments
    merged = [segments[0]]
    for start, end, spk in segments[1:]:
        prev_start, prev_end, prev_spk = merged[-1]
        if spk == prev_spk and start - prev_end < gap_threshold:
            merged[-1] = (prev_start, end, spk)
        else:
            merged.append((start, end, spk))
    return merged


def transcribe_whisper(
    wav_path: str, language: str | None = None
) -> list[dict]:
    """Run faster-whisper with VAD (fallback when no diarization). Returns [{text, start, end}, ...]."""
    from faster_whisper import WhisperModel

    model_id = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
    model = WhisperModel(model_id, device="cpu", compute_type="int8")

    kwargs: dict = {"vad_filter": True, "word_timestamps": False}
    if language:
        kwargs["language"] = language

    segments_iter, _info = model.transcribe(wav_path, **kwargs)

    result = []
    for seg in segments_iter:
        text = seg.text.strip()
        if text:
            result.append({"text": text, "start": seg.start, "end": seg.end})

    return result


def build_output(segments: list[dict]) -> dict:
    """Build output from pre-labeled segments (from transcribe_by_segments)."""
    text_parts = [s["text"] for s in segments]
    return {
        "segments": segments,
        "text": " ".join(text_parts),
    }


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

def align(
    asr_segments: list[dict],
    diar_segments: list[tuple[float, float, int]],
) -> dict:
    """Assign speaker IDs to ASR segments by maximum time overlap."""
    output_segments = []
    text_parts = []

    for seg in asr_segments:
        start = seg["start"]
        end = seg["end"]
        speaker = _find_speaker(start, end, diar_segments)

        output_segments.append({
            "text": seg["text"],
            "speaker_index": speaker,
            "has_speaker_id": speaker >= 0 and len(diar_segments) > 0,
            "start_time": start,
            "duration": round(end - start, 3),
        })
        text_parts.append(seg["text"])

    return {
        "segments": output_segments,
        "text": " ".join(text_parts),
    }


def _find_speaker(
    start: float, end: float, diar_segments: list[tuple[float, float, int]]
) -> int:
    """Find speaker with maximum overlap in the given time window."""
    best = -1
    best_overlap = 0.0

    for d_start, d_end, speaker_id in diar_segments:
        overlap = max(0.0, min(end, d_end) - max(start, d_start))
        if overlap > best_overlap:
            best_overlap = overlap
            best = speaker_id

    return best if best >= 0 else 0


if __name__ == "__main__":
    main()
