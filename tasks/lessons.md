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
