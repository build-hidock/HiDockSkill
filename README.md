# HiDockSkill 📝  
_Automated HiDock meeting transcription & summarization pipeline for OpenClaw_

## Overview
HiDockSkill connects to your HiDock device, fetches recordings from P1, transcribes audio using OpenAI Whisper, and generates concise Markdown meeting notes & indexes.

## Features
- Detect & list recordings from HiDock (no sudo required)
- Transcribe using Whisper
- Auto‑summarize meetings via LLM
- Store results as organized Markdown files
- Selectable notes backend (`local` or `memdock`) with local fallback safety
- Slack / OpenClaw query integration (“HiDockSkill, how many recordings on P1”)

## Quick Installation
```bash
# inside your OpenClaw workspace
clawhub install seanspsong/HiDockSkill
```

## First‑Time Setup
1. Connect your HiDock via USB.  
2. Ensure permissions are correct (macOS `chmod a+rw /dev/usb/*` or udev rule on Linux).  
3. Run:
   ```bash
   node list-files-user.js
   ```
   Expect output similar to:
   ```
   Total recordings on P1: 2
   2026Feb21‑132825‑Rec00.hda (0.2 MB)
   2026Feb21‑132846‑Wip00.hda (0.0 MB)
   ```
4. To process recordings:
   ```bash
   node dist/cli/meetingsSync.js
   ```
   Default storage is `/Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes`.

## Continuous USB Plug-In Watch (OpenClaw)
Use this long-running command for real-time plug-in notifications.
By default, each plug-in event also triggers an incremental auto-sync run:

> 💡 **Tip (USB ownership):** HiDock can only be owned by one app at a time. If you want to use HiNotes web, stop any running `usb:watch` / sync process first so the device is released immediately.
> - Find running watcher: `pgrep -af "usb:watch|meetings:sync"`
> - Stop watcher: `pkill -f "npm run usb:watch"`

```bash
npm run usb:watch
```

For OpenClaw runner invocation:
```bash
npm run usb:watch -- --interval-ms 5000
```

Slack DM auto-forward (recommended for proactive alerts):
```bash
export HIDOCK_USB_WATCH_SLACK_TARGET="U12345678"
npm run usb:watch
```

Thread-aware routing (active in last 5m -> thread, otherwise DM timeline):
```bash
export HIDOCK_USB_WATCH_SLACK_TARGET="D12345678"
export HIDOCK_USB_WATCH_SLACK_THREAD_ID="1741246283.005900"
export HIDOCK_USB_WATCH_SLACK_ACTIVITY_USER_ID="U12345678"
export HIDOCK_USB_WATCH_ACTIVE_WINDOW_MINUTES="5"
npm run usb:watch
```

Or provide target/bin via flags:
```bash
npm run usb:watch -- --slack-target D12345678 --slack-thread-id 1741246283.005900 --slack-activity-user-id U12345678 --active-window-minutes 5 --openclaw-bin /usr/local/bin/openclaw
```

Optional startup behavior:
- default: emits once immediately if P1 is already connected when watcher starts
- disable startup emission:
  ```bash
  npm run usb:watch -- --no-emit-on-startup
  ```
- disable Slack forwarding even when env target is set:
  ```bash
  npm run usb:watch -- --no-slack-forward
  ```
- disable auto-sync (watch-only mode):
  ```bash
  npm run usb:watch -- --no-auto-sync
  ```

Incremental sync state:
- default state file: `/Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes/.hidock-sync-state.json`
- stores last successful sync timestamp + processed file markers
- repeated plug-in events are idempotent and will skip already-processed recordings
- override state file path manually:
  ```bash
  npm run meetings:sync -- --state-file ./meeting-storage/custom-sync-state.json
  ```

Storage backend selection:
- default backend: `local` (writes markdown files under `--storage`)
- select memdock backend:
  ```bash
  export HIDOCK_NOTES_BACKEND=memdock
  export MEMDOCK_BASE_URL=http://127.0.0.1:7788
  export MEMDOCK_API_PATH=/api/v1/notes
  npm run meetings:sync
  ```
- explicit flags for manual runs:
  ```bash
  npm run meetings:sync -- --storage-backend memdock --memdock-base-url http://127.0.0.1:7788 --memdock-api-path /api/v1/notes
  ```
