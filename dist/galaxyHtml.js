/**
 * Render a self-contained HTML page with two states:
 * 1. Syncing — pulsing animation while HiDock device is being synced
 * 2. Galaxy — D3.js force-directed graph of meeting notes
 *
 * When `data` is null, the page starts in syncing mode and polls /data.json
 * until data becomes available, then transitions to the galaxy view.
 */
function renderWikiCategoriesHtml(indexContent) {
    const ICONS = { people: "&#x1f464;", projects: "&#x1f4cb;", topics: "&#x1f4d6;", decisions: "&#x2696;", actions: "&#x2705;" };
    const categories = ["People", "Projects", "Topics", "Decisions", "Actions"];
    let html = "";
    for (const cat of categories) {
        const catKey = cat.toLowerCase();
        const icon = ICONS[catKey] ?? "";
        const lines = [];
        let inSection = false;
        for (const line of indexContent.split("\n")) {
            if (line.startsWith(`## ${cat}`)) {
                inSection = true;
                continue;
            }
            if (line.startsWith("## ") && inSection) {
                inSection = false;
                continue;
            }
            if (inSection && line.startsWith("- "))
                lines.push(line);
        }
        html += `<div class="wiki-category-card">`;
        html += `<div class="wiki-category-header">${icon} ${cat} <span class="wiki-category-count">(${lines.length})</span></div>`;
        if (lines.length === 0) {
            html += `<div style="font-size:12px;color:var(--text-dim);padding:4px 0;">No entries yet</div>`;
        }
        for (const line of lines) {
            const lb = line.indexOf("[");
            const rb = line.indexOf("]", lb);
            const lp = line.indexOf("(", rb);
            const rp = line.indexOf(")", lp);
            if (lb >= 0 && rb > lb && lp > rb && rp > lp) {
                const title = line.substring(lb + 1, rb);
                const wikiPath = line.substring(lp + 1, rp);
                const dashIdx = line.indexOf(" — ", rp);
                const snippet = dashIdx >= 0 ? line.substring(dashIdx + 3) : "";
                const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                const safeSnippet = snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                const safePath = wikiPath.replace(/'/g, "");
                html += `<div class="wiki-entry" onclick="openWikiPage('${safePath}')">`;
                html += `<span class="wiki-entry-title">${safeTitle}</span>`;
                if (snippet)
                    html += `<span class="wiki-entry-snippet">${safeSnippet}</span>`;
                html += `</div>`;
            }
        }
        html += `</div>`;
    }
    return html;
}
export function renderGalaxyHtml(data, wikiIndexContent) {
    const dataJson = data ? JSON.stringify(data) : "null";
    const wikiCategoriesHtml = wikiIndexContent ? renderWikiCategoriesHtml(wikiIndexContent) : "";
    const wikiJson = wikiIndexContent ? JSON.stringify(wikiIndexContent) : "null";
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HiDock, Your Private Meeting Memory</title>
<style>
  :root {
    --purple: #a855f7;
    --purple-light: #c084fc;
    --purple-lighter: #d8b4fe;
    --purple-dark: #7c3aed;
    --purple-darker: #6d28d9;
    --indigo: #4338ca;
    --color-hot: #a855f7;
    --color-warm: #7c3aed;
    --color-cold: #4338ca;
    --color-new: #ff4444;
    --src-rec: #22c55e;
    --src-wip: #3b82f6;
    --src-room: #f59e0b;
    --src-call: #22c55e;
    --src-whsp: #3b82f6;
    --edge-series: #c084fc;
    --edge-project: #f59e0b;
    --edge-attendee: #22c55e;
    --edge-sameday: rgba(168,85,247,0.12);
    --bg-dark: #0d0117;
    --bg-mid: #1a0a2e;
    --panel-bg: rgba(20, 8, 40, 0.92);
    --text-primary: #ede9fe;
    --text-secondary: #a78bfa;
    --text-dim: #7c6f9f;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: linear-gradient(135deg, var(--bg-dark) 0%, var(--bg-mid) 100%);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, monospace;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }

  /* ---------- header ---------- */
  #header {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background: rgba(13, 1, 23, 0.85);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(168, 85, 247, 0.15);
    z-index: 100;
  }
  #header h1 {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 1.5px;
    background: linear-gradient(90deg, var(--purple-light), var(--purple));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  #header .stats {
    font-size: 12px;
    color: var(--text-dim);
    display: flex;
    gap: 16px;
  }
  #header .stats span { white-space: nowrap; }
  .stat-label { color: var(--text-dim); }
  .stat-hot { color: var(--color-hot); }
  .stat-warm { color: var(--color-warm); }
  .stat-cold { color: var(--color-cold); }
  .stat-new { color: var(--color-new); text-shadow: 0 0 6px rgba(255,68,68,0.6); }

  /* ---------- syncing overlay ---------- */
  #syncing-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 500;
    transition: opacity 0.6s ease, visibility 0.6s ease;
  }
  #syncing-overlay.hidden {
    display: none !important;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }

  .sync-orb {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 40%, var(--purple-light), var(--purple-dark));
    box-shadow: 0 0 60px rgba(168,85,247,0.4), 0 0 120px rgba(168,85,247,0.2);
    animation: sync-pulse 2s ease-in-out infinite;
    margin-bottom: 40px;
  }

  @keyframes sync-pulse {
    0%, 100% {
      transform: scale(1);
      box-shadow: 0 0 60px rgba(168,85,247,0.4), 0 0 120px rgba(168,85,247,0.2);
    }
    50% {
      transform: scale(1.08);
      box-shadow: 0 0 80px rgba(168,85,247,0.6), 0 0 160px rgba(168,85,247,0.3);
    }
  }

  .sync-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--purple-lighter);
    margin-bottom: 12px;
    letter-spacing: 0.5px;
  }

  .sync-status {
    font-size: 14px;
    color: var(--text-secondary);
    animation: sync-dots 1.5s steps(4, end) infinite;
  }

  @keyframes sync-dots {
    0%   { content: ""; }
    25%  { content: "."; }
    50%  { content: ".."; }
    75%  { content: "..."; }
  }
  .sync-dots::after {
    content: "";
    animation: sync-dots-text 1.5s steps(4, end) infinite;
  }
  @keyframes sync-dots-text {
    0%   { content: ""; }
    25%  { content: "."; }
    50%  { content: ".."; }
    75%  { content: "..."; }
  }

  /* ---------- sync progress ---------- */
  .sync-progress {
    margin-top: 24px;
    width: 420px;
    max-width: 90vw;
    text-align: left;
  }
  #sync-file-list {
    max-height: 35vh;
    overflow-y: scroll;
    scroll-behavior: smooth;
  }
  #sync-file-list::-webkit-scrollbar { width: 6px; display: block; }
  #sync-file-list::-webkit-scrollbar-track { background: rgba(168,85,247,0.05); border-radius: 3px; }
  #sync-file-list::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.35); border-radius: 3px; min-height: 30px; }
  .sync-progress-header {
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
  }
  #sync-progress-pct {
    font-size: 14px;
    font-weight: 600;
    color: var(--purple-light);
    font-variant-numeric: tabular-nums;
  }

  /* ---------- sync popup (over galaxy view) ---------- */
  .sync-popup {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 340px;
    max-height: 50vh;
    background: rgba(15,10,30,0.92);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(168,85,247,0.25);
    border-radius: 12px;
    padding: 16px;
    z-index: 1000;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    transition: opacity 0.3s ease, transform 0.3s ease;
  }
  .sync-popup.hidden {
    opacity: 0;
    transform: translateY(20px);
    pointer-events: none;
  }
  .sync-popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .sync-popup-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--purple-light);
  }
  #sync-popup-pct {
    font-size: 14px;
    font-weight: 700;
    color: var(--purple-light);
    font-variant-numeric: tabular-nums;
  }
  .sync-popup .sync-progress-bar { margin-bottom: 10px; }
  .sync-popup-files {
    max-height: 180px;
    overflow-y: auto;
    font-size: 11px;
  }
  .sync-popup-files::-webkit-scrollbar { width: 3px; }
  .sync-popup-files::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.2); border-radius: 2px; }
  .sync-progress-bar {
    height: 4px;
    background: rgba(168,85,247,0.15);
    border-radius: 2px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .sync-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--purple), var(--purple-light));
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .sync-file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .sync-file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
    font-size: 11px;
  }
  .sync-file-status {
    flex-shrink: 0;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 8px;
    font-weight: 500;
  }
  .sync-file-status.downloading { background: rgba(59,130,246,0.15); color: #60a5fa; }
  .sync-file-status.transcribing { background: rgba(168,85,247,0.15); color: var(--purple-light); }
  .sync-file-status.summarizing { background: rgba(245,158,11,0.15); color: #fbbf24; }
  .sync-file-status.saved { background: rgba(34,197,94,0.15); color: #4ade80; }
  .sync-file-status.skipped { background: rgba(124,111,159,0.1); color: var(--text-dim); }
  .sync-file-status.failed { background: rgba(239,68,68,0.15); color: #f87171; }
  .sync-file-status.pending { background: rgba(124,111,159,0.06); color: var(--text-dim); }

  .sync-ring {
    position: absolute;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    border: 1px solid rgba(168,85,247,0.15);
    animation: sync-ring-expand 3s ease-out infinite;
  }
  .sync-ring:nth-child(2) { animation-delay: 1s; }
  .sync-ring:nth-child(3) { animation-delay: 2s; }

  @keyframes sync-ring-expand {
    0% { transform: scale(0.6); opacity: 0.6; }
    100% { transform: scale(2.5); opacity: 0; }
  }

  /* ---------- SVG ---------- */
  #galaxy-svg {
    position: fixed;
    top: 48px; left: 0;
    width: calc(100vw - 560px);
    height: calc(100vh - 48px);
  }

  /* ---------- tooltip ---------- */
  #tooltip {
    position: fixed;
    pointer-events: none;
    background: var(--panel-bg);
    border: 1px solid rgba(168,85,247,0.2);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    line-height: 1.5;
    max-width: 320px;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 200;
    backdrop-filter: blur(6px);
  }
  #tooltip.visible { opacity: 1; }
  #tooltip .tt-title {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }
  #tooltip .tt-date { color: var(--text-secondary); font-size: 11px; }
  #tooltip .tt-brief { color: var(--purple-lighter); margin-top: 4px; }

  /* ---------- note popup modal ---------- */
  #note-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(5, 0, 15, 0.75);
    backdrop-filter: blur(8px);
    z-index: 300;
    display: none;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  #note-overlay.open { display: flex; opacity: 1; }

  #note-modal {
    width: 1200px;
    max-width: 96vw;
    max-height: 92vh;
    background: linear-gradient(165deg, #1a0a2e 0%, #0d0117 100%);
    border: 1px solid rgba(168,85,247,0.2);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(168,85,247,0.08);
    transform: scale(0.95) translateY(10px);
    transition: transform 0.25s ease;
  }
  #note-overlay.open #note-modal {
    transform: scale(1) translateY(0);
  }

  .modal-header {
    padding: 24px 28px 16px;
    border-bottom: 1px solid rgba(168,85,247,0.1);
    position: relative;
  }
  .modal-header h2 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 10px;
    padding-right: 36px;
    line-height: 1.35;
  }
  .modal-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .modal-meta-item {
    font-size: 12px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .modal-meta-item .meta-icon { font-size: 13px; opacity: 0.7; }
  .modal-close {
    position: absolute;
    top: 18px; right: 20px;
    width: 32px; height: 32px;
    border-radius: 8px;
    border: 1px solid rgba(168,85,247,0.15);
    background: rgba(168,85,247,0.06);
    color: var(--text-secondary);
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .modal-close:hover {
    background: rgba(168,85,247,0.15);
    color: var(--text-primary);
    border-color: rgba(168,85,247,0.3);
  }
  .modal-delete {
    position: absolute;
    top: 18px; right: 60px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid rgba(239,68,68,0.25);
    background: rgba(239,68,68,0.08);
    color: rgba(239,68,68,0.7);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s;
  }
  .modal-delete:hover {
    background: rgba(239,68,68,0.18);
    color: #ef4444;
    border-color: rgba(239,68,68,0.4);
  }

  /* ---------- delete confirm dialog ---------- */
  #delete-confirm-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(5, 0, 15, 0.6);
    backdrop-filter: blur(4px);
    z-index: 400;
    display: none;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  #delete-confirm-overlay.open { display: flex; opacity: 1; }
  .delete-confirm-box {
    width: 380px;
    max-width: 90vw;
    background: linear-gradient(165deg, #1a0a2e 0%, #0d0117 100%);
    border: 1px solid rgba(239,68,68,0.25);
    border-radius: 14px;
    padding: 28px 24px 22px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(239,68,68,0.06);
    transform: scale(0.95);
    transition: transform 0.2s ease;
    text-align: center;
  }
  #delete-confirm-overlay.open .delete-confirm-box { transform: scale(1); }
  .delete-confirm-icon {
    font-size: 32px;
    margin-bottom: 14px;
    opacity: 0.85;
  }
  .delete-confirm-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }
  .delete-confirm-note {
    font-size: 13px;
    color: var(--purple-lighter);
    background: rgba(168,85,247,0.08);
    border: 1px solid rgba(168,85,247,0.12);
    border-radius: 8px;
    padding: 8px 14px;
    margin: 12px 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .delete-confirm-desc {
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 20px;
  }
  .delete-confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .delete-confirm-actions button {
    height: 36px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    padding: 0 22px;
    transition: all 0.15s;
  }
  .btn-cancel {
    border: 1px solid rgba(168,85,247,0.2);
    background: rgba(168,85,247,0.06);
    color: var(--text-secondary);
  }
  .btn-cancel:hover {
    background: rgba(168,85,247,0.12);
    color: var(--text-primary);
    border-color: rgba(168,85,247,0.3);
  }
  .btn-delete-confirm {
    border: 1px solid rgba(239,68,68,0.3);
    background: rgba(239,68,68,0.15);
    color: #ef4444;
  }
  .btn-delete-confirm:hover {
    background: rgba(239,68,68,0.25);
    border-color: rgba(239,68,68,0.5);
  }
  .btn-delete-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .attendee-tag {
    background: rgba(168,85,247,0.1);
    border: 1px solid rgba(168,85,247,0.2);
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 11px;
    color: var(--purple-lighter);
  }
  .tier-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }
  .tier-badge.hotmem  { background: rgba(168,85,247,0.15); color: var(--color-hot); }
  .tier-badge.warmmem { background: rgba(124,58,237,0.15); color: var(--color-warm); }
  .tier-badge.coldmem { background: rgba(67,56,202,0.15);  color: var(--color-cold); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 28px 24px;
    display: flex;
    gap: 24px;
  }
  .modal-col-left {
    flex: 1;
    min-width: 0;
    padding-top: 20px;
  }
  .modal-col-right {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* Audio player */
  .audio-section {
    margin-top: 20px;
    padding: 16px;
    background: rgba(168,85,247,0.04);
    border: 1px solid rgba(168,85,247,0.1);
    border-radius: 12px;
  }
  .audio-section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-dim);
    margin-bottom: 10px;
  }
  .audio-player audio {
    width: 100%;
    height: 40px;
    border-radius: 8px;
    outline: none;
  }
  .audio-unavailable {
    font-size: 12px;
    color: var(--text-dim);
    font-style: italic;
    padding: 6px 0;
  }

  /* Summary & Transcript sections */
  .note-section {
    margin-top: 20px;
  }
  .note-section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-dim);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .note-section-label .sec-icon { font-size: 13px; }
  .note-text {
    font-size: 14px;
    color: var(--purple-lighter);
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .note-text.summary-text {
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.6;
    padding: 14px 16px;
    background: rgba(168,85,247,0.06);
    border-radius: 10px;
    border: 1px solid rgba(168,85,247,0.08);
    max-height: calc(92vh - 180px);
    overflow-y: auto;
    white-space: normal;
  }
  .note-text.summary-text::-webkit-scrollbar { width: 4px; }
  .note-text.summary-text::-webkit-scrollbar-track { background: transparent; }
  .note-text.summary-text::-webkit-scrollbar-thumb {
    background: rgba(168,85,247,0.2);
    border-radius: 2px;
  }
  .note-text.transcript-text {
    flex: 1;
    min-height: 200px;
    max-height: calc(92vh - 220px);
    overflow-y: auto;
    padding: 14px 16px;
    background: rgba(13,1,23,0.5);
    border-radius: 10px;
    border: 1px solid rgba(168,85,247,0.06);
    font-size: 13px;
    color: var(--purple-lighter);
  }
  .note-text.transcript-text::-webkit-scrollbar { width: 4px; }
  .note-text.transcript-text::-webkit-scrollbar-track { background: transparent; }
  .note-text.transcript-text::-webkit-scrollbar-thumb {
    background: rgba(168,85,247,0.2);
    border-radius: 2px;
  }
  .transcript-line {
    margin-bottom: 10px;
    line-height: 1.65;
    padding: 4px 8px;
    border-radius: 6px;
    border-left: 2px solid transparent;
    transition: all 0.2s ease;
    cursor: pointer;
  }
  .transcript-line:hover {
    background: rgba(168,85,247,0.06);
  }
  .transcript-line.active {
    background: rgba(168,85,247,0.1);
    border-left-color: #a855f7;
  }
  .transcript-time {
    display: inline-block;
    font-size: 10px;
    color: var(--text-dim);
    margin-right: 6px;
    font-variant-numeric: tabular-nums;
    min-width: 38px;
    opacity: 0.7;
    cursor: pointer;
  }
  .transcript-time:hover { opacity: 1; color: #a855f7; }
  .speaker-label {
    display: inline-block;
    font-weight: 600;
    border-radius: 6px;
    padding: 1px 8px;
    margin-right: 6px;
    font-size: 12px;
    letter-spacing: 0.3px;
    cursor: text;
    transition: filter 0.12s, outline 0.12s;
    /* default (used when no per-speaker color is assigned) */
    color: #c084fc;
    background: rgba(168,85,247,0.12);
    border: 1px solid rgba(168,85,247,0.22);
  }
  .speaker-label:hover {
    filter: brightness(1.15);
    outline: 1px dashed currentColor;
    outline-offset: 1px;
  }
  .speaker-label-input {
    display: inline-block;
    font-weight: 600;
    border-radius: 6px;
    padding: 1px 8px;
    margin-right: 6px;
    font-size: 12px;
    letter-spacing: 0.3px;
    background: rgba(0,0,0,0.45);
    color: var(--text-primary);
    border: 1px solid rgba(168,85,247,0.55);
    outline: none;
    width: auto;
    min-width: 80px;
    max-width: 240px;
    font-family: inherit;
  }
  .speaker-label-input:focus {
    border-color: #c084fc;
    box-shadow: 0 0 0 2px rgba(168,85,247,0.25);
  }
  .speaker-edit-hint {
    display: inline-block;
    margin-top: 3px;
    font-size: 10px;
    color: var(--text-dim);
    font-style: italic;
    line-height: 1.2;
    pointer-events: none;
    white-space: nowrap;
  }
  .note-loading-text {
    color: var(--text-dim);
    font-style: italic;
    font-size: 13px;
  }

  /* ---------- insights sidebar ---------- */
  #insights-panel {
    position: fixed;
    top: 48px; right: 0;
    width: 560px;
    height: calc(100vh - 48px);
    background: var(--panel-bg);
    border-left: 1px solid rgba(168,85,247,0.15);
    backdrop-filter: blur(12px);
    padding: 20px 16px;
    overflow-y: auto;
    z-index: 140;
    display: none;
  }
  #insights-panel h2 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 16px;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .insight-category {
    margin-bottom: 16px;
  }
  .insight-category-header {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-dim);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .insight-category-header .cat-icon { font-size: 14px; }
  .insight-category-header .cat-count {
    margin-left: auto;
    background: rgba(168,85,247,0.15);
    color: var(--text-secondary);
    border-radius: 8px;
    padding: 1px 6px;
    font-size: 10px;
  }
  .insight-item {
    font-size: 12px;
    color: var(--purple-lighter);
    line-height: 1.5;
    padding: 6px 8px;
    margin-bottom: 4px;
    background: rgba(168,85,247,0.05);
    border-radius: 5px;
    border-left: 2px solid transparent;
    cursor: default;
  }
  .insight-item.todo { border-left-color: #f59e0b; }
  .insight-item.reminder { border-left-color: #ef4444; }
  .insight-item.achievement { border-left-color: #22c55e; }
  .insight-item.suggestion { border-left-color: #3b82f6; }
  .insight-item .insight-meta {
    font-size: 10px;
    color: var(--text-dim);
    margin-top: 2px;
  }
  .topic-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .topic-tag {
    background: rgba(168,85,247,0.1);
    border: 1px solid rgba(168,85,247,0.2);
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 11px;
    color: var(--purple-lighter);
    white-space: nowrap;
  }
  .topic-tag .topic-count {
    color: var(--text-dim);
    font-size: 10px;
    margin-left: 4px;
  }
  .insights-empty {
    font-size: 12px;
    color: var(--text-dim);
    font-style: italic;
    padding: 8px 0;
  }

  /* ---------- wiki view ---------- */
  #wiki-view {
    position: fixed;
    top: 48px; left: 0; right: 560px; bottom: 0;
    background: linear-gradient(165deg, #1a0a2e 0%, #0d0117 100%);
    overflow-y: auto;
    display: none;
    padding: 20px 32px;
    z-index: 130;
  }
  #wiki-view::-webkit-scrollbar { width: 6px; }
  #wiki-view::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.2); border-radius: 3px; }

  .wiki-search {
    max-width: 480px;
    margin: 0 auto 24px;
    display: flex;
  }
  .wiki-search input {
    flex: 1;
    background: rgba(168,85,247,0.06);
    border: 1px solid rgba(168,85,247,0.2);
    border-radius: 20px;
    padding: 10px 16px;
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
  }
  .wiki-search input::placeholder { color: var(--text-dim); }
  .wiki-search input:focus { border-color: rgba(168,85,247,0.4); }

  .wiki-categories {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
    max-width: 1200px;
    margin: 0 auto;
  }
  .wiki-category-card {
    background: rgba(168,85,247,0.04);
    border: 1px solid rgba(168,85,247,0.12);
    border-radius: 12px;
    padding: 16px;
  }
  .wiki-category-header {
    font-size: 13px;
    font-weight: 600;
    color: var(--purple-light);
    margin-bottom: 10px;
    text-transform: capitalize;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .wiki-category-count {
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 400;
  }
  .wiki-entry {
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wiki-entry:hover { background: rgba(168,85,247,0.08); }
  .wiki-entry-title {
    font-size: 13px;
    color: var(--text-primary);
    flex: 1;
  }
  .wiki-entry-snippet {
    font-size: 11px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }
  .wiki-empty {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-dim);
    font-size: 14px;
  }

  .wiki-src-link {
    color: rgba(168,85,247,0.6);
    font-size: 11px;
    text-decoration: none;
    cursor: pointer;
    transition: color 0.15s;
  }
  .wiki-src-link:hover { color: var(--purple-light); text-decoration: underline; }

  /* ---------- ask hidock ---------- */
  #ask-hidock-bar {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: 480px;
    max-width: 90vw;
    display: none;
    align-items: center;
    gap: 8px;
    background: rgba(15,10,30,0.92);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(168,85,247,0.25);
    border-radius: 24px;
    padding: 6px 6px 6px 18px;
    z-index: 200;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  #ask-hidock-bar input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
    font-family: inherit;
  }
  #ask-hidock-bar input::placeholder { color: var(--text-dim); }
  #ask-hidock-bar button {
    background: rgba(168,85,247,0.2);
    border: 1px solid rgba(168,85,247,0.3);
    border-radius: 18px;
    color: var(--purple-light);
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  #ask-hidock-bar button:hover {
    background: rgba(168,85,247,0.3);
  }

  #ask-hidock-panel {
    position: fixed;
    top: 48px; right: 0;
    width: 560px;
    height: calc(100vh - 48px);
    background: var(--panel-bg);
    border-left: 1px solid rgba(168,85,247,0.15);
    backdrop-filter: blur(12px);
    padding: 20px 16px;
    overflow-y: auto;
    z-index: 160;
    display: none;
  }
  .ask-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .ask-panel-header h2 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }
  #ask-query-display {
    font-size: 14px;
    color: var(--purple-lighter);
    background: rgba(168,85,247,0.06);
    border: 1px solid rgba(168,85,247,0.12);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 16px;
  }
  #ask-sources {
    margin-bottom: 16px;
  }
  .ask-source-item {
    font-size: 11px;
    color: var(--text-dim);
    padding: 3px 0;
    cursor: pointer;
  }
  .ask-source-item:hover { color: var(--purple-lighter); }
  #ask-answer {
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-primary);
  }
  #ask-answer p { margin: 8px 0; }
  .ask-typing-cursor {
    display: inline-block;
    width: 2px;
    height: 14px;
    background: var(--purple-light);
    animation: blink 0.8s infinite;
    vertical-align: text-bottom;
  }
  @keyframes blink { 50% { opacity: 0; } }

  /* ---------- view tabs ---------- */
  #view-tabs {
    position: fixed;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 150;
    display: none;
    background: rgba(13, 1, 23, 0.85);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(168,85,247,0.2);
    border-radius: 20px;
    padding: 3px;
    gap: 2px;
  }
  .view-tab {
    padding: 5px 18px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
    background: transparent;
    border: none;
    border-radius: 17px;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }
  .view-tab:hover {
    color: var(--text-secondary);
  }
  .view-tab.active {
    background: rgba(168,85,247,0.2);
    color: var(--text-primary);
    box-shadow: 0 0 12px rgba(168,85,247,0.15);
  }

  /* ---------- list view ---------- */
  #list-view {
    position: fixed;
    top: 48px; left: 0; right: 560px; bottom: 0;
    background: linear-gradient(165deg, #1a0a2e 0%, #0d0117 100%);
    overflow-y: auto;
    display: none;
    padding: 20px 32px;
  }
  #list-view::-webkit-scrollbar { width: 6px; }
  #list-view::-webkit-scrollbar-track { background: transparent; }
  #list-view::-webkit-scrollbar-thumb {
    background: rgba(168,85,247,0.2);
    border-radius: 3px;
  }

  .list-search {
    max-width: 480px;
    margin: 0 auto 20px;
    display: flex;
  }
  .list-search input {
    flex: 1;
    background: rgba(168,85,247,0.06);
    border: 1px solid rgba(168,85,247,0.15);
    border-radius: 10px;
    padding: 10px 16px;
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
    transition: border-color 0.2s;
  }
  .list-search input::placeholder { color: var(--text-dim); }
  .list-search input:focus { border-color: rgba(168,85,247,0.4); }

  .list-table {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    border-collapse: separate;
    border-spacing: 0 4px;
  }
  .list-table thead th {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-dim);
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(168,85,247,0.1);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  .list-table thead th:hover { color: var(--text-secondary); }
  .list-table thead th .sort-arrow { margin-left: 4px; font-size: 9px; }
  .list-table tbody tr {
    cursor: pointer;
    transition: background 0.15s;
  }
  .list-table tbody tr:hover {
    background: rgba(168,85,247,0.08);
  }
  .list-table tbody tr.list-row-new {
    background: rgba(168,85,247,0.12);
    animation: list-row-glow 2s ease-in-out infinite;
  }
  .list-table tbody tr.list-row-new td:first-child {
    border-left: 3px solid #a855f7;
    padding-left: 9px;
  }
  @keyframes list-row-glow {
    0%, 100% { background: rgba(168,85,247,0.12); }
    50% { background: rgba(168,85,247,0.22); }
  }
  /* Pending device file rows: untranscribed recordings still on the device */
  .list-table tbody tr.list-row-pending td {
    color: var(--text-dim);
    font-style: italic;
    cursor: default;
  }
  .list-table tbody tr.list-row-pending:hover {
    background: rgba(168,85,247,0.04);
  }
  /* Inline recorder badge in the title cell, e.g. "P1", "H1E" */
  .recorder-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    color: #c084fc;
    background: rgba(168,85,247,0.15);
    border: 1px solid rgba(168,85,247,0.30);
    border-radius: 4px;
    padding: 1px 5px;
    margin-right: 6px;
    vertical-align: middle;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-style: normal;
  }
  .pending-filename {
    color: var(--text-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    font-style: normal;
  }
  /* Inline per-row delete button — only visible on row hover. */
  .list-row-delete {
    background: transparent;
    border: 1px solid rgba(239,68,68,0.30);
    color: rgba(239,68,68,0.85);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    visibility: hidden;
    transition: background 0.12s, color 0.12s;
  }
  .list-table tbody tr:hover .list-row-delete {
    visibility: visible;
  }
  .list-row-delete:hover {
    background: rgba(239,68,68,0.15);
    color: #ef4444;
  }
  .list-action-cell {
    width: 1%;
    text-align: right;
    white-space: nowrap;
  }
  .list-table tbody td {
    padding: 10px 12px;
    font-size: 13px;
    color: var(--text-primary);
    border-bottom: 1px solid rgba(168,85,247,0.04);
    vertical-align: middle;
  }
  .list-src-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
    flex-shrink: 0;
  }
  .list-title-cell {
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .list-brief-cell {
    color: var(--text-secondary);
    font-size: 12px;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list-tier-cell .tier-badge { font-size: 10px; }
  .list-attendee-cell {
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list-date-cell {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .list-empty {
    text-align: center;
    padding: 40px;
    color: var(--text-dim);
    font-size: 14px;
    font-style: italic;
  }

  /* ---------- legend ---------- */
  #legend {
    position: fixed;
    bottom: 16px; left: 16px;
    background: var(--panel-bg);
    border: 1px solid rgba(168,85,247,0.15);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 11px;
    z-index: 100;
    backdrop-filter: blur(6px);
    line-height: 1.7;
  }
  #legend h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-dim);
    margin-bottom: 6px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
  }
  .legend-card {
    display: inline-block;
    width: 16px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .legend-line {
    display: inline-block;
    width: 18px;
    height: 2px;
    flex-shrink: 0;
    border-radius: 1px;
  }

  /* ---------- pulsing glow ---------- */
  @keyframes pulse-glow {
    0%, 100% { filter: drop-shadow(0 0 4px rgba(168,85,247,0.6)); }
    50% { filter: drop-shadow(0 0 12px rgba(168,85,247,0.9)) drop-shadow(0 0 20px var(--purple)); }
  }
  .node-new { animation: pulse-glow 2s ease-in-out infinite; }

  /* ---------- memcard text ---------- */
  .memcard-title {
    font-size: 9px;
    font-weight: 600;
    fill: var(--text-primary);
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .memcard-date {
    font-size: 7px;
    font-weight: 400;
    fill: var(--text-dim);
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }

  /* ---------- star field ---------- */
  @keyframes twinkle {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
</style>
</head>
<body>

<!-- Syncing overlay -->
<div id="syncing-overlay">
  <div class="sync-ring"></div>
  <div class="sync-ring"></div>
  <div class="sync-ring"></div>
  <div class="sync-orb"></div>
  <div class="sync-title">Syncing HiDock device</div>
  <div class="sync-status" id="sync-status-text">Connecting to device<span class="sync-dots"></span></div>
  <div class="sync-progress" id="sync-progress" style="display:none;">
    <div class="sync-progress-header">
      <span id="sync-progress-label">Processing...</span>
      <span id="sync-progress-pct"></span>
      <span id="sync-progress-count"></span>
    </div>
    <div class="sync-progress-bar"><div class="sync-progress-fill" id="sync-progress-fill" style="width:0%"></div></div>
    <div id="sync-file-list"></div>
  </div>
</div>

<!-- Sync popup (shown over Galaxy view when new recordings detected) -->
<div id="sync-popup" class="sync-popup hidden">
  <div class="sync-popup-header">
    <span class="sync-popup-title">Syncing new recordings</span>
    <span id="sync-popup-pct"></span>
  </div>
  <div class="sync-progress-bar"><div class="sync-popup-fill" id="sync-popup-fill" style="width:0%"></div></div>
  <div id="sync-popup-files" class="sync-popup-files"></div>
</div>

<!-- Galaxy UI (hidden during sync) -->
<div id="header" style="display:none;">
  <h1>HiDock, Your Private Meeting Memory</h1>
  <div class="stats" id="stats-bar"></div>
</div>

<div id="view-tabs">
  <button class="view-tab active" data-view="galaxy" onclick="switchView('galaxy')">Galaxy</button>
  <button class="view-tab" data-view="list" onclick="switchView('list')">List</button>
  <button class="view-tab" data-view="wiki" onclick="switchView('wiki')">Wiki</button>
</div>

<div id="wiki-view">
  <div class="wiki-search"><input type="text" id="wiki-search-input" placeholder="Search wiki..." oninput="filterWiki(this.value)"></div>
  <div id="wiki-categories" class="wiki-categories">${wikiCategoriesHtml || '<div class="wiki-empty">No wiki content yet. Sync some recordings to build the knowledge base.</div>'}</div>
</div>

<div id="list-view">
  <div class="list-search">
    <input type="text" id="list-search-input" placeholder="Search notes..." oninput="filterList(this.value)">
  </div>
  <table class="list-table">
    <thead>
      <tr>
        <th onclick="sortList('dateTime')">Date <span class="sort-arrow" id="sort-dateTime">&#x25BC;</span></th>
        <th onclick="sortList('title')">Title <span class="sort-arrow" id="sort-title"></span></th>
        <th onclick="sortList('brief')">Brief <span class="sort-arrow" id="sort-brief"></span></th>
        <th onclick="sortList('tier')">Tier <span class="sort-arrow" id="sort-tier"></span></th>
        <th onclick="sortList('attendees')">Attendees <span class="sort-arrow" id="sort-attendees"></span></th>
        <th onclick="sortList('sourceType')">Type <span class="sort-arrow" id="sort-sourceType"></span></th>
        <th class="list-action-cell"></th>
      </tr>
    </thead>
    <tbody id="list-tbody"></tbody>
  </table>
</div>

<div id="tooltip">
  <div class="tt-title"></div>
  <div class="tt-date"></div>
  <div class="tt-brief"></div>
</div>

<div id="note-overlay">
  <div id="note-modal">
    <div class="modal-header">
      <button class="modal-delete" id="nm-delete-btn">&#x1f5d1; Delete</button>
      <button class="modal-close" onclick="closeNoteModal()">&times;</button>
      <h2 id="nm-title"></h2>
      <div class="modal-meta">
        <span class="modal-meta-item"><span class="meta-icon">&#x1f4c5;</span> <span id="nm-date"></span></span>
        <span id="nm-tier"></span>
        <span class="modal-meta-item" id="nm-kind-wrap"><span class="meta-icon">&#x1f3a4;</span> <span id="nm-kind"></span></span>
      </div>
      <div class="modal-meta" style="margin-top:8px;" id="nm-attendees-wrap"></div>
    </div>
    <div class="modal-body">
      <div class="modal-col-left">
        <div class="note-section">
          <div class="note-section-label"><span class="sec-icon">&#x2728;</span> Summary</div>
          <div class="note-text summary-text" id="nm-summary"></div>
        </div>
      </div>
      <div class="modal-col-right">
        <div class="audio-section" id="nm-audio-section">
          <div class="audio-section-label">&#x1f50a; Audio Recording</div>
          <div class="audio-player" id="nm-audio-player"></div>
        </div>
        <div class="note-section" style="flex:1; display:flex; flex-direction:column;">
          <div class="note-section-label"><span class="sec-icon">&#x1f399;</span> Transcript</div>
          <div class="note-text transcript-text" id="nm-transcript"></div>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="ask-hidock-bar">
  <input type="text" id="ask-input" placeholder="Ask HiDock anything..." onkeydown="if(event.key==='Enter')askHiDock()">
  <button onclick="askHiDock()">Ask</button>
</div>

<div id="ask-hidock-panel">
  <div class="ask-panel-header">
    <h2>&#x2728; AskHiDock</h2>
    <button class="modal-close" onclick="closeAskPanel()">&times;</button>
  </div>
  <div id="ask-query-display"></div>
  <div id="ask-sources"></div>
  <div id="ask-answer"></div>
</div>

<div id="delete-confirm-overlay">
  <div class="delete-confirm-box">
    <div class="delete-confirm-icon">&#x1f5d1;</div>
    <div class="delete-confirm-title">Delete this note?</div>
    <div class="delete-confirm-note" id="dc-note-title"></div>
    <div class="delete-confirm-desc">This will permanently remove the note, audio recording, and index entry.</div>
    <div class="delete-confirm-actions">
      <button class="btn-cancel" id="dc-cancel">Cancel</button>
      <button class="btn-delete-confirm" id="dc-confirm">Delete</button>
    </div>
  </div>
</div>

<div id="insights-panel">
  <h2><span>&#x2728;</span> Hot Memory Analysis</h2>
  <div id="insights-topics"></div>
  <div id="insights-todos"></div>
  <div id="insights-reminders"></div>
  <div id="insights-achievements"></div>
  <div id="insights-suggestions"></div>
</div>

<div id="legend" style="display:none;">
  <h3>Tiers</h3>
  <div class="legend-item"><span class="legend-card" style="background:rgba(168,85,247,0.15); border:1px solid var(--color-hot);"></span> Hot (recent)</div>
  <div class="legend-item"><span class="legend-card" style="background:rgba(124,58,237,0.15); border:1px solid var(--color-warm);"></span> Warm</div>
  <div class="legend-item"><span class="legend-card" style="background:rgba(67,56,202,0.15); border:1px solid var(--color-cold);"></span> Cold (old)</div>
  <div class="legend-item"><span class="legend-card" style="background:rgba(255,68,68,0.15); border:1px solid var(--color-new); box-shadow:0 0 6px rgba(255,68,68,0.4);"></span> New note</div>
  <h3 style="margin-top:10px;">Source</h3>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-rec);"></span> Call</div>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-whsp);"></span> Whisper</div>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-room);"></span> Room</div>
  <h3 style="margin-top:10px;">Relationships</h3>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-series); height:3px;"></span> Same series</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-project);"></span> Same project/topic</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-attendee);"></span> Shared attendee</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-sameday);"></span> Same day</div>
</div>

<svg id="galaxy-svg" style="display:none;"></svg>

<script>var GALAXY_DATA = ${dataJson}; var WIKI_INDEX = ${wikiJson};</script>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
  "use strict";

  /* ====================================================================
   * STATE MACHINE: syncing → ready
   * ==================================================================== */
  var pollTimer = null;

  function boot() {
    if (GALAXY_DATA && GALAXY_DATA.nodes && GALAXY_DATA.nodes.length > 0) {
      try {
        transitionToGalaxy(GALAXY_DATA);
      } catch (e) {
        console.error("transitionToGalaxy failed:", e);
        startPolling();
      }
    } else {
      startPolling();
    }
  }

  var STATUS_LABELS = {
    downloading: "Downloading",
    transcribing: "Transcribing",
    summarizing: "Summarizing",
    saved: "Saved",
    skipped: "Skipped",
    failed: "Failed",
    pending: "Pending"
  };

  function pollOnce() {
    fetch("/progress").then(function(r) { return r.json(); }).then(function(p) {
      updateSyncProgress(p);
    }).catch(function() {});

    fetch("/data.json").then(function(res) {
      if (res.status === 200) {
        return res.json();
      }
      return null;
    }).then(function(data) {
      if (data && data.nodes) {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        GALAXY_DATA = data;
        transitionToGalaxy(data);
      }
    }).catch(function() { /* ignore, retry */ });
  }

  function startPolling() {
    pollOnce(); // immediate first check — avoids flash when data already exists
    pollTimer = setInterval(pollOnce, 1500);
  }

  function updateSyncProgress(p) {
    if (!p || !p.phase) return;
    var statusText = document.getElementById("sync-status-text");
    var progressEl = document.getElementById("sync-progress");

    if (p.phase === "connecting") {
      statusText.innerHTML = 'Connecting to device<span class="sync-dots"></span>';
      progressEl.style.display = "none";
      return;
    }

    if (p.phase === "processing" && p.total > 0) {
      var done = p.items.filter(function(i) { return i.status === "saved" || i.status === "skipped" || i.status === "failed"; }).length;
      statusText.innerHTML = 'Processing ' + p.total + ' recordings<span class="sync-dots"></span>';
      progressEl.style.display = "block";
      document.getElementById("sync-progress-label").textContent = p.current + " of " + p.total;
      // Smooth progress: sum per-item progressPercent
      var totalPct = 0;
      p.items.forEach(function(item) { totalPct += (item.progressPercent || 0); });
      var pct = p.total > 0 ? Math.round(totalPct / p.total) : 0;
      document.getElementById("sync-progress-pct").textContent = pct + "%";
      document.getElementById("sync-progress-count").textContent = done + " done";
      document.getElementById("sync-progress-fill").style.width = pct + "%";

      // Render file list: active/completed items first, then pending (all visible, scrollable)
      var active = p.items.filter(function(i) { return i.status !== "pending"; });
      var pending = p.items.filter(function(i) { return i.status === "pending"; });
      var ordered = active.concat(pending);
      var html = "";
      ordered.forEach(function(item) {
        var shortName = item.fileName.replace(/\\.hda$/i, "");
        var statusClass = item.status;
        var statusLabel = STATUS_LABELS[item.status] || item.status;
        var isActive = item.status === "downloading" || item.status === "transcribing" || item.status === "summarizing";
        html += '<div class="sync-file-item' + (isActive ? ' active' : '') + '">';
        html += '<span class="sync-file-name">' + escHtml(shortName) + '</span>';
        html += '<span class="sync-file-status ' + statusClass + '">' + statusLabel + '</span>';
        html += '</div>';
      });
      var listEl = document.getElementById("sync-file-list");
      listEl.innerHTML = html;
      // Auto-scroll to the active item
      var activeItem = listEl.querySelector(".sync-file-item.active");
      if (activeItem) activeItem.scrollIntoView({ block: "nearest" });
    }

    if (p.phase === "done") {
      statusText.innerHTML = 'Sync complete, loading galaxy<span class="sync-dots"></span>';
    }
  }

  // Keep polling progress even on Galaxy view — show popup for new syncs
  var galaxyPollTimer = null;
  function startGalaxyProgressPoll() {
    if (galaxyPollTimer) return;
    galaxyPollTimer = setInterval(function() {
      fetch("/progress").then(function(r) { return r.json(); }).then(function(p) {
        updateSyncPopup(p);
      }).catch(function() {});
    }, 1500);
  }

  var lastSyncPopupPhase = null;
  function updateSyncPopup(p) {
    var popup = document.getElementById("sync-popup");
    if (!popup) return;

    // Show popup when processing, hide when done/connecting with no items
    if (p.phase === "processing" && p.total > 0) {
      lastSyncPopupPhase = "processing";
      popup.classList.remove("hidden");
      var totalPct = 0;
      p.items.forEach(function(item) { totalPct += (item.progressPercent || 0); });
      var pct = p.total > 0 ? Math.round(totalPct / p.total) : 0;
      document.getElementById("sync-popup-pct").textContent = pct + "%";
      document.getElementById("sync-popup-fill").style.width = pct + "%";
      // Show active items only (not pending)
      var active = p.items.filter(function(i) { return i.status !== "pending"; });
      var html = "";
      active.slice(-6).forEach(function(item) {
        var shortName = item.fileName.replace(/\\.hda$/i, "");
        var statusLabel = STATUS_LABELS[item.status] || item.status;
        html += '<div class="sync-file-item">';
        html += '<span class="sync-file-name">' + escHtml(shortName) + '</span>';
        html += '<span class="sync-file-status ' + item.status + '">' + statusLabel + '</span>';
        html += '</div>';
      });
      document.getElementById("sync-popup-files").innerHTML = html;
    } else if (p.phase === "done" && lastSyncPopupPhase !== "done") {
      lastSyncPopupPhase = "done";
      popup.classList.add("hidden");
      // Refresh galaxy data once when sync finishes
      fetch("/data.json").then(function(res) {
        if (res.status === 200) return res.json();
        return null;
      }).then(function(data) {
        if (data && data.nodes) {
          GALAXY_DATA = data;
          transitionToGalaxy(data);
        }
      }).catch(function() {});
    } else if (p.phase === "connecting" && p.total === 0) {
      // No active sync — keep popup hidden
    }
  }

  function transitionToGalaxy(data) {
    // Start polling for sync progress (popup mode)
    startGalaxyProgressPoll();

    // Update stats bar
    var totalNotes = data.nodes.length;
    var newNotes = data.nodes.filter(function(n) { return n.isNew; }).length;
    var hotCount = data.nodes.filter(function(n) { return n.tier === "hotmem"; }).length;
    var warmCount = data.nodes.filter(function(n) { return n.tier === "warmmem"; }).length;
    var coldCount = data.nodes.filter(function(n) { return n.tier === "coldmem"; }).length;

    document.getElementById("stats-bar").innerHTML =
      '<span><span class="stat-label">Total </span>' + totalNotes + '</span>' +
      '<span><span class="stat-label">New </span><span class="stat-new">' + newNotes + '</span></span>' +
      '<span><span class="stat-label">Hot </span><span class="stat-hot">' + hotCount + '</span></span>' +
      '<span><span class="stat-label">Warm </span><span class="stat-warm">' + warmCount + '</span></span>' +
      '<span><span class="stat-label">Cold </span><span class="stat-cold">' + coldCount + '</span></span>';

    // Hide syncing overlay
    document.getElementById("syncing-overlay").classList.add("hidden");

    // Show galaxy UI
    document.getElementById("header").style.display = "flex";
    document.getElementById("view-tabs").style.display = "flex";
    document.getElementById("legend").style.display = "block";
    document.getElementById("galaxy-svg").style.display = "block";
    document.getElementById("insights-panel").style.display = "block";
    document.getElementById("ask-hidock-bar").style.display = "flex";

    // Populate insights
    renderInsights(data.insights);

    // Build list view data + immediately re-render rows so deletes and
    // device-file refreshes are reflected without requiring a tab switch.
    buildListView(data);
    renderListRows();

    // Start the periodic /data.json poll so device-file updates from the
    // watcher's file-poll loop appear automatically (recorder badges,
    // pending rows). Idempotent.
    startGalaxyDataPoll();

    // Render galaxy
    setTimeout(function() { renderGalaxy(data); }, 100);
  }

  // Periodic /data.json refresh while on the galaxy view. Used for keeping
  // the list view's device files (recorder badges + pending rows) in sync
  // with the watcher's file-poll loop. Only re-renders the list view — never
  // touches the galaxy SVG, which is expensive.
  var galaxyDataPollTimer = null;
  function startGalaxyDataPoll() {
    if (galaxyDataPollTimer) return;
    galaxyDataPollTimer = setInterval(function() {
      fetch("/data.json").then(function(r) {
        return r.status === 200 ? r.json() : null;
      }).then(function(data) {
        if (!data || !data.nodes || !GALAXY_DATA) return;
        // Cheap change detection: compare device-file count + first/last
        // filename. Avoids rebuilding the list when nothing changed.
        var oldDF = GALAXY_DATA.deviceFiles || [];
        var newDF = data.deviceFiles || [];
        var changed = oldDF.length !== newDF.length;
        if (!changed && newDF.length > 0) {
          if ((oldDF[0] && oldDF[0].fileName) !== (newDF[0] && newDF[0].fileName)) changed = true;
          if (!changed && (oldDF[oldDF.length - 1] && oldDF[oldDF.length - 1].fileName) !== (newDF[newDF.length - 1] && newDF[newDF.length - 1].fileName)) changed = true;
          // Also compare transcribed counts so edits flow through
          if (!changed) {
            var oldT = oldDF.filter(function(d) { return d.isTranscribed; }).length;
            var newT = newDF.filter(function(d) { return d.isTranscribed; }).length;
            if (oldT !== newT) changed = true;
          }
        }
        if (changed) {
          GALAXY_DATA.deviceFiles = newDF;
          buildListView(GALAXY_DATA);
          renderListRows();
        }
      }).catch(function() { /* swallow — retry next tick */ });
    }, 10000); // 10s — slightly faster than the watcher's 15s file-poll cadence
  }

  /* ====================================================================
   * INSIGHTS RENDERER
   * ==================================================================== */
  function renderInsights(insights) {
    if (!insights) return;

    // Top topics
    var topicsEl = document.getElementById("insights-topics");
    if (insights.topTopics && insights.topTopics.length > 0) {
      var topicsHtml = '<div class="insight-category">';
      topicsHtml += '<div class="insight-category-header"><span class="cat-icon">&#x1f4ca;</span> Hot Topics</div>';
      topicsHtml += '<div class="topic-cloud">';
      insights.topTopics.forEach(function(t) {
        topicsHtml += '<span class="topic-tag">' + escHtml(t.topic) + '<span class="topic-count">\\u00d7' + t.count + '</span></span>';
      });
      topicsHtml += '</div></div>';
      topicsEl.innerHTML = topicsHtml;
    }

    // Render each insight category
    var categories = [
      { key: "todos",        el: "insights-todos",        icon: "&#x2705;", label: "Action Items" },
      { key: "reminders",    el: "insights-reminders",    icon: "&#x23f0;", label: "Reminders" },
      { key: "achievements", el: "insights-achievements", icon: "&#x1f3c6;", label: "Achievements" },
      { key: "suggestions",  el: "insights-suggestions",  icon: "&#x1f4a1;", label: "Suggestions" },
    ];

    categories.forEach(function(cat) {
      var items = insights[cat.key];
      var el = document.getElementById(cat.el);
      if (!items || items.length === 0) {
        el.innerHTML = "";
        return;
      }
      var html = '<div class="insight-category">';
      html += '<div class="insight-category-header"><span class="cat-icon">' + cat.icon + '</span> ' + cat.label;
      html += '<span class="cat-count">' + items.length + '</span></div>';
      items.slice(0, 5).forEach(function(item) {
        html += '<div class="insight-item ' + cat.key.slice(0, -1) + '">';
        html += escHtml(item.text);
        html += '<div class="insight-meta">' + escHtml(item.noteTitle) + ' \\u2014 ' + escHtml(item.noteDate.slice(0, 10)) + '</div>';
        html += '</div>';
      });
      if (items.length > 5) {
        html += '<div class="insight-item" style="color:var(--text-dim);font-style:italic;">+' + (items.length - 5) + ' more</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    });
  }

  function escHtml(text) {
    var div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  /* ====================================================================
   * VIEW SWITCHING
   * ==================================================================== */
  var currentView = "galaxy";
  var listNodes = [];
  var listSortKey = "dateTime";
  var listSortAsc = false;
  var listFilter = "";

  window.switchView = function(view) {
    if (view === currentView) return;
    currentView = view;

    var tabs = document.querySelectorAll(".view-tab");
    tabs.forEach(function(t) { t.classList.toggle("active", t.getAttribute("data-view") === view); });

    document.getElementById("galaxy-svg").style.display = view === "galaxy" ? "block" : "none";
    document.getElementById("legend").style.display = view === "galaxy" ? "block" : "none";
    document.getElementById("list-view").style.display = view === "list" ? "block" : "none";
    document.getElementById("wiki-view").style.display = view === "wiki" ? "block" : "none";

    if (view === "list") renderListRows();
    if (view === "wiki") loadWikiData();
  };

  /* ====================================================================
   * LIST VIEW
   * ==================================================================== */
  var SOURCE_TYPE_LABELS = { rec: "Call", wip: "Whisper", room: "Room", call: "Call", whsp: "Whisper" };
  var LIST_SRC_COLORS = { rec: "#22c55e", wip: "#3b82f6", room: "#f59e0b", call: "#22c55e", whsp: "#3b82f6" };

  function buildListView(data) {
    listNodes = data.nodes.map(function(n) { return Object.assign({}, n); });

    // Merge device file list (from watcher's file-poll) into the list view.
    // Each device file is either:
    //   (a) transcribed -> already a node; we just stamp recorderName onto it
    //   (b) pending     -> add as a new "pending" row with empty title/brief
    var deviceFiles = (data && data.deviceFiles) || [];
    if (deviceFiles.length > 0) {
      var byNoteId = {};
      var byNoteSource = {};
      var pendingFiles = [];
      deviceFiles.forEach(function(df) {
        if (df.isTranscribed && df.noteId) {
          byNoteId[df.noteId] = df.deviceName;
        } else if (!df.isTranscribed) {
          pendingFiles.push(df);
        }
        // Also index by fileName for fallback matching against node.source
        byNoteSource[df.fileName] = df.deviceName;
      });

      // Stamp recorderName onto matching nodes
      listNodes.forEach(function(n) {
        if (byNoteId[n.id]) {
          n.recorderName = byNoteId[n.id];
        } else if (n.source && byNoteSource[n.source]) {
          n.recorderName = byNoteSource[n.source];
        }
      });

      // Append pending rows (untranscribed device files)
      pendingFiles.forEach(function(df) {
        listNodes.push({
          id: "devfile:" + df.fileName,
          title: "",
          brief: "",
          dateTime: df.modifiedAt || "",
          attendees: [],
          tier: "",
          sourceType: "pending",
          recorderName: df.deviceName,
          isPending: true,
          fileName: df.fileName,
        });
      });
    }

    listNodes.sort(function(a, b) { return (b.dateTime || "").localeCompare(a.dateTime || ""); });
  }

  // Strip "HiDock_" / "HiDock " prefix and return a short label, e.g.
  // "HiDock_P1" -> "P1", "HiDock H1E" -> "H1E", "Unknown HiDock" -> "?"
  function shortRecorderLabel(name) {
    if (!name) return "";
    var s = String(name).replace(/^HiDock[_\\s]?/i, "").trim();
    if (!s || /unknown/i.test(name)) return "?";
    return s;
  }

  function getFilteredNodes() {
    var q = listFilter.toLowerCase();
    var filtered = listNodes;
    if (q) {
      filtered = listNodes.filter(function(n) {
        return (n.title || "").toLowerCase().indexOf(q) >= 0 ||
               (n.brief || "").toLowerCase().indexOf(q) >= 0 ||
               (n.attendees || []).join(" ").toLowerCase().indexOf(q) >= 0 ||
               (n.dateTime || "").toLowerCase().indexOf(q) >= 0 ||
               (SOURCE_TYPE_LABELS[n.sourceType] || "").toLowerCase().indexOf(q) >= 0;
      });
    }
    var key = listSortKey;
    var asc = listSortAsc;
    filtered.sort(function(a, b) {
      var va, vb;
      if (key === "attendees") {
        va = (a.attendees || []).join(", ");
        vb = (b.attendees || []).join(", ");
      } else {
        va = a[key] || "";
        vb = b[key] || "";
      }
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return 0;
    });
    return filtered;
  }

  function renderListRows() {
    var tbody = document.getElementById("list-tbody");
    var nodes = getFilteredNodes();
    if (nodes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="list-empty">No matching notes</td></tr>';
      return;
    }
    var html = "";
    nodes.forEach(function(n) {
      var isPending = !!n.isPending;
      var srcColor = LIST_SRC_COLORS[n.sourceType] || LIST_SRC_COLORS.rec;
      var srcLabel = isPending
        ? "Pending"
        : (SOURCE_TYPE_LABELS[n.sourceType] || "Meeting");
      var attendeeStr = (n.attendees || []).join(", ") || (isPending ? "" : "—");
      var dateStr = (n.dateTime || "").slice(0, 16).replace("T", " ");

      // Inline recorder badge (P1 / H1E / H1) for any row whose underlying file
      // came from a recognized HiDock device.
      var recorderHtml = "";
      if (n.recorderName) {
        var label = shortRecorderLabel(n.recorderName);
        recorderHtml = '<span class="recorder-badge" title="' + escAttr(n.recorderName) + '">' + escHtml(label) + '</span>';
      }

      // Pending rows: empty title/brief, italic gray styling, no click handler.
      // Title cell still shows the raw filename as a hint after the badge.
      var rowClasses = [];
      if (n.isNew) rowClasses.push("list-row-new");
      if (isPending) rowClasses.push("list-row-pending");
      var classAttr = rowClasses.length > 0 ? ' class="' + rowClasses.join(" ") + '"' : "";
      var clickAttr = isPending ? "" : ' onclick="listRowClick(\\'' + escAttr(n.id) + '\\')"';

      var titleContent;
      if (isPending) {
        // Show filename as a faint hint so the user can identify the recording,
        // but keep title and brief functionally empty per requirement.
        titleContent = recorderHtml + '<span class="pending-filename">' + escHtml(n.fileName || "") + '</span>';
      } else {
        titleContent = '<span class="list-src-dot" style="background:' + srcColor + '"></span>' + recorderHtml + escHtml(n.title || "Untitled");
      }

      var tierCell = isPending
        ? '<td class="list-tier-cell">—</td>'
        : '<td class="list-tier-cell"><span class="tier-badge ' + n.tier + '">' + n.tier + '</span></td>';

      // Action cell: delete button for transcribed rows only.
      // Pending device-file rows have no note to delete (they are just file
      // entries on the device), so the button is suppressed.
      var actionCell;
      if (isPending) {
        actionCell = '<td class="list-action-cell"></td>';
      } else {
        actionCell = '<td class="list-action-cell">'
          + '<button class="list-row-delete" onclick="event.stopPropagation(); listRowDelete(\\'' + escAttr(n.id) + '\\');" title="Delete this note">&#x1f5d1; Delete</button>'
          + '</td>';
      }

      html += '<tr' + classAttr + clickAttr + '>';
      html += '<td class="list-date-cell">' + escHtml(dateStr) + '</td>';
      html += '<td><div class="list-title-cell">' + titleContent + '</div></td>';
      html += '<td class="list-brief-cell" title="' + escAttr(n.brief || "") + '">' + escHtml(n.brief || "") + '</td>';
      html += tierCell;
      html += '<td class="list-attendee-cell" title="' + escAttr(attendeeStr) + '">' + escHtml(attendeeStr) + '</td>';
      html += '<td>' + escHtml(srcLabel) + '</td>';
      html += actionCell;
      html += '</tr>';
    });
    tbody.innerHTML = html;
  }

  function escAttr(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  window.filterList = function(query) {
    listFilter = query;
    renderListRows();
  };

  window.sortList = function(key) {
    if (listSortKey === key) {
      listSortAsc = !listSortAsc;
    } else {
      listSortKey = key;
      listSortAsc = key === "title" || key === "sourceType";
    }
    // Update sort arrows
    ["dateTime", "title", "brief", "tier", "attendees", "sourceType"].forEach(function(k) {
      var el = document.getElementById("sort-" + k);
      if (el) el.innerHTML = k === listSortKey ? (listSortAsc ? "&#x25B2;" : "&#x25BC;") : "";
    });
    renderListRows();
  };

  window.listRowClick = function(id) {
    var node = listNodes.find(function(n) { return n.id === id; });
    if (node && window._openNoteModal) window._openNoteModal(node);
  };

  // Per-row delete: reuses the existing deleteNote() confirmation flow.
  // Only invoked for transcribed rows (the button is suppressed on pending
  // device-file rows in renderListRows).
  window.listRowDelete = function(id) {
    var node = listNodes.find(function(n) { return n.id === id; });
    if (node && window._deleteNote) {
      window._deleteNote(node);
    }
  };

  /* ====================================================================
   * GALAXY RENDERER
   * ==================================================================== */
  function renderGalaxy(data) {
    var CARD_W = 72;
    var CARD_H = 44;
    var CARD_R = 10;
    var CARD_NEW_GROW = 33;
    var TIER_CONFIG = {
      hotmem:  { color: "#a855f7", bg: "rgba(168,85,247,0.12)",  orbitalRadius: 200  },
      warmmem: { color: "#7c3aed", bg: "rgba(124,58,237,0.12)",  orbitalRadius: 380  },
      coldmem: { color: "#4338ca", bg: "rgba(67,56,202,0.12)",   orbitalRadius: 550  },
    };
    var EDGE_COLORS = {
      series:   "#c084fc",
      project:  "#f59e0b",
      attendee: "#22c55e",
      sameDay:  "rgba(168,85,247,0.12)",
    };
    var NEW_COLOR = "#ff4444";
    var SOURCE_TYPE_COLORS = {
      rec:  "#22c55e",
      wip:  "#3b82f6",
      room: "#f59e0b",
      call: "#22c55e",
      whsp: "#3b82f6",
    };

    function truncate(text, maxLen) {
      if (!text) return "";
      if (text.length <= maxLen) return text;
      return text.slice(0, maxLen - 1) + "\\u2026";
    }
    function cardKeywords(title) {
      var words = (title || "").split(/\\s+/).filter(function(w) { return w.length > 0; });
      if (words.length <= 3) return words.join(" ");
      return words.slice(0, 3).join(" ");
    }
    function cardDate(dt) {
      if (!dt) return "";
      var parts = dt.slice(0, 10).split("-");
      if (parts.length < 3) return dt.slice(0, 10);
      return parts[1] + "/" + parts[2];
    }

    var nodes = data.nodes.map(function(n) { return Object.assign({}, n); });
    var edges = data.edges.map(function(e) { return { source: e.source, target: e.target, type: e.type, weight: e.weight }; });

    var svg = d3.select("#galaxy-svg");
    var INSIGHTS_WIDTH = 560;
    var width  = window.innerWidth - INSIGHTS_WIDTH;
    var height = window.innerHeight - 48;
    svg.attr("width", width).attr("height", height);

    var defs = svg.append("defs");

    var bgGrad = defs.append("radialGradient")
      .attr("id", "bg-grad")
      .attr("cx", "50%").attr("cy", "50%").attr("r", "70%");
    bgGrad.append("stop").attr("offset", "0%").attr("stop-color", "#1a0a2e");
    bgGrad.append("stop").attr("offset", "100%").attr("stop-color", "#0d0117");

    svg.append("rect")
      .attr("width", width).attr("height", height)
      .attr("fill", "url(#bg-grad)");

    // Stars with purple tint
    var starGroup = svg.append("g").attr("class", "stars");
    for (var i = 0; i < 200; i++) {
      var sx = Math.random() * width;
      var sy = Math.random() * height;
      var sr = Math.random() * 1.2 + 0.3;
      var so = Math.random() * 0.5 + 0.15;
      var starColor = Math.random() > 0.7 ? "#c084fc" : "#e0d0ff";
      starGroup.append("circle")
        .attr("cx", sx).attr("cy", sy).attr("r", sr)
        .attr("fill", starColor)
        .attr("opacity", so);
    }

    var glowFilter = defs.append("filter").attr("id", "glow-filter")
      .attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
    glowFilter.append("feComposite").attr("in", "SourceGraphic").attr("in2", "blur").attr("operator", "over");

    var container = svg.append("g");

    var zoomBehavior = d3.zoom()
      .scaleExtent([0.2, 5])
      .on("zoom", function(event) {
        container.attr("transform", event.transform);
      });
    svg.call(zoomBehavior);

    var centerX = width / 2;
    var centerY = height / 2;

    // Orbital rings (purple-tinted)
    var ringGroup = container.append("g").attr("class", "orbital-rings");
    [TIER_CONFIG.hotmem.orbitalRadius, TIER_CONFIG.warmmem.orbitalRadius, TIER_CONFIG.coldmem.orbitalRadius].forEach(function(r) {
      ringGroup.append("circle")
        .attr("cx", centerX).attr("cy", centerY).attr("r", r)
        .attr("fill", "none")
        .attr("stroke", "rgba(168,85,247,0.06)")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,8");
    });

    // Edges
    var linkGroup = container.append("g").attr("class", "links");
    var EDGE_STYLE = {
      series:   { opacity: 0.7, minWidth: 2.0, maxWidth: 4.0, dash: "" },
      project:  { opacity: 0.5, minWidth: 1.0, maxWidth: 3.0, dash: "" },
      attendee: { opacity: 0.5, minWidth: 1.0, maxWidth: 2.5, dash: "" },
      sameDay:  { opacity: 0.2, minWidth: 0.3, maxWidth: 0.8, dash: "3,4" },
    };

    var linkElements = linkGroup.selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", function(d) { return EDGE_COLORS[d.type] || "#666"; })
      .attr("stroke-opacity", function(d) {
        var style = EDGE_STYLE[d.type] || EDGE_STYLE.sameDay;
        return style.opacity;
      })
      .attr("stroke-width", function(d) {
        var style = EDGE_STYLE[d.type] || EDGE_STYLE.sameDay;
        return Math.min(style.minWidth + d.weight * 0.5, style.maxWidth);
      })
      .attr("stroke-dasharray", function(d) {
        var style = EDGE_STYLE[d.type] || EDGE_STYLE.sameDay;
        return style.dash;
      });

    // Nodes (memcards)
    var nodeGroup = container.append("g").attr("class", "nodes");
    var nodeElements = nodeGroup.selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer");

    nodeElements.each(function(d) {
      var g = d3.select(this);
      var cfg = TIER_CONFIG[d.tier] || TIER_CONFIG.coldmem;
      var grow = d.isNew ? CARD_NEW_GROW : 0;
      var w = CARD_W + grow;
      var h = CARD_H + grow;
      var borderColor = d.isNew ? NEW_COLOR : cfg.color;
      var bgColor = d.isNew ? "rgba(255,68,68,0.25)" : cfg.bg;

      g.append("rect")
        .attr("width", w).attr("height", h)
        .attr("x", -w / 2).attr("y", -h / 2)
        .attr("rx", CARD_R).attr("ry", CARD_R)
        .attr("fill", bgColor)
        .attr("stroke", borderColor)
        .attr("stroke-width", d.isNew ? 1.8 : 0.8)
        .attr("stroke-opacity", d.isNew ? 1.0 : 0.6);

      // Source type indicator dot
      var srcColor = SOURCE_TYPE_COLORS[d.sourceType] || SOURCE_TYPE_COLORS.rec;
      g.append("circle")
        .attr("cx", -w / 2 + 8).attr("cy", -h / 2 + 8)
        .attr("r", 3.5)
        .attr("fill", srcColor)
        .attr("opacity", 0.9);

      // Date
      g.append("text")
        .attr("class", "memcard-date")
        .attr("x", w / 2 - 6).attr("y", -h / 2 + 8)
        .attr("text-anchor", "end")
        .text(cardDate(d.dateTime));

      // Title keywords
      var keywords = cardKeywords(d.title);
      var line1 = truncate(keywords, 10);
      var line2 = keywords.length > 10 ? truncate(keywords.slice(10).trim(), 10) : "";

      if (line2) {
        g.append("text").attr("class", "memcard-title").attr("x", 0).attr("y", -2).text(line1);
        g.append("text").attr("class", "memcard-title").attr("x", 0).attr("y", 10).text(line2);
      } else {
        g.append("text").attr("class", "memcard-title").attr("x", 0).attr("y", 4).text(line1);
      }

      if (d.isNew) { g.classed("node-new", true); }
    });

    // Drag
    var drag = d3.drag()
      .on("start", function(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", function(event, d) { d.fx = event.x; d.fy = event.y; })
      .on("end", function(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    nodeElements.call(drag);

    // Tooltip
    var tooltip = d3.select("#tooltip");
    nodeElements
      .on("mouseenter", function(event, d) {
        tooltip.select(".tt-title").text(d.title);
        tooltip.select(".tt-date").text(d.dateTime);
        tooltip.select(".tt-brief").text(d.brief);
        tooltip.classed("visible", true);
      })
      .on("mousemove", function(event) {
        var tx = event.clientX + 14;
        var ty = event.clientY - 10;
        if (tx + 320 > window.innerWidth) tx = event.clientX - 330;
        if (ty + 120 > window.innerHeight) ty = event.clientY - 120;
        tooltip.style("left", tx + "px").style("top", ty + "px");
      })
      .on("mouseleave", function() { tooltip.classed("visible", false); });

    // Note modal
    nodeElements.on("click", function(event, d) {
      event.stopPropagation();
      openNoteModal(d);
    });

    function escapeHtml(s) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function renderMarkdown(md) {
      if (!md) return "";
      return md.split("\\n").map(function(line) {
        var trimmed = line.trim();
        if (!trimmed) return "";
        // Headings
        if (/^### /.test(trimmed)) return '<h4 style="margin:14px 0 6px;font-size:14px;color:var(--text-primary);">' + escapeHtml(trimmed.slice(4)) + '</h4>';
        if (/^## /.test(trimmed)) return '<h3 style="margin:18px 0 8px;font-size:15px;color:#c084fc;">' + escapeHtml(trimmed.slice(3)) + '</h3>';
        // Checkbox items
        if (/^- \\[[ x]\\] /.test(trimmed)) {
          var checked = /^- \\[x\\] /i.test(trimmed);
          var text = trimmed.replace(/^- \\[[ x]\\] /i, "");
          return '<div style="margin:3px 0;padding-left:8px;">' + (checked ? "&#x2611; " : "&#x2610; ") + escapeHtml(text) + '</div>';
        }
        // Bullet items
        if (/^- /.test(trimmed)) return '<div style="margin:3px 0;padding-left:8px;">&#x2022; ' + escapeHtml(trimmed.slice(2)) + '</div>';
        // Bold
        var html = escapeHtml(trimmed).replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        return '<div style="margin:4px 0;">' + html + '</div>';
      }).join("");
    }

    function fmtTime(sec) {
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ":" + (s < 10 ? "0" : "") + s;
    }

    // Distinct, dark-theme-friendly speaker palette (HSL hues spaced ~45°).
    // Each entry: [text color, background rgba, border rgba].
    var SPEAKER_PALETTE = [
      ["#c084fc", "rgba(168,85,247,0.14)", "rgba(168,85,247,0.30)"], // purple
      ["#67e8f9", "rgba(34,211,238,0.14)",  "rgba(34,211,238,0.30)"],  // cyan
      ["#fcd34d", "rgba(251,191,36,0.14)",  "rgba(251,191,36,0.30)"],  // amber
      ["#86efac", "rgba(34,197,94,0.14)",   "rgba(34,197,94,0.30)"],   // green
      ["#fda4af", "rgba(244,114,182,0.14)", "rgba(244,114,182,0.30)"], // pink
      ["#93c5fd", "rgba(59,130,246,0.14)",  "rgba(59,130,246,0.30)"],  // blue
      ["#fdba74", "rgba(249,115,22,0.14)",  "rgba(249,115,22,0.30)"],  // orange
      ["#d8b4fe", "rgba(192,132,252,0.14)", "rgba(192,132,252,0.30)"]  // lavender
    ];

    function speakerStyle(idx) {
      var p = SPEAKER_PALETTE[idx % SPEAKER_PALETTE.length];
      return "color:" + p[0] + ";background:" + p[1] + ";border:1px solid " + p[2] + ";";
    }

    function formatTranscriptHtml(transcript) {
      if (!transcript) return "";
      var lines = transcript.split("\\n");
      // Match [Name @seconds]: or [Name]:
      var speakerTimePattern = /^\\[([^\\]@]+?)(?:\\s+@([\\d.]+))?\\]:\\s*/;
      var hasSpeakers = lines.some(function(l) { return speakerTimePattern.test(l); });
      if (!hasSpeakers) return '<div class="transcript-line">' + escapeHtml(transcript) + '</div>';
      // Stable palette index per distinct speaker (first appearance = 0, next new = 1, ...)
      var speakerIndex = {};
      var nextIdx = 0;
      return lines.map(function(line) {
        var m = speakerTimePattern.exec(line);
        if (m) {
          var rawName = m[1].trim();
          if (!(rawName in speakerIndex)) {
            speakerIndex[rawName] = nextIdx++;
          }
          var name = escapeHtml(rawName);
          var startSec = m[2] ? parseFloat(m[2]) : -1;
          var text = escapeHtml(line.slice(m[0].length));
          var timeHtml = startSec >= 0
            ? '<span class="transcript-time" data-seek="' + startSec + '">' + fmtTime(startSec) + '</span>'
            : '';
          var style = speakerStyle(speakerIndex[rawName]);
          // data-speaker carries the canonical name string used to:
          //   (1) find all sibling labels for a single rename to update at once
          //   (2) send the rename request to the server
          // The color stays inline-styled so renames don't shift palette assignments.
          return '<div class="transcript-line" data-start="' + startSec + '">'
            + timeHtml
            + '<span class="speaker-label" data-speaker="' + escapeAttr(rawName) + '" title="Click to rename" style="' + style + '">' + name + '</span>'
            + text + '</div>';
        }
        if (line.trim() === "") return "";
        return '<div class="transcript-line">' + escapeHtml(line) + '</div>';
      }).join("");
    }

    function escapeAttr(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;");
    }

    // ---------- Inline speaker rename — TWO MODES ----------
    //
    // Speaker labels are click-to-edit. There are two distinct user intents
    // when editing a label, and the UI must support both:
    //
    //   1. BULK RENAME ("this speaker is Sean")
    //      User wants to give a diarized speaker a real name. All instances
    //      of the old name → new name. Format stays the same (it's the same
    //      person, just relabeled).
    //
    //   2. SINGLE-LINE FIX ("this sentence was misdiarized")
    //      User wants to reassign one specific line to a different (usually
    //      existing) speaker. Only the clicked line updates. Format adopts
    //      the existing target speaker's color.
    //
    // Mode is selected via a HEURISTIC (with explicit override):
    //   - New name is NOVEL  → BULK   (typical "give a name" case)
    //   - New name is EXISTING → SINGLE (typical "fix one mistake" case)
    //   - Shift+Enter         → ALWAYS BULK (force-merge two speakers)
    //
    // The hint text below the input tells the user which mode the current
    // input will trigger so the behavior is discoverable.
    //
    // Esc cancels without saving.
    var _speakerRenameNoteId = null;
    function setActiveNoteForRename(id) {
      _speakerRenameNoteId = id;
    }
    function attachSpeakerRenameHandlers() {
      var transcriptEl = document.getElementById("nm-transcript");
      if (!transcriptEl) return;
      transcriptEl.addEventListener("click", function(e) {
        var target = e.target;
        if (!target || !target.classList || !target.classList.contains("speaker-label")) return;
        if (target.dataset.editing === "1") return;
        beginSpeakerEdit(target);
      });
    }
    function beginSpeakerEdit(labelEl) {
      var oldName = labelEl.getAttribute("data-speaker") || labelEl.textContent || "";
      var inlineStyle = labelEl.getAttribute("style") || "";
      labelEl.dataset.editing = "1";

      // The transcript line containing this label carries data-start with the
      // segment timestamp. We need this to identify the line in SINGLE mode.
      var lineEl = labelEl.closest(".transcript-line");
      var lineStart = lineEl ? lineEl.getAttribute("data-start") : null;

      // Container that holds both the input AND the hint text below it
      var wrap = document.createElement("span");
      wrap.className = "speaker-edit-wrap";
      wrap.style.display = "inline-flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "flex-start";
      wrap.style.verticalAlign = "middle";
      wrap.style.marginRight = "6px";

      var input = document.createElement("input");
      input.type = "text";
      input.className = "speaker-label-input";
      input.value = oldName;
      input.setAttribute("style", inlineStyle);
      input.style.cursor = "text";
      input.style.width = Math.max(80, oldName.length * 8 + 24) + "px";
      input.style.marginRight = "0";

      var hint = document.createElement("span");
      hint.className = "speaker-edit-hint";
      wrap.appendChild(input);
      wrap.appendChild(hint);

      var parent = labelEl.parentNode;
      parent.replaceChild(wrap, labelEl);
      input.focus();
      input.select();

      // Keep the hint text live as the user types so the mode is visible.
      function refreshHint() {
        var typed = (input.value || "").trim();
        if (!typed || typed === oldName) {
          hint.textContent = "Enter to save, Esc to cancel";
          return;
        }
        var collidesWith = findExistingSpeakerLabel(typed);
        if (collidesWith) {
          // Existing speaker — single-line fix is the safer default.
          hint.textContent =
            "↵ fix this line · ⇧↵ merge all into " + typed;
        } else {
          // Novel name — bulk rename is the natural action.
          var count = countSpeakerLabels(oldName);
          hint.textContent = "↵ rename all " + count + " line" + (count === 1 ? "" : "s");
        }
      }
      input.addEventListener("input", refreshHint);
      refreshHint();

      var done = false;
      function finish(commit, forceBulk) {
        if (done) return;
        done = true;
        var newName = (input.value || "").trim();
        if (!commit || !newName || newName === oldName) {
          parent.replaceChild(labelEl, wrap);
          delete labelEl.dataset.editing;
          return;
        }

        // Decide mode: explicit override → bulk; else heuristic.
        var existingMatch = findExistingSpeakerLabel(newName);
        var mode;
        if (forceBulk) {
          mode = "bulk";
        } else if (existingMatch) {
          mode = "single";
        } else {
          mode = "bulk";
        }

        // Restore the original label so applySpeakerRenameLocally can find it.
        parent.replaceChild(labelEl, wrap);
        delete labelEl.dataset.editing;

        if (mode === "single") {
          applySpeakerRenameSingle(labelEl, oldName, newName);
        } else {
          applySpeakerRenameBulk(oldName, newName);
        }

        // Persist to disk via the server endpoint.
        if (_speakerRenameNoteId) {
          var body = { from: oldName, to: newName };
          if (mode === "single" && lineStart !== null) {
            body.lineStart = lineStart;
          }
          fetch("/note/speaker?id=" + encodeURIComponent(_speakerRenameNoteId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).catch(function() { /* server unreachable — local change still applied */ });
        }
      }

      input.addEventListener("blur", function() { finish(true, false); });
      input.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, e.shiftKey === true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false, false);
        }
      });
    }

    // Find the FIRST existing label in the transcript whose data-speaker
    // exactly matches the given name. Used to detect collisions for mode
    // selection and to pull the harmonized style for visual merging.
    function findExistingSpeakerLabel(name) {
      var transcriptEl = document.getElementById("nm-transcript");
      if (!transcriptEl) return null;
      return transcriptEl.querySelector(
        '.speaker-label[data-speaker="' + cssEscape(name) + '"]'
      );
    }

    function countSpeakerLabels(name) {
      var transcriptEl = document.getElementById("nm-transcript");
      if (!transcriptEl) return 0;
      return transcriptEl.querySelectorAll(
        '.speaker-label[data-speaker="' + cssEscape(name) + '"]'
      ).length;
    }

    // BULK rename: update every label in this transcript whose data-speaker
    // matches the old name. Format harmonization rules:
    //   - If the new name already exists in the transcript -> adopt that
    //     speaker's style (visual merge: both old and existing speakers now
    //     share one identity). This is the rare force-merge case.
    //   - Otherwise keep the existing style (same speaker, new label).
    function applySpeakerRenameBulk(oldName, newName) {
      var transcriptEl = document.getElementById("nm-transcript");
      if (!transcriptEl) return;
      var existingMatch = transcriptEl.querySelector(
        '.speaker-label[data-speaker="' + cssEscape(newName) + '"]'
      );
      var harmonizedStyle = existingMatch ? existingMatch.getAttribute("style") : null;
      var labels = transcriptEl.querySelectorAll(
        '.speaker-label[data-speaker="' + cssEscape(oldName) + '"]'
      );
      labels.forEach(function(el) {
        el.textContent = newName;
        el.setAttribute("data-speaker", newName);
        if (harmonizedStyle) {
          el.setAttribute("style", harmonizedStyle);
        }
      });
    }

    // SINGLE-line fix: update only the clicked label. The format MUST adopt
    // the new identity's color, otherwise the user sees a label that says
    // the new name but still has the old speaker's color (which is exactly
    // the bug the user reported).
    function applySpeakerRenameSingle(labelEl, oldName, newName) {
      var transcriptEl = document.getElementById("nm-transcript");
      if (!transcriptEl) return;
      // The new name necessarily exists in the transcript here (otherwise the
      // mode would be bulk), so we can safely pull a style from any sibling
      // label of the new identity. Skip labelEl itself in case it has already
      // been mutated (defensive — labelEl shouldn't match yet).
      var existing = null;
      var candidates = transcriptEl.querySelectorAll(
        '.speaker-label[data-speaker="' + cssEscape(newName) + '"]'
      );
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] !== labelEl) {
          existing = candidates[i];
          break;
        }
      }
      labelEl.textContent = newName;
      labelEl.setAttribute("data-speaker", newName);
      if (existing) {
        labelEl.setAttribute("style", existing.getAttribute("style") || "");
      }
    }

    // Minimal CSS attribute selector escape — handles backslash and quote.
    function cssEscape(s) {
      return String(s || "").replace(/(["\\\\])/g, "\\\\$1");
    }

    // Audio-transcript sync state
    var _modalAudioEl = null;
    var _transcriptLines = [];
    var _userScrolling = false;
    var _userScrollTimer = null;

    function setupAudioSync() {
      var transcriptEl = document.getElementById("nm-transcript");
      _transcriptLines = Array.from(transcriptEl.querySelectorAll(".transcript-line[data-start]"));
      _transcriptLines.sort(function(a, b) {
        return parseFloat(a.dataset.start) - parseFloat(b.dataset.start);
      });

      // Detect user scrolling — suppress auto-scroll for 4 seconds after
      _userScrolling = false;
      transcriptEl.addEventListener("wheel", function() {
        _userScrolling = true;
        clearTimeout(_userScrollTimer);
        _userScrollTimer = setTimeout(function() { _userScrolling = false; }, 4000);
      });
      transcriptEl.addEventListener("touchmove", function() {
        _userScrolling = true;
        clearTimeout(_userScrollTimer);
        _userScrollTimer = setTimeout(function() { _userScrolling = false; }, 4000);
      });

      // Click transcript line to seek (also re-enables auto-scroll)
      transcriptEl.addEventListener("click", function(e) {
        var line = e.target.closest(".transcript-line[data-start]");
        if (!line) return;
        var t = parseFloat(line.dataset.start);
        if (t < 0 || !_modalAudioEl) return;
        _userScrolling = false;
        clearTimeout(_userScrollTimer);
        _modalAudioEl.currentTime = t;
        _modalAudioEl.play();
      });
    }

    function onAudioTimeUpdate() {
      if (!_modalAudioEl || _transcriptLines.length === 0) return;
      var ct = _modalAudioEl.currentTime;
      var activeIdx = -1;
      for (var i = _transcriptLines.length - 1; i >= 0; i--) {
        if (parseFloat(_transcriptLines[i].dataset.start) <= ct) { activeIdx = i; break; }
      }
      _transcriptLines.forEach(function(el, idx) {
        el.classList.toggle("active", idx === activeIdx);
      });
      // Auto-scroll only when user is not manually scrolling
      if (activeIdx >= 0 && !_userScrolling) {
        var activeLine = _transcriptLines[activeIdx];
        var container = document.getElementById("nm-transcript");
        var lineTop = activeLine.offsetTop - container.offsetTop;
        var lineBot = lineTop + activeLine.offsetHeight;
        var scrollTop = container.scrollTop;
        var viewH = container.clientHeight;
        if (lineTop < scrollTop || lineBot > scrollTop + viewH) {
          container.scrollTop = lineTop - viewH / 3;
        }
      }
    }

    window._openNoteModal = openNoteModal;
    // Exposed so list view rows can trigger the same delete confirmation flow
    // as the modal's delete button. Wired in renderListRows() per row.
    window._deleteNote = function(d) { deleteNote(d); };
    // Attach the click-to-edit handler once. It uses event delegation on
    // #nm-transcript so dynamically-rendered speaker labels are covered.
    attachSpeakerRenameHandlers();
    function openNoteModal(d) {
      // Mark as read — remove new-note styling
      if (d.isNew) {
        d.isNew = false;
        // Update in GALAXY_DATA so re-renders keep it cleared
        if (GALAXY_DATA) {
          var gn = GALAXY_DATA.nodes.find(function(n) { return n.id === d.id; });
          if (gn) gn.isNew = false;
        }
        // Remove visual highlight from galaxy node and list row
        d3.selectAll(".node-new").each(function(nd) {
          if (nd && nd.id === d.id) d3.select(this).classed("node-new", false);
        });
        var row = document.querySelector('tr.list-row-new[onclick*="' + d.id.replace(/'/g, "\\'") + '"]');
        if (row) row.classList.remove("list-row-new");
        // Update stats bar new count
        var newCount = GALAXY_DATA ? GALAXY_DATA.nodes.filter(function(n) { return n.isNew; }).length : 0;
        var newSpan = document.querySelector(".stat-new");
        if (newSpan) newSpan.textContent = String(newCount);
      }
      document.getElementById("nm-title").textContent = d.title;
      document.getElementById("nm-date").textContent = d.dateTime;
      document.getElementById("nm-kind").textContent = d.kind + " (" + (d.sourceType || "rec") + ")";
      document.getElementById("nm-tier").innerHTML = '<span class="tier-badge ' + d.tier + '">' + d.tier + '</span>';

      var attWrap = document.getElementById("nm-attendees-wrap");
      attWrap.innerHTML = "";
      (d.attendees || []).forEach(function(a) {
        var tag = document.createElement("span");
        tag.className = "attendee-tag";
        tag.textContent = a;
        attWrap.appendChild(tag);
      });

      // Reset audio sync state
      if (_modalAudioEl) {
        _modalAudioEl.removeEventListener("timeupdate", onAudioTimeUpdate);
        _modalAudioEl = null;
      }
      _transcriptLines = [];

      // Audio player
      var audioPlayer = document.getElementById("nm-audio-player");
      audioPlayer.innerHTML = '<div class="audio-unavailable">Checking audio...</div>';
      fetch("/audio?id=" + encodeURIComponent(d.id), { method: "HEAD" })
        .then(function(res) {
          if (res.ok) {
            audioPlayer.innerHTML = '<audio controls preload="auto" src="/audio?id=' + encodeURIComponent(d.id) + '"></audio>';
            _modalAudioEl = audioPlayer.querySelector("audio");
            if (_modalAudioEl) {
              _modalAudioEl.addEventListener("timeupdate", onAudioTimeUpdate);
            }
          } else {
            audioPlayer.innerHTML = '<div class="audio-unavailable">Audio not available for this recording</div>';
          }
        })
        .catch(function() {
          audioPlayer.innerHTML = '<div class="audio-unavailable">Audio not available</div>';
        });

      // Fetch note content
      var summaryEl = document.getElementById("nm-summary");
      var transcriptEl = document.getElementById("nm-transcript");
      summaryEl.innerHTML = '<span class="note-loading-text">Loading...</span>';
      transcriptEl.textContent = "";

      // Tell the inline speaker-rename handler which note this transcript
      // belongs to, so renames can be persisted to the right markdown file.
      setActiveNoteForRename(d.id);

      fetch("/note?id=" + encodeURIComponent(d.id))
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(note) {
          if (note) {
            summaryEl.innerHTML = renderMarkdown(note.summary || "(no summary)");
            transcriptEl.innerHTML = formatTranscriptHtml(note.transcript || "(no transcript)");
            setupAudioSync();
          } else {
            summaryEl.textContent = "(unable to load)";
          }
        })
        .catch(function() {
          summaryEl.textContent = "(unable to load)";
        });

      // Wire delete button (visible for notes, hidden for wiki pages)
      var deleteBtn = document.getElementById("nm-delete-btn");
      deleteBtn.style.display = "";
      deleteBtn.onclick = function() { deleteNote(d); };

      // Show modal with animation
      var overlay = document.getElementById("note-overlay");
      overlay.style.display = "flex";
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          overlay.classList.add("open");
        });
      });
    }

    window.closeNoteModal = function() {
      var overlay = document.getElementById("note-overlay");
      overlay.classList.remove("open");
      if (_modalAudioEl) {
        _modalAudioEl.removeEventListener("timeupdate", onAudioTimeUpdate);
      }
      setTimeout(function() {
        overlay.style.display = "none";
        var audio = overlay.querySelector("audio");
        if (audio) { audio.pause(); }
        _modalAudioEl = null;
        _transcriptLines = [];
      }, 250);
    };

    var _deleteTarget = null;
    function deleteNote(d) {
      _deleteTarget = d;
      document.getElementById("dc-note-title").textContent = d.title;
      var overlay = document.getElementById("delete-confirm-overlay");
      var confirmBtn = document.getElementById("dc-confirm");
      confirmBtn.textContent = "Delete";
      confirmBtn.disabled = false;
      overlay.style.display = "flex";
      requestAnimationFrame(function() {
        requestAnimationFrame(function() { overlay.classList.add("open"); });
      });
    }

    function closeDeleteConfirm() {
      var overlay = document.getElementById("delete-confirm-overlay");
      overlay.classList.remove("open");
      setTimeout(function() { overlay.style.display = "none"; }, 200);
      _deleteTarget = null;
    }

    document.getElementById("dc-cancel").addEventListener("click", closeDeleteConfirm);

    document.getElementById("dc-confirm").addEventListener("click", function() {
      if (!_deleteTarget) return;
      var d = _deleteTarget;
      var btn = this;
      btn.textContent = "Deleting...";
      btn.disabled = true;
      fetch("/note?id=" + encodeURIComponent(d.id), { method: "DELETE" })
        .then(function(res) { return res.ok ? res.json() : Promise.reject("failed"); })
        .then(function() {
          closeDeleteConfirm();
          closeNoteModal();
          if (GALAXY_DATA) {
            GALAXY_DATA.nodes = GALAXY_DATA.nodes.filter(function(n) { return n.id !== d.id; });
            GALAXY_DATA.edges = GALAXY_DATA.edges.filter(function(e) { return e.source !== d.id && e.target !== d.id; });
            transitionToGalaxy(GALAXY_DATA);
          }
        })
        .catch(function() {
          btn.textContent = "Delete";
          btn.disabled = false;
        });
    });

    document.getElementById("delete-confirm-overlay").addEventListener("click", function(e) {
      if (e.target === this) closeDeleteConfirm();
    });

    // Close on overlay click (not modal content)
    document.getElementById("note-overlay").addEventListener("click", function(e) {
      if (e.target === this) { closeNoteModal(); }
    });

    // ---- Source linking ----
    function linkifySources(html) {
      // Replace [src: filename.md] with clickable links
      return html.replace(/\\[src:\\s*([^\\]]+\\.md)\\]/g, function(match, filename) {
        return '<a class="wiki-src-link" href="#" onclick="openNoteBySource(\\'' + escAttr(filename) + '\\');return false;">[' + escHtml(filename) + ']</a>';
      });
    }

    window.openNoteBySource = function(filename) {
      // Find the note in GALAXY_DATA by matching the notePath
      if (!GALAXY_DATA) return;
      var node = GALAXY_DATA.nodes.find(function(n) {
        return n.notePath && n.notePath.endsWith("/" + filename);
      });
      if (node && window._openNoteModal) {
        window._openNoteModal(node);
      }
    };

    // ---- Wiki view ----
    var WIKI_CATEGORY_ICONS = { people: "&#x1f464;", projects: "&#x1f4cb;", topics: "&#x1f4d6;", decisions: "&#x2696;", actions: "&#x2705;" };

    function loadWikiData() {
      // Wiki categories are pre-rendered server-side into the HTML.
      // This function exists for refresh after new wiki compilation.
      // Nothing to do on initial load.
    }

    function renderWikiFromIndex(indexContent) {
      var categoriesEl = document.getElementById("wiki-categories");
      var categories = ["People", "Projects", "Topics", "Decisions", "Actions"];
      var html = "";

      categories.forEach(function(cat) {
        var catKey = cat.toLowerCase();
        var icon = WIKI_CATEGORY_ICONS[catKey] || "";
        // Line-based section parsing
        var lines = [];
        var inSection = false;
        indexContent.split(String.fromCharCode(10)).forEach(function(line) {
          if (line.indexOf("## " + cat) === 0) { inSection = true; return; }
          if (line.indexOf("## ") === 0 && inSection) { inSection = false; return; }
          if (inSection && line.indexOf("- ") === 0) lines.push(line);
        });

        html += '<div class="wiki-category-card">';
        html += '<div class="wiki-category-header">' + icon + ' ' + cat + ' <span class="wiki-category-count">(' + lines.length + ')</span></div>';
        if (lines.length === 0) {
          html += '<div style="font-size:12px;color:var(--text-dim);padding:4px 0;">No entries yet</div>';
        }
        lines.forEach(function(line) {
          // Parse: - [Title](category/file.md) — snippet
          var lb = line.indexOf("[");
          var rb = line.indexOf("]", lb);
          var lp = line.indexOf("(", rb);
          var rp = line.indexOf(")", lp);
          if (lb >= 0 && rb > lb && lp > rb && rp > lp) {
            var title = line.substring(lb + 1, rb);
            var wikiPath = line.substring(lp + 1, rp);
            var dashIdx = line.indexOf(" — ", rp);
            var snippet = dashIdx >= 0 ? line.substring(dashIdx + 3) : "";
            html += '<div class="wiki-entry" onclick="openWikiPage(' + "'" + wikiPath.replace(/'/g, "") + "'" + ')">';
            html += '<span class="wiki-entry-title">' + escHtml(title) + '</span>';
            if (snippet) html += '<span class="wiki-entry-snippet">' + escHtml(snippet) + '</span>';
            html += '</div>';
          }
        });
        html += '</div>';
      });

      categoriesEl.innerHTML = html || '<div class="wiki-empty">No wiki content yet.</div>';
    }

    window.openWikiPage = function(wikiPath) {
      // Reuse note modal to show wiki page
      fetch("/wiki/page?path=" + encodeURIComponent(wikiPath))
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) return;
          document.getElementById("nm-title").textContent = data.title;
          document.getElementById("nm-date").textContent = data.category;
          document.getElementById("nm-kind").textContent = "wiki";
          document.getElementById("nm-tier").innerHTML = '<span class="tier-badge hotmem">wiki</span>';
          document.getElementById("nm-attendees-wrap").innerHTML = "";
          document.getElementById("nm-summary").innerHTML = linkifySources(renderMarkdown(data.content));
          document.getElementById("nm-transcript").textContent = "";
          document.getElementById("nm-audio-player").innerHTML = "";
          document.getElementById("nm-delete-btn").style.display = "none";
          var overlay = document.getElementById("note-overlay");
          overlay.style.display = "flex";
          requestAnimationFrame(function() { requestAnimationFrame(function() { overlay.classList.add("open"); }); });
        });
    };

    window.filterWiki = function(query) {
      if (!query || query.length < 2) { loadWikiData(); return; }
      fetch("/wiki/search?q=" + encodeURIComponent(query))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var categoriesEl = document.getElementById("wiki-categories");
          if (!data.results || data.results.length === 0) {
            categoriesEl.innerHTML = '<div class="wiki-empty">No results for "' + escHtml(query) + '"</div>';
            return;
          }
          var html = '<div class="wiki-category-card" style="grid-column:1/-1;">';
          html += '<div class="wiki-category-header">&#x1f50d; Search Results <span class="wiki-category-count">(' + data.results.length + ')</span></div>';
          data.results.forEach(function(r) {
            html += '<div class="wiki-entry" onclick="openWikiPage(' + "'" + r.path.replace(/'/g, "") + "'" + ')">';
            html += '<span class="wiki-entry-title">' + escHtml(r.title) + '</span>';
            html += '<span class="wiki-entry-snippet">' + escHtml(r.snippet.slice(0, 80)) + '</span>';
            html += '</div>';
          });
          html += '</div>';
          categoriesEl.innerHTML = html;
        });
    };

    // ---- AskHiDock ----
    window.askHiDock = function() {
      var input = document.getElementById("ask-input");
      var query = input.value.trim();
      if (!query) return;

      // Show ask panel, hide insights
      document.getElementById("insights-panel").style.display = "none";
      var panel = document.getElementById("ask-hidock-panel");
      panel.style.display = "block";
      document.getElementById("ask-query-display").textContent = query;
      document.getElementById("ask-answer").innerHTML = '<span class="ask-typing-cursor"></span>';
      document.getElementById("ask-sources").innerHTML = "";
      input.value = "";

      fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query }),
      }).then(function(res) {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var answerText = "";
        var answerEl = document.getElementById("ask-answer");
        var sourcesEl = document.getElementById("ask-sources");

        function readChunk() {
          reader.read().then(function(result) {
            if (result.done) {
              answerEl.innerHTML = linkifySources(renderMarkdown(answerText));
              return;
            }
            var text = decoder.decode(result.value, { stream: true });
            text.split("\\n").forEach(function(line) {
              if (!line.startsWith("data: ")) return;
              var jsonStr = line.slice(6).trim();
              if (!jsonStr) return;
              try {
                var evt = JSON.parse(jsonStr);
                if (evt.type === "sources" && evt.results) {
                  var shtml = '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Sources:</div>';
                  evt.results.slice(0, 5).forEach(function(s) {
                    shtml += '<div class="ask-source-item" onclick="openWikiPage(' + "'" + s.path.replace(/'/g, "") + "'" + ')">' + escHtml(s.title) + ' (' + s.category + ')</div>';
                  });
                  sourcesEl.innerHTML = shtml;
                } else if (evt.type === "chunk") {
                  answerText += evt.text;
                  answerEl.innerHTML = linkifySources(renderMarkdown(answerText)) + '<span class="ask-typing-cursor"></span>';
                } else if (evt.type === "done") {
                  answerEl.innerHTML = linkifySources(renderMarkdown(answerText));
                }
              } catch(e) {}
            });
            readChunk();
          });
        }
        readChunk();
      }).catch(function() {
        document.getElementById("ask-answer").textContent = "Failed to get answer. Is the LLM server running?";
      });
    };

    window.closeAskPanel = function() {
      document.getElementById("ask-hidock-panel").style.display = "none";
      document.getElementById("insights-panel").style.display = "block";
    };

    // Close on Escape key
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") { closeNoteModal(); closeAskPanel(); }
    });

    // Force simulation
    var simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges)
        .id(function(d) { return d.id; })
        .distance(function(d) {
          if (d.type === "series") return 50;
          if (d.type === "project") return 90;
          if (d.type === "attendee") return 100;
          return 160;
        })
        .strength(function(d) {
          if (d.type === "series") return 0.6 + d.weight * 0.05;
          if (d.type === "project") return 0.2 + d.weight * 0.08;
          if (d.type === "attendee") return 0.15 + d.weight * 0.1;
          return 0.03;
        })
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(centerX, centerY))
      .force("radial", d3.forceRadial(
        function(d) { return (TIER_CONFIG[d.tier] || TIER_CONFIG.coldmem).orbitalRadius; },
        centerX, centerY
      ).strength(0.4))
      .force("collide", d3.forceCollide(function(d) {
        var grow = d.isNew ? CARD_NEW_GROW : 0;
        return (CARD_W + grow) / 2 + 6;
      }))
      .on("tick", function() {
        linkElements
          .attr("x1", function(d) { return d.source.x; })
          .attr("y1", function(d) { return d.source.y; })
          .attr("x2", function(d) { return d.target.x; })
          .attr("y2", function(d) { return d.target.y; });
        nodeElements
          .attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
      });

    // Responsive
    window.addEventListener("resize", function() {
      var w = window.innerWidth - INSIGHTS_WIDTH;
      var h = window.innerHeight - 48;
      svg.attr("width", w).attr("height", h);
      svg.select("rect").attr("width", w).attr("height", h);
      var cx = w / 2;
      var cy = h / 2;
      simulation.force("center", d3.forceCenter(cx, cy));
      simulation.force("radial", d3.forceRadial(
        function(d) { return (TIER_CONFIG[d.tier] || TIER_CONFIG.coldmem).orbitalRadius; },
        cx, cy
      ).strength(0.4));
      simulation.alpha(0.3).restart();
    });
  }

  /* Boot when D3 is loaded */
  boot();
})();
</script>
</body>
</html>`;
}
//# sourceMappingURL=galaxyHtml.js.map