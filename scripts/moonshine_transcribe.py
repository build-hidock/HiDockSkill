#!/usr/bin/env python3
"""Transcribe a WAV file using Moonshine, with auto language detection.

Pipeline:
  1. Resolve target language (env LANGUAGE_HINT > CLI arg > auto-detect via faster-whisper tiny)
  2. Load matching per-language Moonshine model (auto-downloads on first use)
  3. Transcribe with built-in diarization — preserves speaker_index per line
  4. Emit JSON compatible with src/transcribe.ts parseMoonshineOutput()

Usage: moonshine_transcribe.py <wav_path> [language]
  language: ISO 639-1 code (en, es, ar, ja, ko, vi, uk, zh) or "auto" (default)

Environment:
  LANGUAGE_HINT — Override detection with a fixed language code (skips faster-whisper LID)

Output JSON:
  {
    "segments": [
      {"text": ..., "speaker_index": int, "has_speaker_id": bool,
       "start_time": float, "duration": float},
      ...
    ],
    "text": "joined transcript",
    "detected_language": "en",
    "model_arch": "BASE"
  }
"""

import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")

# 8 languages currently supported by Moonshine v2 (per moonshine_voice.supported_languages())
MOONSHINE_LANGUAGES: set[str] = {"en", "es", "ar", "ja", "ko", "vi", "uk", "zh"}

# Common 3-letter / variant code → ISO 639-1 mapping
LANG_ALIASES: dict[str, str] = {
    "eng": "en",
    "spa": "es",
    "ara": "ar",
    "jpn": "ja",
    "kor": "ko",
    "vie": "vi",
    "ukr": "uk",
    "zho": "zh",
    "cmn": "zh",  # Mandarin
    "yue": "zh",  # Cantonese — use Chinese model as best available
    "wuu": "zh",  # Wu Chinese
}


def normalize_lang(code: str) -> str:
    """Normalize language code to a bare ISO 639-1 form (e.g. en-US → en, eng → en)."""
    code = (code or "").strip().lower()
    if not code:
        return ""
    # Strip region/script suffixes: en-us, zh_CN, zh-Hans → en, zh, zh
    for sep in ("-", "_"):
        if sep in code:
            code = code.split(sep, 1)[0]
    return LANG_ALIASES.get(code, code)


def detect_language(wav_path: str) -> tuple[str, float]:
    """Detect language using faster-whisper tiny on the first 30s of audio.

    Returns (lang_code, probability). Falls back to ("en", 0.0) on failure.
    """
    try:
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
    except Exception as e:
        sys.stderr.write(f"  warning: faster-whisper unavailable, defaulting to 'en' ({e})\n")
        return ("en", 0.0)

    sys.stderr.write("  Detecting language (faster-whisper tiny)...\n")
    t0 = time.time()
    try:
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
        audio = decode_audio(wav_path, sampling_rate=16000)
        # Whisper LID uses a 30s window; faster-whisper handles slicing internally.
        # Pass at most 30s explicitly to keep memory minimal.
        max_samples = 16000 * 30
        if len(audio) > max_samples:
            audio = audio[:max_samples]
        lang, prob, _ = model.detect_language(audio=audio)
        elapsed = time.time() - t0
        sys.stderr.write(f"  Detected: {lang} (prob={prob:.2f}, {elapsed:.1f}s)\n")
        return (lang, float(prob))
    except Exception as e:
        sys.stderr.write(f"  warning: language detection failed, defaulting to 'en' ({e})\n")
        return ("en", 0.0)


def resolve_target_language(cli_arg: str | None) -> str:
    """Resolve which Moonshine language model to use.

    Priority: env LANGUAGE_HINT > CLI arg (if not 'auto') > faster-whisper detection
    Always returns one of MOONSHINE_LANGUAGES (falls back to 'en' if unsupported).
    """
    env_hint = os.environ.get("LANGUAGE_HINT", "").strip()
    if env_hint:
        norm = normalize_lang(env_hint)
        sys.stderr.write(f"  Language from LANGUAGE_HINT env: {norm}\n")
    elif cli_arg and cli_arg.lower() not in ("auto", ""):
        norm = normalize_lang(cli_arg)
        sys.stderr.write(f"  Language from CLI arg: {norm}\n")
    else:
        detected, _prob = detect_language(sys.argv[1])
        norm = normalize_lang(detected)

    if norm in MOONSHINE_LANGUAGES:
        return norm

    sys.stderr.write(
        f"  warning: '{norm}' is not a Moonshine-supported language "
        f"(supported: {sorted(MOONSHINE_LANGUAGES)}). Falling back to 'en'.\n"
    )
    return "en"


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: moonshine_transcribe.py <wav_path> [language|auto]", file=sys.stderr)
        sys.exit(1)

    wav_path = sys.argv[1]
    cli_lang = sys.argv[2] if len(sys.argv) > 2 else None

    target_lang = resolve_target_language(cli_lang)

    from moonshine_voice import get_model_for_language, load_wav_file, ModelArch  # type: ignore[import-untyped]
    from moonshine_voice.transcriber import Transcriber  # type: ignore[import-untyped]

    # Pin to BASE (non-streaming) — moonshine_voice defaults English to MEDIUM_STREAMING
    # which is tuned for low-latency live transcription, not offline accuracy. BASE is
    # what asrbench measured at 2.55% EN WER. For non-English, BASE is the only variant
    # shipped, so the same call works uniformly.
    sys.stderr.write(f"  Loading Moonshine BASE model for '{target_lang}'...\n")
    model_path, model_arch = get_model_for_language(target_lang, ModelArch.BASE)
    transcriber = Transcriber(model_path, model_arch)
    try:
        sys.stderr.write("  Transcribing...\n")
        t0 = time.time()
        audio_data, sample_rate = load_wav_file(wav_path)
        result = transcriber.transcribe_without_streaming(audio_data, sample_rate)
        elapsed = time.time() - t0

        segments = []
        text_parts = []
        for line in result.lines:
            text = line.text.strip()
            if not text:
                continue
            text_parts.append(text)
            segments.append({
                "text": text,
                "speaker_index": getattr(line, "speaker_index", 0),
                "has_speaker_id": getattr(line, "has_speaker_id", False),
                "start_time": getattr(line, "start_time", 0.0),
                "duration": getattr(line, "duration", 0.0),
            })

        n_speakers = len({s["speaker_index"] for s in segments if s["has_speaker_id"]})
        sys.stderr.write(
            f"  {len(segments)} segments, {n_speakers} speakers, {elapsed:.1f}s\n"
        )

        output = {
            "segments": segments,
            "text": " ".join(text_parts),
            "detected_language": target_lang,
            "model_arch": getattr(model_arch, "name", str(model_arch)),
        }
        print(json.dumps(output, ensure_ascii=False))
    finally:
        transcriber.close()


if __name__ == "__main__":
    main()