- optional custom memdock API path (default: `/api/v1/notes`):
  ```bash
  npm run meetings:sync -- --storage-backend memdock --memdock-base-url http://127.0.0.1:7788 --memdock-api-path /api/v2/notes
  ```
- watcher auto-sync uses the same env (`HIDOCK_NOTES_BACKEND`, `MEMDOCK_*`)
- optional memdock env:
  - `MEMDOCK_API_KEY` (bearer token)
  - `MEMDOCK_API_PATH` (API prefix, default `/api/v1/notes`)
  - `MEMDOCK_WORKSPACE`, `MEMDOCK_COLLECTION`, `MEMDOCK_TIMEOUT_MS`
- if memdock is unreachable/misconfigured, sync falls back to local storage automatically

Auto-sync concurrency control:
- watcher uses single-flight lock + debounce (default `1500ms`)
- burst plug-in events are coalesced to avoid overlapping sync runs
- tune debounce:
  ```bash
  npm run usb:watch -- --sync-debounce-ms 2500
  ```

Expected output example:
```text
[HiDock USB Watch] starting (intervalMs=5000, emitOnStartupIfConnected=true, slackForward=enabled, threadRouting=enabled, activeWindowMinutes=5)
[HiDock USB Watch] ============================================
[HiDock USB Watch] | HiDock P1 plugged in, auto sync your latest recordings now... |
[HiDock USB Watch] ============================================
```

## Troubleshooting

### `LIBUSB_ERROR_ACCESS` / skill cannot connect to device
This usually means the HiDock USB interface is occupied by another app/session.

Check in order:
1. Ensure HiDock P1 is plugged in.
2. Check if HiNotes web / browser page is open and connected to HiDock (it can occupy the device exclusively).
3. Close the HiNotes/HiDock web tab (or browser), then retry HiDockSkill.
4. If needed, stop watcher/sync process and retry:
   - `pkill -f "npm run usb:watch"`
   - `pkill -f "meetings:sync"`

## File Layout
- `dist/` – compiled source  
- `list-files-user.js` – safe, non‑sudo device lister  
- `/Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes/` – generated Markdown notes  
- `skills/hinotes/SKILL.md` – manifest & setup documentation

## Install from OpenClaw

### Option 1 – via ClawHub (preferred)
```bash
clawhub install seanspsong/HiDockSkill
```

### Option 2 – manual install
```bash
mkdir -p ~/.openclaw/workspace/skills/
git clone https://github.com/seanspsong/HiDockSkill ~/.openclaw/workspace/skills/hinotes
```
Then reload:
```bash
openclaw reload skills
```

## Use from OpenClaw / Slack
After installation, you can invoke HiDockSkill conversationally or programmatically.

| Command | Description |
|----------|--------------|
| "HiDockSkill, how many recordings I have on P1" | List all recordings detected on your HiDock P1 |
| "HiDockSkill, process them" | Run transcription + summary pipeline for all new recordings |
| "HiDockSkill, summarize latest meeting" | Re‑summarize the last sync batch |
| "HiDockSkill, show index" | Display the Markdown meeting index |

Results (transcripts + summaries) are stored in:
```
/Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes/
```

## OpenAI API Key Setup
To enable transcription and summarization, set your OpenAI API key locally (never commit it):

```bash
cd ~/HiDockSkill
echo "OPENAI_API_KEY=sk-..." > .env
```

`.env` is listed in `.gitignore`, so the key remains private. Whisper and summary models will automatically load it at runtime.

## Storage Adapter Notes
- `LocalMeetingStorageAdapter` writes markdown files to disk (default backend).
- `MemdockNotesStorageAdapter` calls memdock HTTP endpoints:
  - `POST <MEMDOCK_API_PATH>/is-indexed` (default path: `/api/v1/notes`)
  - `POST <MEMDOCK_API_PATH>/save` (default path: `/api/v1/notes`)
- Both manual sync (`meetings:sync`) and auto-sync (`usb:watch`) go through the same adapter selection path.
- Any memdock request failure degrades to local adapter behavior for resilience.

## License
© 2026 Sean Song – Private use & collaborator‑only distribution.
