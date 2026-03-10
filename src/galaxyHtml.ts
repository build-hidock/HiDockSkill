import type { GalaxyGraphData } from "./galaxyData.js";

/**
 * Render a self-contained HTML page with two states:
 * 1. Syncing — pulsing animation while HiDock device is being synced
 * 2. Galaxy — D3.js force-directed graph of meeting notes
 *
 * When `data` is null, the page starts in syncing mode and polls /data.json
 * until data becomes available, then transitions to the galaxy view.
 */
export function renderGalaxyHtml(data: GalaxyGraphData | null): string {
  const dataJson = data ? JSON.stringify(data) : "null";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HiDock Galaxy</title>
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
    --color-new: #FFFFFF;
    --src-rec: #3b82f6;
    --src-wip: #22c55e;
    --src-room: #f59e0b;
    --src-call: #ef4444;
    --src-whsp: #c084fc;
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
  .stat-new { color: var(--color-new); text-shadow: 0 0 6px rgba(168,85,247,0.6); }

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
    width: 900px;
    max-width: 94vw;
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
    font-size: 15px;
    color: var(--text-primary);
    line-height: 1.65;
    padding: 14px 16px;
    background: rgba(168,85,247,0.06);
    border-radius: 10px;
    border: 1px solid rgba(168,85,247,0.08);
  }
  .note-text.transcript-text {
    max-height: 320px;
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
  <div class="sync-status">Downloading, transcribing, and analyzing<span class="sync-dots"></span></div>
</div>

<!-- Galaxy UI (hidden during sync) -->
<div id="header" style="display:none;">
  <h1>HiDock Galaxy</h1>
  <div class="stats" id="stats-bar"></div>
</div>

<div id="view-tabs">
  <button class="view-tab active" data-view="galaxy" onclick="switchView('galaxy')">Galaxy</button>
  <button class="view-tab" data-view="list" onclick="switchView('list')">List</button>
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
      <div class="audio-section" id="nm-audio-section">
        <div class="audio-section-label">&#x1f50a; Audio Recording</div>
        <div class="audio-player" id="nm-audio-player"></div>
      </div>
      <div class="note-section">
        <div class="note-section-label"><span class="sec-icon">&#x2728;</span> Summary</div>
        <div class="note-text summary-text" id="nm-summary"></div>
      </div>
      <div class="note-section">
        <div class="note-section-label"><span class="sec-icon">&#x1f399;</span> Transcript</div>
        <div class="note-text transcript-text" id="nm-transcript"></div>
      </div>
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
  <div class="legend-item"><span class="legend-card" style="background:rgba(255,255,255,0.1); border:1px solid var(--color-new); box-shadow:0 0 6px rgba(168,85,247,0.4);"></span> New note</div>
  <h3 style="margin-top:10px;">Source</h3>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-rec);"></span> Meeting</div>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-wip);"></span> WIP</div>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-room);"></span> Room</div>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-call);"></span> Call</div>
  <div class="legend-item"><span class="legend-card" style="width:8px;height:8px;border-radius:50%;background:var(--src-whsp);"></span> Whisper</div>
  <h3 style="margin-top:10px;">Relationships</h3>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-series); height:3px;"></span> Same series</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-project);"></span> Same project/topic</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-attendee);"></span> Shared attendee</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-sameday);"></span> Same day</div>
</div>

<svg id="galaxy-svg" style="display:none;"></svg>

