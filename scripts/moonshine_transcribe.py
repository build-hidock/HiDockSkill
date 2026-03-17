#!/usr/bin/env python3
"""Transcribe a WAV file using Moonshine and print JSON with speaker segments."""

import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: moonshine_transcribe.py <wav_path> [language]", file=sys.stderr)
        sys.exit(1)

    wav_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "en"

    from moonshine_voice import get_model_for_language, load_wav_file  # type: ignore[import-untyped]
    from moonshine_voice.transcriber import Transcriber  # type: ignore[import-untyped]

    model_path, model_arch = get_model_for_language(language)
    transcriber = Transcriber(model_path, model_arch)
    try:
        audio_data, sample_rate = load_wav_file(wav_path)
        result = transcriber.transcribe_without_streaming(audio_data, sample_rate)
        segments = []
        text_parts = []
        for line in result.lines:
            text = line.text.strip()
            if not text:
                continue
            text_parts.append(text)
            segment = {
                "text": text,
                "speaker_index": getattr(line, "speaker_index", 0),
                "has_speaker_id": getattr(line, "has_speaker_id", False),
                "start_time": getattr(line, "start_time", 0.0),
                "duration": getattr(line, "duration", 0.0),
            }
            segments.append(segment)

        output = {
            "segments": segments,
            "text": " ".join(text_parts),
        }
        print(json.dumps(output))
    finally:
        transcriber.close()


if __name__ == "__main__":
    main()
