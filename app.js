/* From Generation to Guarantee - companion site logic.
   Plain vanilla JS, no dependencies. Reads SURVEY_META and PAPERS from data.js. */

(function () {
  "use strict";

  /* ---------- constants ---------- */

  // Lane order for the scatter chart (top to bottom), following the survey axis.
  // These strings must match the `cat` values in data.js exactly.
  var CATEGORIES = [
    "Long-Tail",
    "World Models",
    "VLA",
    "Safety Verification",
    "Benchmarks & Metrics",
    "Surveys",
    "Foundations"
  ];

  var CAT_COLORS = {
    "World Models": "#BA0C2F",
    "VLA": "#1F4E94",
    "Safety Verification": "#00A3AD",
    "Benchmarks & Metrics": "#B4BD00",
    "Long-Tail": "#E08A3C",
    "Surveys": "#7E6BB0",
    "Foundations": "#5F6A72"
  };

  var VENUE_TYPES = ["Journal", "Conference", "Preprint", "Standard"];

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* ---------- helpers ---------- */

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          el.setAttribute(k, attrs[k]);
        }
      }
    }
    return el;
  }

  function el(name, className, text) {
    var node = document.createElement(name);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function hashKey(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function venueType(p) {
    var v = p.venue || "";
    if (/arXiv/i.test(v)) { return "Preprint"; }
    if (/Transactions|Journal|IJCV|Robotics and Automation Letters|Sensors|Nature/.test(v)) {
      return "Journal";
    }
    if (/\b(ISO|SAE|UL)\b/.test(v) || /standard/i.test(v) ||
        (v === "" && /^(ISO|UL|SAE)[\s\d]/.test(p.title))) {
      return "Standard";
    }
    return "Conference";
  }

  function paperLink(p) {
    if (p.arxiv) { return "https://arxiv.org/abs/" + p.arxiv; }
    return "https://scholar.google.com/scholar?q=" +
      encodeURIComponent('"' + p.title + '"');
  }

  /* ---------- enrich papers ---------- */

  PAPERS.forEach(function (p) {
    p._vtype = venueType(p);
    p._link = paperLink(p);
    p._hash = hashKey(p.key);
    p._hay = (p.title + " " + p.authors + " " + p.venue).toLowerCase();
  });

  var catTotals = {};
  CATEGORIES.forEach(function (c) { catTotals[c] = 0; });
  PAPERS.forEach(function (p) {
    if (Object.prototype.hasOwnProperty.call(catTotals, p.cat)) { catTotals[p.cat]++; }
  });

  /* ---------- lineage edges (EDGES from edges.js) ---------- */

  var paperByKey = {};
  PAPERS.forEach(function (p) { paperByKey[p.key] = p; });

  // Edges whose both endpoints exist in the dataset, plus an adjacency map
  // (paper key -> incident links), precomputed once at load.
  var LINEAGE_EDGES = (typeof EDGES !== "undefined" ? EDGES : []).filter(function (e) {
    return paperByKey[e.from] && paperByKey[e.to];
  });
  var ADJ = {};
  LINEAGE_EDGES.forEach(function (e) {
    if (!ADJ[e.from]) { ADJ[e.from] = []; }
    if (!ADJ[e.to]) { ADJ[e.to] = []; }
    ADJ[e.from].push({ other: e.to, rel: e.rel, out: true });
    ADJ[e.to].push({ other: e.from, rel: e.rel, out: false });
  });

  /* ---------- in-corpus citation graph (CITES from cites.js) ----------
     f cites t. Adjacency precomputed once at load; edges are NEVER drawn
     en masse, only for the single hovered or pinned paper (focus mode). */

  var CITE_OUT = {};   // key -> array of paper keys it cites
  var CITE_IN = {};    // key -> array of paper keys citing it
  (typeof CITES !== "undefined" ? CITES : []).forEach(function (c) {
    if (c.f === c.t || !paperByKey[c.f] || !paperByKey[c.t]) { return; }
    if (!CITE_OUT[c.f]) { CITE_OUT[c.f] = []; }
    if (!CITE_IN[c.t]) { CITE_IN[c.t] = []; }
    CITE_OUT[c.f].push(c.t);
    CITE_IN[c.t].push(c.f);
  });

  function citeCounts(key) {
    return {
      out: CITE_OUT[key] ? CITE_OUT[key].length : 0,
      inn: CITE_IN[key] ? CITE_IN[key].length : 0
    };
  }

  /* ---------- state ---------- */

  var filters = {
    cat: new Set(),
    year: new Set(),
    vtype: new Set(),
    link: new Set()
  };
  var query = "";
  var hiddenCats = new Set();   // legend toggles, chart only
  var hiddenTypes = new Set();
  var showEdges = true;         // lineage-link layer toggle

  function passesFilters(p) {
    if (filters.cat.size && !filters.cat.has(p.cat)) { return false; }
    if (filters.year.size && !filters.year.has(String(p.year))) { return false; }
    if (filters.vtype.size && !filters.vtype.has(p._vtype)) { return false; }
    if (filters.link.size && !filters.link.has(p.arxiv ? "has" : "none")) { return false; }
    if (query && p._hay.indexOf(query) === -1) { return false; }
    return true;
  }

  /* ---------- meta fill ---------- */

  document.getElementById("stat-count").textContent = String(SURVEY_META.paperCount);
  document.getElementById("stat-cats").textContent = String(CATEGORIES.length);
  document.getElementById("stat-years").textContent =
    SURVEY_META.yearMin + "–" + SURVEY_META.yearMax;
  var rangeText = SURVEY_META.yearMin + "~" + SURVEY_META.yearMax;
  ["stats-range", "explorer-range", "papers-range"].forEach(function (id) {
    document.getElementById(id).textContent = rangeText;
  });

  /* ---------- filter dropdowns ---------- */

  var ddRow = document.getElementById("dd-row");
  var resetBtn = document.getElementById("reset-btn");
  var allDropdowns = [];

  function createDropdown(filterKey, label, options) {
    var wrap = el("div", "dropdown");
    var btn = el("button", "dd-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-haspopup", "true");
    var panelId = "dd-panel-" + filterKey;
    btn.setAttribute("aria-controls", panelId);
    btn.appendChild(document.createTextNode(label));
    var countBadge = el("span", "dd-count");
    countBadge.hidden = true;
    btn.appendChild(countBadge);
    var caret = el("span", "caret");
    caret.setAttribute("aria-hidden", "true");
    btn.appendChild(caret);

    var panel = el("div", "dd-panel");
    panel.id = panelId;
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", label + " filter options");

    options.forEach(function (opt) {
      var lab = el("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = opt.value;
      cb.addEventListener("change", function () {
        if (cb.checked) { filters[filterKey].add(opt.value); }
        else { filters[filterKey].delete(opt.value); }
        var n = filters[filterKey].size;
        countBadge.textContent = String(n);
        countBadge.hidden = (n === 0);
        render();
      });
      lab.appendChild(cb);
      if (opt.swatch) {
        var sw = el("span", "swatch");
        sw.style.background = opt.swatch;
        lab.appendChild(sw);
      }
      lab.appendChild(document.createTextNode(opt.label));
      panel.appendChild(lab);
    });

    function close() {
      btn.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    }
    function open() {
      allDropdowns.forEach(function (d) { d.close(); });
      btn.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }
    btn.addEventListener("click", function () {
      if (btn.getAttribute("aria-expanded") === "true") { close(); } else { open(); }
    });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") {
        close();
        btn.focus();
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    var dd = { root: wrap, close: close, panel: panel, badge: countBadge, key: filterKey };
    allDropdowns.push(dd);
    return wrap;
  }

  document.addEventListener("click", function (e) {
    allDropdowns.forEach(function (d) {
      if (!d.root.contains(e.target)) { d.close(); }
    });
  });

  var catOptions = CATEGORIES.map(function (c) {
    return { value: c, label: c, swatch: CAT_COLORS[c] };
  });
  var yearsPresent = Array.from(new Set(PAPERS.map(function (p) { return p.year; })))
    .sort(function (a, b) { return b - a; });
  var yearOptions = yearsPresent.map(function (y) {
    return { value: String(y), label: String(y) };
  });
  var typesPresent = VENUE_TYPES.filter(function (t) {
    return PAPERS.some(function (p) { return p._vtype === t; });
  });
  var typeOptions = typesPresent.map(function (t) { return { value: t, label: t }; });
  var linkOptions = [
    { value: "has", label: "Has arXiv link" },
    { value: "none", label: "No arXiv link" }
  ];

  ddRow.insertBefore(createDropdown("cat", "Category", catOptions), resetBtn);
  ddRow.insertBefore(createDropdown("year", "Year", yearOptions), resetBtn);
  ddRow.insertBefore(createDropdown("vtype", "Venue Type", typeOptions), resetBtn);
  ddRow.insertBefore(createDropdown("link", "Link", linkOptions), resetBtn);

  var searchInput = document.getElementById("search");
  searchInput.addEventListener("input", function () {
    query = searchInput.value.trim().toLowerCase();
    render();
  });

  resetBtn.addEventListener("click", function () {
    filters.cat.clear(); filters.year.clear(); filters.vtype.clear(); filters.link.clear();
    hiddenCats.clear(); hiddenTypes.clear();
    showEdges = true;
    pinnedKey = null;   // release any pinned citation focus
    query = "";
    searchInput.value = "";
    allDropdowns.forEach(function (d) {
      d.badge.hidden = true;
      d.badge.textContent = "";
      var boxes = d.panel.querySelectorAll("input[type=checkbox]");
      for (var i = 0; i < boxes.length; i++) { boxes[i].checked = false; }
    });
    var items = document.querySelectorAll(".legend-item");
    for (var i = 0; i < items.length; i++) { items[i].setAttribute("aria-pressed", "true"); }
    render();
  });

  /* ---------- legend ---------- */

  function shapeGlyph(type, color, size) {
    var s = size || 14;
    var c = s / 2;
    var svg = svgEl("svg", { width: s, height: s, "aria-hidden": "true" });
    var shape;
    if (type === "Journal") {
      shape = svgEl("circle", { cx: c, cy: c, r: c - 2, fill: color });
    } else if (type === "Conference") {
      shape = svgEl("polygon", {
        points: c + "," + 1 + " " + (s - 1) + "," + (s - 1) + " 1," + (s - 1),
        fill: color
      });
    } else if (type === "Preprint") {
      shape = svgEl("rect", { x: 2, y: 2, width: s - 4, height: s - 4, fill: color });
    } else {
      shape = svgEl("polygon", {
        points: c + ",1 " + (s - 1) + "," + c + " " + c + "," + (s - 1) + " 1," + c,
        fill: color
      });
    }
    svg.appendChild(shape);
    return svg;
  }

  var legendBox = document.getElementById("legend");

  function buildLegend() {
    var catGroup = el("div", "legend-group");
    catGroup.appendChild(el("span", "legend-group-title", "Research area"));
    CATEGORIES.forEach(function (c) {
      var b = el("button", "legend-item");
      b.type = "button";
      b.setAttribute("aria-pressed", "true");
      var sw = el("span", "swatch");
      sw.style.background = CAT_COLORS[c];
      b.appendChild(sw);
      b.appendChild(document.createTextNode(c + " "));
      b.appendChild(el("span", "legend-count", String(catTotals[c])));
      b.addEventListener("click", function () {
        if (hiddenCats.has(c)) { hiddenCats.delete(c); b.setAttribute("aria-pressed", "true"); }
        else { hiddenCats.add(c); b.setAttribute("aria-pressed", "false"); }
        renderScatter(currentFiltered);
      });
      catGroup.appendChild(b);
    });
    legendBox.appendChild(catGroup);

    var typeGroup = el("div", "legend-group");
    typeGroup.appendChild(el("span", "legend-group-title", "Venue type"));
    typesPresent.forEach(function (t) {
      var b = el("button", "legend-item");
      b.type = "button";
      b.setAttribute("aria-pressed", "true");
      b.appendChild(shapeGlyph(t, "#444444", 13));
      b.appendChild(document.createTextNode(t));
      b.addEventListener("click", function () {
        if (hiddenTypes.has(t)) { hiddenTypes.delete(t); b.setAttribute("aria-pressed", "true"); }
        else { hiddenTypes.add(t); b.setAttribute("aria-pressed", "false"); }
        renderScatter(currentFiltered);
      });
      typeGroup.appendChild(b);
    });
    legendBox.appendChild(typeGroup);

    var edgeGroupBox = el("div", "legend-group");
    edgeGroupBox.appendChild(el("span", "legend-group-title", "Lineage"));
    var eb = el("button", "legend-item");
    eb.type = "button";
    eb.setAttribute("aria-pressed", "true");
    var glyph = svgEl("svg", { width: 18, height: 13, "aria-hidden": "true" });
    glyph.appendChild(svgEl("path", {
      d: "M 2 11 Q 9 1 16 11", fill: "none",
      stroke: "#9AA3AB", "stroke-width": 1.5
    }));
    eb.appendChild(glyph);
    eb.appendChild(document.createTextNode("Lineage links "));
    eb.appendChild(el("span", "legend-count", String(LINEAGE_EDGES.length)));
    eb.addEventListener("click", function () {
      showEdges = !showEdges;
      eb.setAttribute("aria-pressed", showEdges ? "true" : "false");
      renderScatter(currentFiltered);
    });
    edgeGroupBox.appendChild(eb);
    legendBox.appendChild(edgeGroupBox);
  }

  /* ---------- scatter chart ---------- */

  var scatter = document.getElementById("scatter");
  var tooltip = document.getElementById("tooltip");
  var chartWrap = document.querySelector(".chart-wrap");

  var X_MIN = SURVEY_META.yearMin;
  var X_MAX = 2026;
  var YEAR_W = 26;
  var LANE_H = 56;
  var MARGIN = { top: 14, right: 22, bottom: 38, left: 168 };
  var PLOT_W = (X_MAX - X_MIN + 1) * YEAR_W;
  var CHART_W = MARGIN.left + PLOT_W + MARGIN.right;
  var CHART_H = MARGIN.top + CATEGORIES.length * LANE_H + MARGIN.bottom;

  scatter.setAttribute("width", CHART_W);
  scatter.setAttribute("height", CHART_H);
  scatter.setAttribute("viewBox", "0 0 " + CHART_W + " " + CHART_H);

  function xPos(year) {
    return MARGIN.left + (year - X_MIN) * YEAR_W + YEAR_W / 2;
  }
  function laneCenter(i) {
    return MARGIN.top + i * LANE_H + LANE_H / 2;
  }

  function markerEl(p, x, y) {
    var color = CAT_COLORS[p.cat] || "#5F6A72";
    var shape;
    if (p._vtype === "Journal") {
      shape = svgEl("circle", { cx: x, cy: y, r: 5, fill: color });
    } else if (p._vtype === "Conference") {
      shape = svgEl("polygon", {
        points: x + "," + (y - 6) + " " + (x - 5.5) + "," + (y + 4.5) +
                " " + (x + 5.5) + "," + (y + 4.5),
        fill: color
      });
    } else if (p._vtype === "Preprint") {
      shape = svgEl("rect", { x: x - 4.5, y: y - 4.5, width: 9, height: 9, fill: color });
    } else {
      shape = svgEl("polygon", {
        points: x + "," + (y - 6) + " " + (x + 6) + "," + y + " " +
                x + "," + (y + 6) + " " + (x - 6) + "," + y,
        fill: color
      });
    }
    shape.setAttribute("class", "marker");
    return shape;
  }

  var renderedPapers = [];
  var renderedMarkers = [];   // marker elements, parallel to renderedPapers
  var edgePathsByKey = {};    // paper key -> incident edge path elements
  var markerPosByKey = {};    // paper key -> {x, y} for visible markers only
  var focusLayerEl = null;    // citation focus layer (rebuilt per render)

  function renderScatter(papers) {
    while (scatter.firstChild) { scatter.removeChild(scatter.firstChild); }
    renderedPapers = [];
    renderedMarkers = [];
    edgePathsByKey = {};
    markerPosByKey = {};
    hiPaths = [];
    hiMarkers = [];

    var i, y, x;

    // vertical gridlines + year tick labels (every 5 years)
    for (y = X_MIN; y <= X_MAX; y++) {
      if (y % 5 === 0) {
        x = xPos(y);
        scatter.appendChild(svgEl("line", {
          x1: x, y1: MARGIN.top, x2: x,
          y2: MARGIN.top + CATEGORIES.length * LANE_H,
          "class": "grid-line"
        }));
        var tick = svgEl("text", {
          x: x, y: MARGIN.top + CATEGORIES.length * LANE_H + 22,
          "text-anchor": "middle", "class": "tick-label"
        });
        tick.textContent = String(y);
        scatter.appendChild(tick);
      }
    }

    // lane separators + labels
    for (i = 0; i <= CATEGORIES.length; i++) {
      scatter.appendChild(svgEl("line", {
        x1: MARGIN.left - 4, y1: MARGIN.top + i * LANE_H,
        x2: CHART_W - MARGIN.right, y2: MARGIN.top + i * LANE_H,
        "class": "lane-line"
      }));
    }
    CATEGORIES.forEach(function (c, idx) {
      var label = svgEl("text", {
        x: MARGIN.left - 12, y: laneCenter(idx) + 4,
        "text-anchor": "end", "class": "lane-label"
      });
      label.textContent = c;
      scatter.appendChild(label);
    });

    // lineage edge layer sits beneath the marker layer so points stay on top;
    // the citation focus layer sits between them: above lineage, below markers
    var edgeLayer = svgEl("g", { "class": "edge-layer" });
    scatter.appendChild(edgeLayer);
    focusLayerEl = svgEl("g", { "class": "focus-layer" });
    scatter.appendChild(focusLayerEl);
    var markerLayer = svgEl("g", { "class": "marker-layer" });
    scatter.appendChild(markerLayer);

    // markers
    var laneIndex = {};
    CATEGORIES.forEach(function (c, idx) { laneIndex[c] = idx; });
    var markerPos = markerPosByKey;
    papers.forEach(function (p) {
      if (hiddenCats.has(p.cat) || hiddenTypes.has(p._vtype)) { return; }
      var li = laneIndex[p.cat];
      if (li === undefined) { return; }
      var dx = ((p._hash % 100) / 100 - 0.5) * (YEAR_W * 0.66);
      var dy = ((Math.floor(p._hash / 128) % 100) / 100 - 0.5) * (LANE_H * 0.62);
      var mx = xPos(p.year) + dx;
      var my = laneCenter(li) + dy;
      var m = markerEl(p, mx, my);
      m.setAttribute("data-i", String(renderedPapers.length));
      renderedPapers.push(p);
      renderedMarkers.push(m);
      markerPos[p.key] = { x: mx, y: my };
      markerLayer.appendChild(m);
    });

    // lineage edges: drawn only when both endpoints are currently visible
    if (showEdges) {
      LINEAGE_EDGES.forEach(function (e) {
        var a = markerPos[e.from];
        var b = markerPos[e.to];
        if (!a || !b) { return; }
        var midX = (a.x + b.x) / 2;
        var span = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        var lift = Math.min(38, 10 + span * 0.14);
        var ctrlY = Math.min(a.y, b.y) - lift;   // gentle upward bow
        var d = "M " + a.x.toFixed(1) + " " + a.y.toFixed(1) +
                " Q " + midX.toFixed(1) + " " + ctrlY.toFixed(1) +
                " " + b.x.toFixed(1) + " " + b.y.toFixed(1);
        var path = svgEl("path", {
          d: d, "class": "edge",
          "data-from": e.from, "data-to": e.to
        });
        edgeLayer.appendChild(path);
        if (!edgePathsByKey[e.from]) { edgePathsByKey[e.from] = []; }
        if (!edgePathsByKey[e.to]) { edgePathsByKey[e.to] = []; }
        edgePathsByKey[e.from].push(path);
        edgePathsByKey[e.to].push(path);
      });
    }

    // a pinned citation focus survives re-renders while its paper stays
    // visible; otherwise the pin is dropped silently
    if (pinnedKey) {
      if (markerPosByKey[pinnedKey]) {
        applyFocus(paperByKey[pinnedKey]);
      } else {
        pinnedKey = null;
      }
      updateCountLine();
    }
  }

  function showTooltip(p, evt) {
    while (tooltip.firstChild) { tooltip.removeChild(tooltip.firstChild); }
    tooltip.appendChild(el("div", "tt-title", p.title));
    tooltip.appendChild(el("div", "tt-meta", p.authors));
    var venueLine = (p.venue ? p.venue + ", " : "") + p.year +
      " · " + p._vtype;
    tooltip.appendChild(el("div", "tt-meta", venueLine));
    var adj = ADJ[p.key];
    if (adj && adj.length) {
      var parts = adj.map(function (a) {
        return a.rel + (a.out ? " → " : " ← ") + a.other;
      });
      tooltip.appendChild(el("div", "tt-lineage",
        "Lineage: " + parts.join("; ") + " (" + adj.length +
        (adj.length === 1 ? " link)" : " links)")));
    }
    var cc = citeCounts(p.key);
    tooltip.appendChild(el("div", "tt-cites",
      "In-corpus: cites " + cc.out + " / cited by " + cc.inn));
    tooltip.hidden = false;
    moveTooltip(evt);
  }

  function moveTooltip(evt) {
    var rect = chartWrap.getBoundingClientRect();
    var left = evt.clientX - rect.left + 16;
    var top = evt.clientY - rect.top + 16;
    if (left + tooltip.offsetWidth > chartWrap.clientWidth - 4) {
      left = evt.clientX - rect.left - tooltip.offsetWidth - 14;
      if (left < 4) { left = 4; }
    }
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  /* ---------- citation focus mode (hover = transient, click = pinned) ----------
     The default view never shows citation edges. Hovering a marker overlays
     that one paper's in-corpus citations in the focus layer (outgoing solid
     in the category colour, incoming dashed grey) on top of the existing
     lineage highlight; everything vanishes on pointerleave. Clicking a
     marker pins the focus; Esc or a click on empty chart background
     releases it. Opening the paper link moved to double-click. */

  var hiPaths = [];        // lineage edge paths currently highlighted
  var hiMarkers = [];      // markers with a temporary class applied
  var pinnedKey = null;    // key of the click-pinned paper, or null

  function drawFocusEdges(p) {
    var origin = markerPosByKey[p.key];
    var connected = {};
    if (!origin || !focusLayerEl) { return connected; }
    var color = CAT_COLORS[p.cat] || "#5F6A72";
    (CITE_OUT[p.key] || []).forEach(function (t) {
      var pos = markerPosByKey[t];
      if (!pos) { return; }
      focusLayerEl.appendChild(svgEl("line", {
        x1: origin.x.toFixed(1), y1: origin.y.toFixed(1),
        x2: pos.x.toFixed(1), y2: pos.y.toFixed(1),
        "class": "cite-out", stroke: color
      }));
      connected[t] = true;
    });
    (CITE_IN[p.key] || []).forEach(function (s) {
      var pos = markerPosByKey[s];
      if (!pos) { return; }
      focusLayerEl.appendChild(svgEl("line", {
        x1: pos.x.toFixed(1), y1: pos.y.toFixed(1),
        x2: origin.x.toFixed(1), y2: origin.y.toFixed(1),
        "class": "cite-in"
      }));
      connected[s] = true;
    });
    return connected;
  }

  function applyFocus(p) {
    clearFocus();
    var color = CAT_COLORS[p.cat] || "#5F6A72";
    var connected = {};
    var k;
    connected[p.key] = true;

    // existing lineage highlight
    var incident = edgePathsByKey[p.key] || [];
    incident.forEach(function (path) {
      path.classList.add("edge-hi");
      path.style.stroke = color;
      connected[path.getAttribute("data-from")] = true;
      connected[path.getAttribute("data-to")] = true;
      hiPaths.push(path);
    });

    // this paper's citation neighbourhood, restricted to visible markers
    var cited = drawFocusEdges(p);
    for (k in cited) {
      if (Object.prototype.hasOwnProperty.call(cited, k)) { connected[k] = true; }
    }

    if (!incident.length && !focusLayerEl.firstChild) { return; }
    renderedMarkers.forEach(function (m, i) {
      var key = renderedPapers[i].key;
      if (connected[key]) {
        if (key !== p.key) {
          m.classList.add("marker-connected");
          hiMarkers.push(m);
        }
      } else {
        m.classList.add("marker-dim");
        hiMarkers.push(m);
      }
    });
  }

  function clearFocus() {
    hiPaths.forEach(function (path) {
      path.classList.remove("edge-hi");
      path.style.stroke = "";
    });
    hiMarkers.forEach(function (m) {
      m.classList.remove("marker-connected");
      m.classList.remove("marker-dim");
    });
    hiPaths = [];
    hiMarkers = [];
    if (focusLayerEl) {
      while (focusLayerEl.firstChild) {
        focusLayerEl.removeChild(focusLayerEl.firstChild);
      }
    }
  }

  function shortTitle(p) {
    var t = p.title;
    if (t.length <= 60) { return t; }
    return t.slice(0, 57).replace(/\s+\S*$/, "") + "…";
  }

  function pinFocus(p) {
    pinnedKey = p.key;
    applyFocus(p);
    updateCountLine();
  }

  function unpinFocus() {
    if (!pinnedKey) { return; }
    pinnedKey = null;
    clearFocus();
    updateCountLine();
  }

  scatter.addEventListener("mouseover", function (e) {
    var idx = e.target.getAttribute && e.target.getAttribute("data-i");
    if (idx !== null && idx !== undefined && idx !== "") {
      var p = renderedPapers[Number(idx)];
      showTooltip(p, e);
      if (!pinnedKey) { applyFocus(p); }
    }
  });
  scatter.addEventListener("mousemove", function (e) {
    if (!tooltip.hidden) { moveTooltip(e); }
  });
  scatter.addEventListener("mouseout", function (e) {
    var idx = e.target.getAttribute && e.target.getAttribute("data-i");
    if (idx !== null && idx !== undefined && idx !== "") {
      tooltip.hidden = true;
      if (!pinnedKey) { clearFocus(); }
    }
  });
  scatter.addEventListener("click", function (e) {
    var idx = e.target.getAttribute && e.target.getAttribute("data-i");
    if (idx !== null && idx !== undefined && idx !== "") {
      pinFocus(renderedPapers[Number(idx)]);
    } else if (pinnedKey) {
      unpinFocus();   // click on empty chart background releases the pin
    }
  });
  scatter.addEventListener("dblclick", function (e) {
    var idx = e.target.getAttribute && e.target.getAttribute("data-i");
    if (idx !== null && idx !== undefined && idx !== "") {
      window.open(renderedPapers[Number(idx)]._link, "_blank", "noopener");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { unpinFocus(); }
  });

  /* ---------- statistics charts (full dataset, computed once) ---------- */

  function renderCatBars() {
    var svg = document.getElementById("cat-bars");
    var rowH = 36;
    var W = 520;
    var H = CATEGORIES.length * rowH + 6;
    var labelX = 158;
    var barX = 168;
    var maxBar = W - barX - 46;
    var max = 0;
    CATEGORIES.forEach(function (c) { if (catTotals[c] > max) { max = catTotals[c]; } });
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    CATEGORIES.forEach(function (c, i) {
      var yTop = 4 + i * rowH;
      var n = catTotals[c];
      var w = max ? Math.max(2, (n / max) * maxBar) : 2;
      var label = svgEl("text", {
        x: labelX, y: yTop + 18, "text-anchor": "end", "class": "bar-label"
      });
      label.textContent = c;
      svg.appendChild(label);
      var bar = svgEl("rect", {
        x: barX, y: yTop + 5, width: w, height: 18, rx: 3, fill: CAT_COLORS[c]
      });
      var t = svgEl("title");
      t.textContent = c + ": " + n + " papers";
      bar.appendChild(t);
      svg.appendChild(bar);
      var val = svgEl("text", {
        x: barX + w + 7, y: yTop + 18, "class": "bar-value"
      });
      val.textContent = String(n);
      svg.appendChild(val);
    });
  }

  function renderYearBars() {
    var svg = document.getElementById("year-bars");
    var W = 520;
    var H = 230;
    var x0 = 12;
    var baseline = 198;
    var plotH = 178;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var years = [];
    var counts = {};
    var y;
    for (y = SURVEY_META.yearMin; y <= SURVEY_META.yearMax; y++) {
      years.push(y);
      counts[y] = 0;
    }
    PAPERS.forEach(function (p) {
      if (counts[p.year] !== undefined) { counts[p.year]++; }
    });
    var max = 0;
    years.forEach(function (yy) { if (counts[yy] > max) { max = counts[yy]; } });
    var step = (W - x0 - 8) / years.length;
    var barW = Math.max(4, step - 3);
    svg.appendChild(svgEl("line", {
      x1: x0 - 4, y1: baseline, x2: W - 6, y2: baseline,
      stroke: "#D7D7D7", "stroke-width": 1
    }));
    years.forEach(function (yy, i) {
      var n = counts[yy];
      var h = max ? (n / max) * plotH : 0;
      if (n > 0 && h < 2) { h = 2; }
      var bx = x0 + i * step;
      var bar = svgEl("rect", {
        x: bx, y: baseline - h, width: barW, height: h, fill: "#BA0C2F"
      });
      var t = svgEl("title");
      t.textContent = yy + ": " + n + (n === 1 ? " paper" : " papers");
      bar.appendChild(t);
      svg.appendChild(bar);
      if (yy % 5 === 0 || yy === SURVEY_META.yearMax) {
        var lab = svgEl("text", {
          x: bx + barW / 2, y: baseline + 16,
          "text-anchor": "middle", "class": "axis-label"
        });
        lab.textContent = String(yy);
        svg.appendChild(lab);
      }
    });
  }

  /* ---------- paper list ---------- */

  var groupsBox = document.getElementById("paper-groups");
  var groupRefs = {};

  function buildGroups() {
    CATEGORIES.forEach(function (c) {
      var details = el("details", "paper-group");
      var summary = el("summary");
      var dot = el("span", "dot");
      dot.style.background = CAT_COLORS[c];
      summary.appendChild(dot);
      summary.appendChild(document.createTextNode(c));
      var badge = el("span", "badge", String(catTotals[c]));
      summary.appendChild(badge);
      summary.appendChild(el("span", "chevron"));
      details.appendChild(summary);

      var scrollBox = el("div", "table-scroll");
      var table = el("table", "paper-table");
      var thead = el("thead");
      var hr = el("tr");
      ["Title", "Authors", "Venue", "Year", "Link"].forEach(function (h) {
        hr.appendChild(el("th", null, h));
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el("tbody");
      table.appendChild(tbody);
      scrollBox.appendChild(table);
      details.appendChild(scrollBox);
      groupsBox.appendChild(details);
      groupRefs[c] = { tbody: tbody, badge: badge };
    });
  }

  function renderTables(filtered) {
    var byCat = {};
    CATEGORIES.forEach(function (c) { byCat[c] = []; });
    filtered.forEach(function (p) {
      if (byCat[p.cat]) { byCat[p.cat].push(p); }
    });
    CATEGORIES.forEach(function (c) {
      var rows = byCat[c].slice().sort(function (a, b) {
        return (b.year - a.year) || a.title.localeCompare(b.title);
      });
      var ref = groupRefs[c];
      var total = catTotals[c];
      ref.badge.textContent = (rows.length === total)
        ? String(total)
        : rows.length + " of " + total;
      var tbody = ref.tbody;
      while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }
      if (!rows.length) {
        var tr = el("tr", "empty-row");
        var td = el("td", null, "No papers match the current filters.");
        td.colSpan = 5;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }
      rows.forEach(function (p) {
        var tr = el("tr");
        tr.appendChild(el("td", "t-title", p.title));
        tr.appendChild(el("td", "t-authors", p.authors));
        tr.appendChild(el("td", "t-venue", p.venue || "—"));
        tr.appendChild(el("td", "t-year", String(p.year)));
        var tdLink = el("td", "t-link");
        var a = el("a", null, p.arxiv ? "arXiv" : "Scholar");
        a.href = p._link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("aria-label",
          (p.arxiv ? "Open on arXiv: " : "Search on Google Scholar: ") + p.title);
        tdLink.appendChild(a);
        tr.appendChild(tdLink);
        tbody.appendChild(tr);
      });
    });
  }

  /* ---------- main render ---------- */

  var countBox = document.getElementById("count");
  var currentFiltered = PAPERS;

  // The live-count line doubles as the focus-mode status line (aria-live).
  function updateCountLine() {
    if (pinnedKey && paperByKey[pinnedKey]) {
      var p = paperByKey[pinnedKey];
      var c = citeCounts(pinnedKey);
      countBox.textContent = "Focused: " + shortTitle(p) +
        " - cites " + c.out + " / cited by " + c.inn +
        " in this corpus (Esc to exit)";
    } else {
      countBox.textContent = "Showing " + currentFiltered.length + " of " +
        SURVEY_META.paperCount + " papers";
    }
  }

  function render() {
    currentFiltered = PAPERS.filter(passesFilters);
    renderScatter(currentFiltered);
    renderTables(currentFiltered);
    updateCountLine();
  }

  /* ---------- citation copy ---------- */

  var copyBtn = document.getElementById("copy-cite");
  var citeBlock = document.getElementById("cite-text");
  copyBtn.addEventListener("click", function () {
    var text = citeBlock.textContent;
    function flash(msg) {
      copyBtn.textContent = msg;
      setTimeout(function () { copyBtn.textContent = "Copy citation"; }, 1600);
    }
    function legacyCopy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) { flash("Copied!"); return; }
      } catch (err) { /* fall through */ }
      var range = document.createRange();
      range.selectNodeContents(citeBlock);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      flash("Press Ctrl+C");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash("Copied!"); },
        legacyCopy);
    } else {
      legacyCopy();
    }
  });

  /* ---------- nav scroll spy ---------- */

  var sections = Array.prototype.slice.call(
    document.querySelectorAll("main section[id]"));
  var navLinks = {};
  Array.prototype.forEach.call(
    document.querySelectorAll(".nav-pills a"), function (a) {
      navLinks[a.getAttribute("href").slice(1)] = a;
    });

  var spyPending = false;
  function spy() {
    spyPending = false;
    var activeId = sections[0].id;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= 110) {
        activeId = sections[i].id;
      }
    }
    for (var id in navLinks) {
      if (Object.prototype.hasOwnProperty.call(navLinks, id)) {
        navLinks[id].classList.toggle("active", id === activeId);
      }
    }
  }
  window.addEventListener("scroll", function () {
    if (!spyPending) {
      spyPending = true;
      window.requestAnimationFrame(spy);
    }
  }, { passive: true });

  /* ---------- init ---------- */

  buildLegend();
  buildGroups();
  renderCatBars();
  renderYearBars();
  render();
  spy();

  // Deep link: ?focus=<paper key> pins that paper's citation neighbourhood
  // on load. Unknown or currently hidden keys are ignored; harmless otherwise.
  var focusParam = /[?&]focus=([A-Za-z0-9_]+)/.exec(window.location.search);
  if (focusParam && paperByKey[focusParam[1]] && markerPosByKey[focusParam[1]]) {
    pinFocus(paperByKey[focusParam[1]]);
  }
})();
