/**
 * Render a self-contained HTML page with a D3.js force-directed galaxy
 * visualization of meeting notes.  The returned string is a complete HTML
 * document (<!DOCTYPE html> ...) with all CSS/JS inline and D3 loaded from CDN.
 */
export function renderGalaxyHtml(data) {
    const totalNotes = data.nodes.length;
    const newNotes = data.nodes.filter((n) => n.isNew).length;
    const hotCount = data.nodes.filter((n) => n.tier === "hotmem").length;
    const warmCount = data.nodes.filter((n) => n.tier === "warmmem").length;
    const coldCount = data.nodes.filter((n) => n.tier === "coldmem").length;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HiDock Galaxy</title>
<style>
  :root {
    --color-hot: #FFD700;
    --color-warm: #FF8C00;
    --color-cold: #4169E1;
    --color-new: #FFFFFF;
    --edge-series: #06b6d4;
    --edge-project: #f59e0b;
    --edge-attendee: #22c55e;
    --edge-sameday: rgba(156,163,175,0.3);
    --bg-dark: #0a0a1a;
    --bg-mid: #1a1a3a;
    --panel-bg: rgba(10, 10, 30, 0.92);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: linear-gradient(135deg, var(--bg-dark) 0%, var(--bg-mid) 100%);
    color: #e0e0e0;
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
    background: rgba(10, 10, 30, 0.85);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    z-index: 100;
  }
  #header h1 {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 1.5px;
    background: linear-gradient(90deg, var(--color-hot), var(--color-warm));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  #header .stats {
    font-size: 12px;
    color: #9ca3af;
    display: flex;
    gap: 16px;
  }
  #header .stats span { white-space: nowrap; }
  .stat-label { color: #6b7280; }
  .stat-hot { color: var(--color-hot); }
  .stat-warm { color: var(--color-warm); }
  .stat-cold { color: var(--color-cold); }
  .stat-new { color: var(--color-new); text-shadow: 0 0 6px rgba(255,255,255,0.5); }

  /* ---------- SVG ---------- */
  #galaxy-svg {
    position: fixed;
    top: 48px; left: 0;
    width: 100vw;
    height: calc(100vh - 48px);
  }

  /* ---------- tooltip ---------- */
  #tooltip {
    position: fixed;
    pointer-events: none;
    background: var(--panel-bg);
    border: 1px solid rgba(255,255,255,0.12);
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
    color: #f0f0f0;
    margin-bottom: 4px;
  }
  #tooltip .tt-date { color: #9ca3af; font-size: 11px; }
  #tooltip .tt-brief { color: #d1d5db; margin-top: 4px; }

  /* ---------- detail panel ---------- */
  #detail-panel {
    position: fixed;
    top: 48px; right: 0;
    width: 320px;
    height: calc(100vh - 48px);
    background: var(--panel-bg);
    border-left: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(12px);
    padding: 24px 20px;
    overflow-y: auto;
    transform: translateX(100%);
    transition: transform 0.25s ease;
    z-index: 150;
  }
  #detail-panel.open { transform: translateX(0); }
  #detail-panel .close-btn {
    position: absolute;
    top: 12px; right: 14px;
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 22px;
    cursor: pointer;
    line-height: 1;
    padding: 4px;
    transition: color 0.15s;
  }
  #detail-panel .close-btn:hover { color: #f0f0f0; }
  #detail-panel h2 {
    font-size: 16px;
    font-weight: 600;
    color: #f0f0f0;
    margin-bottom: 16px;
    padding-right: 28px;
    line-height: 1.35;
  }
  .detail-row {
    margin-bottom: 12px;
  }
  .detail-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #6b7280;
    margin-bottom: 2px;
  }
  .detail-value {
    font-size: 13px;
    color: #d1d5db;
    line-height: 1.5;
  }
  .detail-attendees {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .attendee-tag {
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 12px;
    color: #d1d5db;
  }
  .tier-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
  }
  .tier-badge.hotmem  { background: rgba(255,215,0,0.15);  color: var(--color-hot); }
  .tier-badge.warmmem { background: rgba(255,140,0,0.15);  color: var(--color-warm); }
  .tier-badge.coldmem { background: rgba(65,105,225,0.15); color: var(--color-cold); }

  /* ---------- legend ---------- */
  #legend {
    position: fixed;
    bottom: 16px; left: 16px;
    background: var(--panel-bg);
    border: 1px solid rgba(255,255,255,0.08);
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
    color: #6b7280;
    margin-bottom: 6px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #9ca3af;
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
    0%, 100% { filter: drop-shadow(0 0 4px rgba(255,255,255,0.6)); }
    50% { filter: drop-shadow(0 0 12px #fff) drop-shadow(0 0 20px #FFD700); }
  }
  .node-new {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  /* ---------- memcard text ---------- */
  .memcard-title {
    font-size: 9px;
    font-weight: 600;
    fill: #f0f0f0;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .memcard-date {
    font-size: 7px;
    font-weight: 400;
    fill: rgba(255,255,255,0.5);
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .memcard-kind {
    font-size: 7px;
    font-weight: 500;
    text-anchor: start;
    dominant-baseline: central;
    pointer-events: none;
  }

  /* ---------- star field background ---------- */
  @keyframes twinkle {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
</style>
</head>
<body>

<div id="header">
  <h1>HiDock Galaxy</h1>
  <div class="stats">
    <span><span class="stat-label">Total </span>${totalNotes}</span>
    <span><span class="stat-label">New </span><span class="stat-new">${newNotes}</span></span>
    <span><span class="stat-label">Hot </span><span class="stat-hot">${hotCount}</span></span>
    <span><span class="stat-label">Warm </span><span class="stat-warm">${warmCount}</span></span>
    <span><span class="stat-label">Cold </span><span class="stat-cold">${coldCount}</span></span>
    <span><span class="stat-label">Generated </span>${escapeHtml(data.generatedAt)}</span>
  </div>
</div>

<div id="tooltip">
  <div class="tt-title"></div>
  <div class="tt-date"></div>
  <div class="tt-brief"></div>
</div>

<div id="detail-panel">
  <button class="close-btn" onclick="closePanel()">&times;</button>
  <h2 id="dp-title"></h2>
  <div class="detail-row">
    <div class="detail-label">Date</div>
    <div class="detail-value" id="dp-date"></div>
  </div>
  <div class="detail-row">
    <div class="detail-label">Attendees</div>
    <div class="detail-attendees" id="dp-attendees"></div>
  </div>
  <div class="detail-row">
    <div class="detail-label">Brief</div>
    <div class="detail-value" id="dp-brief"></div>
  </div>
  <div class="detail-row">
    <div class="detail-label">Kind</div>
    <div class="detail-value" id="dp-kind"></div>
  </div>
  <div class="detail-row">
    <div class="detail-label">Tier</div>
    <div class="detail-value" id="dp-tier"></div>
  </div>
  <div class="detail-row">
    <div class="detail-label">Source</div>
    <div class="detail-value" id="dp-source" style="word-break:break-all;"></div>
  </div>
</div>

<div id="legend">
  <h3>Tiers</h3>
  <div class="legend-item"><span class="legend-card" style="background:rgba(255,215,0,0.2); border:1px solid var(--color-hot);"></span> Hot (recent)</div>
  <div class="legend-item"><span class="legend-card" style="background:rgba(255,140,0,0.2); border:1px solid var(--color-warm);"></span> Warm</div>
  <div class="legend-item"><span class="legend-card" style="background:rgba(65,105,225,0.2); border:1px solid var(--color-cold);"></span> Cold (old)</div>
  <div class="legend-item"><span class="legend-card" style="background:rgba(255,255,255,0.15); border:1px solid var(--color-new); box-shadow:0 0 6px rgba(255,255,255,0.4);"></span> New note</div>
  <h3 style="margin-top:10px;">Relationships</h3>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-series); height:3px;"></span> Same series</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-project);"></span> Same project/topic</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-attendee);"></span> Shared attendee</div>
  <div class="legend-item"><span class="legend-line" style="background:var(--edge-sameday);"></span> Same day</div>
</div>

<svg id="galaxy-svg"></svg>

<script>const GALAXY_DATA = ${JSON.stringify(data)};</script>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
  "use strict";

  /* ---------- constants ---------- */
  var CARD_W = 72;
  var CARD_H = 44;
  var CARD_R = 10; // border-radius (iOS-like)
  var CARD_NEW_GROW = 8; // extra px for new notes
  var TIER_CONFIG = {
    hotmem:  { color: "#FFD700", bg: "rgba(255,215,0,0.12)",  orbitalRadius: 200  },
    warmmem: { color: "#FF8C00", bg: "rgba(255,140,0,0.12)",  orbitalRadius: 380  },
    coldmem: { color: "#4169E1", bg: "rgba(65,105,225,0.12)", orbitalRadius: 550  },
  };
  var EDGE_COLORS = {
    series:   "#06b6d4",
    project:  "#f59e0b",
    attendee: "#22c55e",
    sameDay:  "rgba(156,163,175,0.3)",
  };
  var NEW_COLOR = "#FFFFFF";

  /** Truncate text to fit inside memcard */
  function truncate(text, maxLen) {
    if (!text) return "";
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "\u2026";
  }
  /** Extract 2-3 keywords from title */
  function cardKeywords(title) {
    var words = (title || "").split(/\\s+/).filter(function(w) { return w.length > 0; });
    if (words.length <= 3) return words.join(" ");
    return words.slice(0, 3).join(" ");
  }
  /** Format date for card: MM/DD */
  function cardDate(dt) {
    if (!dt) return "";
    var parts = dt.slice(0, 10).split("-");
    if (parts.length < 3) return dt.slice(0, 10);
    return parts[1] + "/" + parts[2];
  }

  /* ---------- data ---------- */
  const nodes = GALAXY_DATA.nodes.map(function(n) { return Object.assign({}, n); });
  const edges = GALAXY_DATA.edges.map(function(e) { return { source: e.source, target: e.target, type: e.type, weight: e.weight }; });

  /* ---------- sizing ---------- */
  const svg = d3.select("#galaxy-svg");
  const width  = window.innerWidth;
  const height = window.innerHeight - 48;
  svg.attr("width", width).attr("height", height);

  /* ---------- star field background ---------- */
  const defs = svg.append("defs");

  // radial gradient for background
  const bgGrad = defs.append("radialGradient")
    .attr("id", "bg-grad")
    .attr("cx", "50%").attr("cy", "50%").attr("r", "70%");
  bgGrad.append("stop").attr("offset", "0%").attr("stop-color", "#1a1a3a");
  bgGrad.append("stop").attr("offset", "100%").attr("stop-color", "#0a0a1a");

  svg.append("rect")
    .attr("width", width).attr("height", height)
    .attr("fill", "url(#bg-grad)");

  // decorative stars
  const starGroup = svg.append("g").attr("class", "stars");
  for (var i = 0; i < 200; i++) {
    var sx = Math.random() * width;
    var sy = Math.random() * height;
    var sr = Math.random() * 1.2 + 0.3;
    var so = Math.random() * 0.6 + 0.2;
    starGroup.append("circle")
      .attr("cx", sx).attr("cy", sy).attr("r", sr)
      .attr("fill", "#ffffff")
      .attr("opacity", so);
  }

  // glow filter for new nodes
  var glowFilter = defs.append("filter").attr("id", "glow-filter")
    .attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glowFilter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
  glowFilter.append("feComposite").attr("in", "SourceGraphic").attr("in2", "blur").attr("operator", "over");

  /* ---------- zoom container ---------- */
  var container = svg.append("g");

  var zoomBehavior = d3.zoom()
    .scaleExtent([0.2, 5])
    .on("zoom", function(event) {
      container.attr("transform", event.transform);
    });
  svg.call(zoomBehavior);

  /* ---------- orbital rings (decorative) ---------- */
  var centerX = width / 2;
  var centerY = height / 2;
  var ringGroup = container.append("g").attr("class", "orbital-rings");
  [TIER_CONFIG.hotmem.orbitalRadius, TIER_CONFIG.warmmem.orbitalRadius, TIER_CONFIG.coldmem.orbitalRadius].forEach(function(r) {
    ringGroup.append("circle")
      .attr("cx", centerX).attr("cy", centerY).attr("r", r)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.04)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,8");
  });

  /* ---------- edges ---------- */
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

  /* ---------- nodes (memcards) ---------- */
  var nodeGroup = container.append("g").attr("class", "nodes");
  var nodeElements = nodeGroup.selectAll("g")
    .data(nodes)
    .join("g")
    .attr("cursor", "pointer");

  // Each node is a rounded-rect memcard with keywords inside
  nodeElements.each(function(d) {
    var g = d3.select(this);
    var cfg = TIER_CONFIG[d.tier] || TIER_CONFIG.coldmem;
    var grow = d.isNew ? CARD_NEW_GROW : 0;
    var w = CARD_W + grow;
    var h = CARD_H + grow;
    var borderColor = d.isNew ? NEW_COLOR : cfg.color;
    var bgColor = d.isNew ? "rgba(255,255,255,0.1)" : cfg.bg;

    // Card background
    g.append("rect")
      .attr("width", w).attr("height", h)
      .attr("x", -w / 2).attr("y", -h / 2)
      .attr("rx", CARD_R).attr("ry", CARD_R)
      .attr("fill", bgColor)
      .attr("stroke", borderColor)
      .attr("stroke-width", d.isNew ? 1.8 : 0.8)
      .attr("stroke-opacity", d.isNew ? 1.0 : 0.6);

    // Kind indicator (small colored dot in top-left)
    var kindColor = d.kind === "whisper" ? "#a855f7" : cfg.color;
    g.append("circle")
      .attr("cx", -w / 2 + 8).attr("cy", -h / 2 + 8)
      .attr("r", 3)
      .attr("fill", kindColor)
      .attr("opacity", 0.8);

    // Date label (top-right)
    g.append("text")
      .attr("class", "memcard-date")
      .attr("x", w / 2 - 6).attr("y", -h / 2 + 8)
      .attr("text-anchor", "end")
      .text(cardDate(d.dateTime));

    // Title / keywords (center, up to 2 lines)
    var keywords = cardKeywords(d.title);
    var line1 = truncate(keywords, 10);
    var line2 = keywords.length > 10 ? truncate(keywords.slice(10).trim(), 10) : "";

    if (line2) {
      g.append("text")
        .attr("class", "memcard-title")
        .attr("x", 0).attr("y", -2)
        .text(line1);
      g.append("text")
        .attr("class", "memcard-title")
        .attr("x", 0).attr("y", 10)
        .text(line2);
    } else {
      g.append("text")
        .attr("class", "memcard-title")
        .attr("x", 0).attr("y", 4)
        .text(line1);
    }

    if (d.isNew) {
      g.classed("node-new", true);
    }
  });

  /* ---------- drag ---------- */
  var drag = d3.drag()
    .on("start", function(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", function(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", function(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
  nodeElements.call(drag);

  /* ---------- tooltip ---------- */
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
      // keep within viewport
      if (tx + 320 > window.innerWidth) tx = event.clientX - 330;
      if (ty + 120 > window.innerHeight) ty = event.clientY - 120;
      tooltip.style("left", tx + "px").style("top", ty + "px");
    })
    .on("mouseleave", function() {
      tooltip.classed("visible", false);
    });

  /* ---------- click -> detail panel ---------- */
  nodeElements.on("click", function(event, d) {
    event.stopPropagation();
    showPanel(d);
  });

  svg.on("click", function() {
    closePanel();
  });

  function showPanel(d) {
    document.getElementById("dp-title").textContent = d.title;
    document.getElementById("dp-date").textContent = d.dateTime;
    document.getElementById("dp-brief").textContent = d.brief;
    document.getElementById("dp-kind").textContent = d.kind;
    document.getElementById("dp-source").textContent = d.source;

    // tier badge
    var tierEl = document.getElementById("dp-tier");
    tierEl.innerHTML = '<span class="tier-badge ' + d.tier + '">' + d.tier + '</span>';

    // attendees
    var attEl = document.getElementById("dp-attendees");
    attEl.innerHTML = "";
    (d.attendees || []).forEach(function(a) {
      var tag = document.createElement("span");
      tag.className = "attendee-tag";
      tag.textContent = a;
      attEl.appendChild(tag);
    });

    d3.select("#detail-panel").classed("open", true);
  }

  window.closePanel = function() {
    d3.select("#detail-panel").classed("open", false);
  };

  /* ---------- force simulation ---------- */
  var simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(edges)
      .id(function(d) { return d.id; })
      .distance(function(d) {
        if (d.type === "series") return 50;   // tight cluster
        if (d.type === "project") return 90;  // medium cluster
        if (d.type === "attendee") return 100;
        return 160; // sameDay — loose
      })
      .strength(function(d) {
        if (d.type === "series") return 0.6 + d.weight * 0.05;  // strong pull
        if (d.type === "project") return 0.2 + d.weight * 0.08; // medium pull
        if (d.type === "attendee") return 0.15 + d.weight * 0.1;
        return 0.03; // sameDay — very weak
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
    .on("tick", ticked);

  function ticked() {
    linkElements
      .attr("x1", function(d) { return d.source.x; })
      .attr("y1", function(d) { return d.source.y; })
      .attr("x2", function(d) { return d.target.x; })
      .attr("y2", function(d) { return d.target.y; });

    nodeElements
      .attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
  }

  /* ---------- responsive ---------- */
  window.addEventListener("resize", function() {
    var w = window.innerWidth;
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

})();
</script>
</body>
</html>`;
}
/**
 * Minimal HTML entity escaping for embedding user-provided text in HTML
 * attribute values or text content.
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
//# sourceMappingURL=galaxyHtml.js.map