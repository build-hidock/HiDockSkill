# HiDockSkill

Automated meeting transcription, summarization, and visualization pipeline for [HiDock P1](https://www.hidock.com/) USB meeting recorder.

## What It Does

1. Connects to HiDock P1 via USB
2. Downloads recordings from the device
3. Transcribes audio with OpenAI Whisper
4. Summarizes with GPT-4o-mini
5. Saves Markdown notes with audio files to tiered storage
6. Visualizes your meeting history as an interactive galaxy dashboard

## Galaxy Dashboard

A D3.js force-directed graph that maps all your meeting notes as an interactive constellation.

- **Galaxy view** — force-directed graph with memcard nodes, orbital rings by tier (hot/warm/cold), color-coded source type dots, and relationship edges
- **List view** — searchable, sortable table of all notes
- **Tab switcher** — floating tabs at top center to switch between views
- **Note popup** — click any card or row to open an elegant modal with summary, transcript, and audio player
- **AI insights sidebar** — hot topics cloud, action items, reminders, achievements extracted from recent notes
- **Syncing overlay** — pulsing animation while device is syncing, auto-transitions to galaxy when ready

Open the dashboard:

```bash
npm run galaxy:open
```

Or visit http://127.0.0.1:18180 when the USB watcher is running.

## Quick Start

### 1. Install

```bash
git clone https://github.com/build-hidock/HiDockSkill.git
cd HiDockSkill
npm install
```

### 2. Configure

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

### 3. Connect HiDock P1 via USB

> **USB exclusivity:** HiDock can only be owned by one app at a time. Close HiNotes web/browser before using HiDockSkill.

### 4. Sync recordings

```bash
npm run meetings:sync
```

### 5. Start USB watcher (recommended)

Auto-syncs when you plug in, opens galaxy dashboard, sends macOS notifications:

```bash
npm run usb:watch
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run meetings:sync` | Sync all new recordings from device |
| `npm run usb:watch` | Long-running USB plug-in monitor with auto-sync |
| `npm run galaxy:open` | Open galaxy dashboard in browser |
| `npm run galaxy` | Start galaxy server without opening browser |
| `npm test` | Run test suite |
| `npm run build` | Compile TypeScript |

## Sync Flags

```bash
npm run meetings:sync -- [flags]
```

| Flag | Description |
|------|-------------|
| `--dry-run` | List files without processing |
| `--limit N` | Process only newest N files |
| `--whisper-only` | Only whisper memo recordings |
| `--meetings-only` | Only meeting recordings |
| `--language CODE` | Whisper language hint (e.g., `en`, `zh`) |
| `--storage <dir>` | Override storage directory |
| `--state-file <path>` | Override sync state file |

## USB Watcher Flags

```bash
npm run usb:watch -- [flags]
```

| Flag | Description |
|------|-------------|
| `--interval-ms N` | Poll interval (default: 5000) |
| `--no-auto-sync` | Watch-only, no sync on plug-in |
| `--no-emit-on-startup` | Skip notification if already connected |
| `--sync-debounce-ms N` | Debounce window (default: 1500) |
| `--no-slack-forward` | Disable Slack forwarding |
| `--slack-target ID` | Slack DM target for notifications |

## Storage Layout

Notes are organized by age into tiered storage:

```
<storage>/
  meetingindex.md              # Master meeting index
  whisperindex.md              # Master whisper memo index
  meetings/
    hotmem/YYYYMM/            # 0-30 days
    warmmem/YYYYMM/           # 31-180 days
    coldmem/YYYYMM/           # 181+ days
  whispers/
    hotmem/                    # Recent memos
    warmmem/                   # Older memos
    coldmem/                   # Archived memos
```

Each note is a Markdown file with Summary and Transcript sections. Audio files (`.mp3` or `.wav`) are saved alongside each note for in-browser playback.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | **Required.** OpenAI API key | — |
| `MEETING_STORAGE_DIR` | Notes storage root | (compiled-in) |
| `WHISPER_MODEL` | Whisper model ID | `whisper-1` |
| `SUMMARY_MODEL` | Summary model ID | `gpt-4o-mini` |
| `WHISPER_LANGUAGE` | Language hint | (auto-detect) |
| `HIDOCK_NOTES_BACKEND` | `local` or `memdock` | `local` |
| `HIDOCK_NOTES_TIER_HOT_MAX_DAYS` | Hot tier max age | `30` |
| `HIDOCK_NOTES_TIER_WARM_MAX_DAYS` | Warm tier max age | `180` |

## AI Agent Integration

HiDockSkill works with both **Claude Code** and **OpenClaw** via the companion skill repo:

```bash
# Claude Code
git clone https://github.com/build-hidock/HiDockSkill-Claude ~/.claude/skills/hidock-skill

# OpenClaw
ln -s /path/to/HiDockSkill-Claude ~/.openclaw/skills/hidock-skill
```

Then just say "HiDock" to open the galaxy dashboard, or "sync HiDock" to sync recordings.

## Source Types

HiDock filenames encode the recording type (e.g., `2026Feb21-132825-Rec00.hda`):

| Type | Pattern | Color |
|------|---------|-------|
| Meeting | `Rec` | Blue |
| WIP | `Wip` | Green |
| Room | `Room` | Amber |
| Call | `Call` | Red |
| Whisper | `Whsp` | Purple |

## Troubleshooting

### `LIBUSB_ERROR_ACCESS`
Another app holds the USB device. Close HiNotes web/browser, kill stale processes:
```bash
pkill -f "usb:watch"
pkill -f "meetings:sync"
```

### `OPENAI_API_KEY is required`
```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

### Device not found
Ensure HiDock P1 is connected via USB. On macOS, check System Information > USB.

## License

MIT — see [LICENSE](LICENSE)