<script>var GALAXY_DATA = ${dataJson};</script>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
  "use strict";

  /* ====================================================================
   * STATE MACHINE: syncing → ready
   * ==================================================================== */
  var pollTimer = null;

  function boot() {
    if (GALAXY_DATA) {
      transitionToGalaxy(GALAXY_DATA);
    } else {
      startPolling();
    }
  }

  function startPolling() {
    pollTimer = setInterval(function() {
      fetch("/data.json").then(function(res) {
        if (res.status === 200) {
          return res.json();
        }
        return null;
      }).then(function(data) {
        if (data && data.nodes) {
          clearInterval(pollTimer);
          pollTimer = null;
          GALAXY_DATA = data;
          transitionToGalaxy(data);
        }
      }).catch(function() { /* ignore, retry */ });
    }, 2000);
  }

  function transitionToGalaxy(data) {
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

    // Populate insights
    renderInsights(data.insights);

    // Build list view data
    buildListView(data);

    // Render galaxy
    setTimeout(function() { renderGalaxy(data); }, 100);
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

    if (view === "galaxy") {
      document.getElementById("galaxy-svg").style.display = "block";
      document.getElementById("legend").style.display = "block";
      document.getElementById("list-view").style.display = "none";
    } else {
      document.getElementById("galaxy-svg").style.display = "none";
      document.getElementById("legend").style.display = "none";
      document.getElementById("list-view").style.display = "block";
      renderListRows();
    }
  };

  /* ====================================================================
   * LIST VIEW
   * ==================================================================== */
  var SOURCE_TYPE_LABELS = { rec: "Meeting", wip: "WIP", room: "Room", call: "Call", whsp: "Whisper" };
  var LIST_SRC_COLORS = { rec: "#3b82f6", wip: "#22c55e", room: "#f59e0b", call: "#ef4444", whsp: "#c084fc" };

  function buildListView(data) {
    listNodes = data.nodes.map(function(n) { return Object.assign({}, n); });
    listNodes.sort(function(a, b) { return (b.dateTime || "").localeCompare(a.dateTime || ""); });
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
      tbody.innerHTML = '<tr><td colspan="6" class="list-empty">No matching notes</td></tr>';
      return;
    }
    var html = "";
    nodes.forEach(function(n) {
      var srcColor = LIST_SRC_COLORS[n.sourceType] || LIST_SRC_COLORS.rec;
      var srcLabel = SOURCE_TYPE_LABELS[n.sourceType] || "Meeting";
      var attendeeStr = (n.attendees || []).join(", ") || "—";
      var dateStr = (n.dateTime || "").slice(0, 16).replace("T", " ");
      html += '<tr onclick="listRowClick(\\'' + escAttr(n.id) + '\\')">';
      html += '<td class="list-date-cell">' + escHtml(dateStr) + '</td>';
      html += '<td><div class="list-title-cell"><span class="list-src-dot" style="background:' + srcColor + '"></span>' + escHtml(n.title || "Untitled") + '</div></td>';
      html += '<td class="list-brief-cell" title="' + escAttr(n.brief || "") + '">' + escHtml(n.brief || "") + '</td>';
      html += '<td class="list-tier-cell"><span class="tier-badge ' + n.tier + '">' + n.tier + '</span></td>';
      html += '<td class="list-attendee-cell" title="' + escAttr(attendeeStr) + '">' + escHtml(attendeeStr) + '</td>';
      html += '<td>' + escHtml(srcLabel) + '</td>';
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

  /* ====================================================================
   * GALAXY RENDERER
   * ==================================================================== */
  function renderGalaxy(data) {
    var CARD_W = 72;
    var CARD_H = 44;
    var CARD_R = 10;
    var CARD_NEW_GROW = 8;
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
    var NEW_COLOR = "#FFFFFF";
    var SOURCE_TYPE_COLORS = {
      rec:  "#3b82f6",
      wip:  "#22c55e",
      room: "#f59e0b",
      call: "#ef4444",
      whsp: "#c084fc",
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
      var bgColor = d.isNew ? "rgba(168,85,247,0.2)" : cfg.bg;

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

    window._openNoteModal = openNoteModal;
    function openNoteModal(d) {
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

      // Audio player
      var audioPlayer = document.getElementById("nm-audio-player");
      audioPlayer.innerHTML = '<div class="audio-unavailable">Checking audio...</div>';
      fetch("/audio?id=" + encodeURIComponent(d.id), { method: "HEAD" })
        .then(function(res) {
          if (res.ok) {
            audioPlayer.innerHTML = '<audio controls preload="auto" src="/audio?id=' + encodeURIComponent(d.id) + '"></audio>';
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

      fetch("/note?id=" + encodeURIComponent(d.id))
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(note) {
          if (note) {
            summaryEl.textContent = note.summary || "(no summary)";
            transcriptEl.textContent = note.transcript || "(no transcript)";
          } else {
            summaryEl.textContent = "(unable to load)";
          }
        })
        .catch(function() {
          summaryEl.textContent = "(unable to load)";
        });

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
      setTimeout(function() {
        overlay.style.display = "none";
        // Stop audio if playing
        var audio = overlay.querySelector("audio");
        if (audio) { audio.pause(); }
      }, 250);
    };

    // Close on overlay click (not modal content)
    document.getElementById("note-overlay").addEventListener("click", function(e) {
      if (e.target === this) { closeNoteModal(); }
    });

    // Close on Escape key
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") { closeNoteModal(); }
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
