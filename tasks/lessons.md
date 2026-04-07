# Lessons Learned

## 2026-03-06
- Preventative rule: When adding a monitoring API, always ship and document at least one runnable production entrypoint (CLI/script/service wiring) in the same change; API-only monitoring is incomplete and likely to be silently unused.
- Preventative rule: Connection-state monitors must explicitly specify startup semantics (`emit on first connected` vs `transition-only`) and enforce them with unit tests.
- Preventative rule: Any outward notification path (Slack/DM/webhook) must be config-driven and injected behind a mockable sender interface so failures are non-fatal and behavior is unit-test deterministic.
- Preventative rule: When adding thread-aware messaging, always define and test explicit inactivity fallback routing (no-thread/main timeline) so alerts never silently stick to stale threads.
- Preventative rule: Any CLI module imported by another runtime path must guard entrypoint execution (`isDirectRun`) to avoid accidental side effects during watcher/daemon startup.
- Preventative rule: Any new remote storage backend must implement operation-level fallback to local persistence (`isIndexed` + save paths), so transient backend failures never block capture.
- Preventative rule: Backend selection should be normalized in one parser (`local|memdock`) and reused across manual + auto-sync flows to prevent drift in runtime behavior.
- Preventative rule: When a backend relies on HTTP endpoints, make API path prefix configurable (`*_API_PATH`) and test both env and CLI parsing to avoid hardcoded route coupling.
- Preventative rule: During naming/branding migrations, run a repo-wide string audit (`rg`) and classify each hit as rename vs compatibility-retain before editing; document intentionally retained legacy identifiers in `tasks/todo.md` final review.

## 2026-03-12
- Preventative rule: USB protocol parsers must not assume a fixed header format across device models. Always detect header markers and fall back to headerless parsing when absent.
- Preventative rule: Long-running servers (galaxy, watcher) must not restart on repeated events. Check if already running before recreating — repeated USB plug-in events are noisy and will wipe in-memory state.
- Preventative rule: All-or-nothing state persistence (only save on full success) causes infinite re-processing when any file fails. Save state incrementally per item.

## 2026-03-19
- Preventative rule: Don't rely on small local LLMs (qwen3.5:9b) for structured output compliance. They hallucinate names, ignore format instructions, and produce model artifacts. Always have a rule-based heuristic fallback for critical parsing (speaker names, metadata extraction).
- Preventative rule: When LLM output contains markdown with `## ` headings, note-parsing regexes that stop at `(?=\n## )` will break. Anchor to specific section boundaries (e.g., `## Summary` to `## Transcript`) not generic heading patterns.
- Preventative rule: LLM outputs from Qwen models leak special tokens (`<|endoftext|>`, `<|im_start|>user`). Always sanitize with a dedicated function that strips these artifacts — don't rely on `stripThinkTags` alone.
- Preventative rule: Ollama `stream: false` mode can hang indefinitely on long prompts or thinking models. Always use `stream: true` with incremental reading to avoid header timeouts.
- Preventative rule: Browser `<audio>` elements require HTTP Range request support (`Accept-Ranges: bytes`, 206 responses) for seeking. Without it, clicking the progress bar does nothing.

## 2026-04-07
- Preventative rule: When integrating a model loader from a third-party package (`get_model_for_X`), always inspect *which* model variant gets returned by default. `moonshine_voice.get_model_for_language("en")` defaulted to `MEDIUM_STREAMING` (live-latency tuned), not the `BASE` model the public benchmarks reported — running as default cost ~9× wall time for offline transcription. Pin the variant explicitly in code, never trust defaults for accuracy/perf-sensitive paths.
- Preventative rule: Don't trust an external benchmark's model selection without verifying the runtime defaults. asrbench's "moonshine/base 2.55% WER" measured `BASE`, but the same package call in production code can return a different arch silently.
- Preventative rule: HuggingFace-style auto-download paths can leave `.partial` files on network failure that block clean retry. When integrating any auto-downloader, surface partial-cleanup instructions in the user-facing error path.
- Preventative rule: Don't conflate "embedding model" names — `moonshine_voice.get_embedding_model()` returns a *text* embedding (`embeddinggemma-300m`) for intent recognition, not a speaker embedding. Always confirm embedding modality (audio/text/image) before designing around it.
- Preventative rule: Filename-based product ID labels in USB filter tables MUST be verified against live `ioreg`/`lsusb` output, not against folklore. The HiDock filter table had `0xb00d // P1` as a comment but the actual product IDs are `0xb00e=P1` and `0xb00d=H1E`. The wrong label caused the watcher to silently sync from the wrong device when both were on the bus.
- Preventative rule: NEVER swallow errors silently in periodic-poll catch blocks. The file-poll's `catch { /* device busy */ }` hid `LIBUSB_ERROR_NO_DEVICE` failures for hours of production runtime. At minimum, log the error reason while still suppressing the benign "no device found" case explicitly by name.
- Preventative rule: When an SDK that wraps a lower-level library hangs, drop down to the lower-level library and try the same operation. `webusb.requestDevice().open()` hung indefinitely on the H1E after a stalled USB transfer, but `usb.findByIds().open()` succeeded in 0.1s — the wedge was in the webusb wrapper, not libusb itself. A libusb-level `device.reset()` (~100ms) cleared the kernel state and let the webusb path succeed.
- Preventative rule: When mixing libusb-level and webusb-level access to the same device, **synchronize them** — never race. A fire-and-forget `nativeDevice.reset()` followed immediately by `webusb.requestDevice()` SIGSEGVs the libusb context. Always `await` the reset callback before passing the device handle to the higher-level wrapper.
- Preventative rule: Multi-device USB scenarios deserve dedicated enumeration logic. The default `webusb.requestDevice({ filters })` returns "the first match per filter" with no determinism across multiple matching devices. For multi-device hosts, enumerate via the underlying `usb.getDeviceList()` (which has no caching), sort by an explicit preference (or honor an env override), and pass the chosen vendor+productId to `webusb.requestDevice()` for the wrapper instance.
- Preventative rule: Decouple background data-collection loops from the side effects they trigger. The file-poll loop was wrapped in `if (runAutoSync)`, which meant `--no-auto-sync` disabled both file listing AND device-file UI updates. Always separate "gather data" from "act on data" so one can run without the other for diagnostics.
