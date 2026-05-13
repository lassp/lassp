// js/map.js

// =======================
// Units + constants
// =======================
const UNITS = Object.freeze({
  kmToMeters: 1000,
  kmToMiles: 0.621371,
  miToKilometers: 1.609344,
  kmToFeet: 3280.84,
  ftToMeters: 0.3048,
});
const unitConvertFtToKilometers = UNITS.ftToMeters / 1000;

// =======================
// LASSP: The Sun
// =======================
const SUN = Object.freeze({
  title: "The Sun",
  bodyParagraphs: [
    "The sun is a mass of incandescent gas",
    "A gigantic nuclear furnace",
    "Where hydrogen is built into helium",
    "At a temperature of millions of degrees.",
  ],

  // Center of the whole installation (also used as default map center)
  lat: 34.118132,
  lng: -118.300373,

  // Physical + scaled size
  diameterKm: 1392700,
  scaledDiameterFeet: 83,

  // GroundOverlay
  overlay: {
    imgSrc: "./img/sun-icon.png",
    bounds: {
      sw: { lat: 34.118005, lng: -118.300538 },
      ne: { lat: 34.118265, lng: -118.300209 },
    },
  },

  // Mini-map marker appearance (no fetch; inline glyph)
  markerStyle: {
    bgColor: "#fff200",
    iconColor: "#111827",
    glyphSvg: `
    <svg
      viewBox="0 0 48.5 48.5"
      aria-hidden="true"
      version="1.1"
      id="svg1"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:svg="http://www.w3.org/2000/svg">
      <defs
        id="defs1" />
      <path
        fill="#231F20"
        d="M24.25,17.869c-3.524,0-6.381,2.857-6.381,6.381s2.857,6.382,6.381,6.382c3.525,0,6.382-2.857,6.382-6.382  S27.775,17.869,24.25,17.869z M24.25,0C10.857,0,0,10.857,0,24.25S10.857,48.5,24.25,48.5c13.394,0,24.25-10.857,24.25-24.25  S37.643,0,24.25,0z M24.25,44.323c-11.085,0-20.072-8.987-20.072-20.073c0-11.086,8.987-20.073,20.072-20.073  c11.086,0,20.073,8.987,20.073,20.073C44.323,35.336,35.335,44.323,24.25,44.323z"
        id="path1" />
    </svg>
    `.trim(),
  },
});

function sunCenter() {
  return { lat: SUN.lat, lng: SUN.lng };
}

function sunOverlayBoundsLatLng() {
  return new google.maps.LatLngBounds(
    new google.maps.LatLng(
      SUN.overlay.bounds.sw.lat,
      SUN.overlay.bounds.sw.lng,
    ),
    new google.maps.LatLng(
      SUN.overlay.bounds.ne.lat,
      SUN.overlay.bounds.ne.lng,
    ),
  );
}

function sunScaleFactor() {
  const scaledKm = SUN.scaledDiameterFeet * unitConvertFtToKilometers;
  return scaledKm / SUN.diameterKm;
}

const scaleFactor = sunScaleFactor();

// =======================
// Bodies
// =======================
let bodies = [];

async function loadBodiesFromJson(jsonUrl) {
  const res = await fetch(jsonUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed to load bodies JSON: ${res.status} ${res.statusText}`,
    );
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Bodies JSON is not an array.");
  }

  // Light validation + normalization
  return data
    .filter((b) => b && typeof b === "object" && typeof b.name === "string")
    .map((b) => ({
      name: String(b.name),
      bodyParagraphs: Array.isArray(b.bodyParagraphs)
        ? b.bodyParagraphs.map((p) => String(p || "")).filter(Boolean)
        : [],
      perihelionKilometers: Number(b.perihelionKilometers),
      aphelionKilometers: Number(b.aphelionKilometers),
      strokeColor: String(b.strokeColor || "#0000FF"),
      strokeOpacity: Number.isFinite(Number(b.strokeOpacity))
        ? Number(b.strokeOpacity)
        : 0.8,
      strokeWeight: Number.isFinite(Number(b.strokeWeight))
        ? Number(b.strokeWeight)
        : 0,
      fillColor: String(b.fillColor || "#00FFF8"),
      fillOpacity: Number.isFinite(Number(b.fillOpacity))
        ? Number(b.fillOpacity)
        : 0.35,
      markerTitle: typeof b.markerTitle === "string" ? b.markerTitle.trim() : "",
      markers: Array.isArray(b.markers) ? b.markers : [],
    }));
}

// Map in global scope (used by other helpers)
let map;

const zoomLevels = [20, 18, 16, 13, 10, 8];
// Exponential delays: base × 2^(step-1), where base = 15000 / (2^5 − 1) ≈ 484ms
// Gaps: ~484ms, ~968ms, ~1935ms, ~3871ms, ~7742ms → total ≈ 15 000ms
const ZOOM_DELAY_BASE = 15000 / (Math.pow(2, zoomLevels.length - 1) - 1);
let zoomIndex = 1;
let intervalId;
let _zoomingOut = false;

// =======================
// Zoom progress bar
// =======================
function _getZoomProgressBar() {
  let bar = document.getElementById("zoom-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "zoom-progress";
    bar.innerHTML = '<div id="zoom-progress-fill"></div>';
    // Append to .map-wrap (parent of #map-canvas) so it shares
    // the same positioning context as the Expand Map button.
    const container = map.getDiv().parentElement || map.getDiv();
    container.appendChild(bar);
  }
  return bar;
}

function _animateZoomProgress(durationMs) {
  const bar = _getZoomProgressBar();
  const fill = bar.querySelector("#zoom-progress-fill");
  // Reset without transition, then kick off the fill
  fill.style.transition = "none";
  fill.style.width = "0%";
  bar.hidden = false;
  void fill.offsetWidth; // force reflow
  fill.style.transition = `width ${durationMs}ms linear`;
  fill.style.width = "100%";
}

function _hideZoomProgress() {
  const bar = document.getElementById("zoom-progress");
  if (bar) bar.hidden = true;
}

function cancelZoom() {
  clearTimeout(intervalId);
  _hideZoomProgress();
}

function scheduleNextZoom() {
  if (zoomIndex >= zoomLevels.length) return;
  const delay = ZOOM_DELAY_BASE * Math.pow(2, zoomIndex - 1);
  _animateZoomProgress(delay);
  intervalId = setTimeout(function () {
    if (zoomIndex >= zoomLevels.length) return;
    _zoomingOut = true;
    map.setZoom(zoomLevels[zoomIndex++]);
    _zoomingOut = false;
    if (zoomIndex >= zoomLevels.length) {
      _hideZoomProgress();
    } else {
      scheduleNextZoom();
    }
  }, delay);
}

const d2r = Math.PI / 180;
const r2d = 180 / Math.PI;
const earthsradius = 6378;

function drawCircle(point, radius, dir) {
  const rlat = (radius / earthsradius) * r2d;
  const rlng = rlat / Math.cos(point.lat() * d2r);

  const extp = [];
  let i = dir === 1 ? 0 : 32;

  while (dir === 1 ? i < 33 : i > 0) {
    const theta = Math.PI * (i / 16);
    const ey = point.lng() + rlng * Math.cos(theta);
    const ex = point.lat() + rlat * Math.sin(theta);
    extp.push(new google.maps.LatLng(ex, ey));
    i = i + dir;
  }
  return extp;
}

// =======================
// Overlay loader (markers from JSON)
// =======================
async function loadMapOverlaysFromJson(jsonUrl, opts = {}) {
  const tpl = document.getElementById("map-overlay-template");
  const mount = document.getElementById("map-overlay-mount");
  if (!tpl || !mount) return;

  const imgBaseUrl =
    typeof opts.imgBaseUrl === "string" ? opts.imgBaseUrl : "./img/";

  const res = await fetch(jsonUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed to load overlays JSON: ${res.status} ${res.statusText}`,
    );
  }

  const overlays = await res.json();
  if (!Array.isArray(overlays)) return;

  mount.innerHTML = "";

  const iconCache = new Map(); // url -> svgText

  async function fetchSvgText(iconPath) {
    const cleanPath = String(iconPath || "").trim();
    if (!cleanPath) return "";

    const url =
      /^https?:\/\//i.test(cleanPath) || cleanPath.startsWith("/")
        ? cleanPath
        : imgBaseUrl.replace(/\/?$/, "/") + cleanPath.replace(/^\//, "");

    if (iconCache.has(url)) return iconCache.get(url);

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      console.warn(`Icon SVG not found: ${url} (${r.status})`);
      iconCache.set(url, "");
      return "";
    }
    const txt = await r.text();
    iconCache.set(url, txt);
    return txt;
  }

  for (const item of overlays) {
    if (!item || typeof item !== "object") continue;
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
    if (!item.title) continue;

    const iconSvg = await fetchSvgText(item.iconPath);

    // Use the template, but inject body/title safely after parsing
    const wrapper = document.createElement("div");
    wrapper.innerHTML = tpl.innerHTML
      .replaceAll("{{lat}}", String(item.lat))
      .replaceAll("{{lng}}", String(item.lng))
      .replaceAll("{{color}}", String(item.color || "#0087CD"))
      .replaceAll("{{textColor}}", String(item.textColor || "#ffffff"))
      // placeholders for title/body/icon are filled post-parse
      .replaceAll("{{title}}", "")
      .replaceAll("{{bodyHtml}}", "")
      .replaceAll("{{iconSvg}}", "")
      .trim();

    const node = wrapper.firstElementChild;
    if (!node) continue;

    // Title (text)
    const titleEl = node.querySelector("[data-overlay-title]");
    if (titleEl) titleEl.textContent = String(item.title);

    // Body (DOM-safe; paragraphs-only)
    const bodyEl = node.querySelector("[data-overlay-body]");
    if (bodyEl) {
      bodyEl.innerHTML = "";
      _lasspAppendParagraphs(
        bodyEl,
        Array.isArray(item.bodyParagraphs) ? item.bodyParagraphs : [],
      );
    }

    // Icon SVG (raw markup) in hidden child node
    const iconEl = node.querySelector(".map-overlay-icon");
    if (iconEl) iconEl.innerHTML = String(iconSvg || "");

    if (Number.isFinite(item.hideAtZoom)) {
      node.dataset.hideAtZoom = String(item.hideAtZoom);
    }

    if (item.illustrationPath) {
      node.dataset.illustrationPath = String(item.illustrationPath).trim();
    }

    mount.appendChild(node);
  }
}

// =======================
// Shared helpers
// =======================

function _lasspAppendParagraphs(hostEl, paragraphs) {
  const paras = Array.isArray(paragraphs) ? paragraphs : [];
  for (const t of paras) {
    const p = document.createElement("p");
    p.textContent = String(t || "");
    hostEl.appendChild(p);
  }
}

function _lasspEscapeAttr(s) {
  return String(s).replace(/["'<>]/g, "");
}

function _lasspParseSvg(iconSVG) {
  const raw = String(iconSVG || "").trim();
  if (!raw) return null;

  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg") return null;

  let vbX = 0,
    vbY = 0,
    vbW = 64,
    vbH = 64;
  const vb = svg.getAttribute("viewBox");

  if (vb) {
    const parts = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      [vbX, vbY, vbW, vbH] = parts;
    }
  } else {
    const w = Number(svg.getAttribute("width"));
    const h = Number(svg.getAttribute("height"));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      vbW = w;
      vbH = h;
    }
  }

  const inner = svg.innerHTML || "";
  return { inner, vbX, vbY, vbW, vbH };
}

function _lasspBuildCenteredMarkerSvg({ iconSVG, bgColor, iconColor }) {
  const info = _lasspParseSvg(iconSVG);

  const W = 64,
    H = 64;
  const cx = 32,
    cy = 32;
  const radius = 26;
  const iconBox = 34;

  let iconGroup = "";
  if (info) {
    const scale = Math.min(iconBox / info.vbW, iconBox / info.vbH);
    const tx = -(info.vbX + info.vbW / 2);
    const ty = -(info.vbY + info.vbH / 2);

    iconGroup = `
      <g transform="translate(${cx} ${cy}) scale(${scale}) translate(${tx} ${ty})"
         style="color:${_lasspEscapeAttr(iconColor)}">
        ${info.inner}
      </g>
    `;
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${_lasspEscapeAttr(
    bgColor,
  )}"/>
  ${iconGroup}
</svg>`.trim();
}

function _lasspSvgToDataUrl(svgString) {
  let svg = String(svgString || "").trim();
  if (!svg) return "";
  if (!/xmlns=/.test(svg)) {
    svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function _lasspMakeMarkerWrap(markerUrl, size = 44, labelText = "") {
  if (!markerUrl) return null;

  const img = document.createElement("img");
  img.src = markerUrl;
  img.alt = "";
  img.width = size;
  img.height = size;
  img.style.display = "block";
  img.style.userSelect = "none";
  img.draggable = false;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = "center";
  wrap.style.transform = "translate(0, 50%)";
  wrap.style.willChange = "transform";
  wrap.appendChild(img);

  if (labelText) {
    const label = document.createElement("div");
    label.className = "lassp-marker-label";
    label.textContent = labelText;
    wrap.appendChild(label);
  }

  return wrap;
}

function _lasspFindOverlayEl(title) {
  const norm = (s) => String(s).trim().toLowerCase();
  for (const el of document.querySelectorAll(".map-overlay")) {
    const t = el.querySelector("[data-overlay-title]")?.textContent || "";
    if (norm(t) === norm(title)) return el;
  }
  return null;
}

function _lasspOrbitBodyHtml(event, body) {
  const lat = event.latLng.lat();
  const lng = event.latLng.lng();
  const apsidesWidthKm = Number(body.apsidesWidthKilometers) || 0;
  const perihelionKm = Number(body.perihelionKilometers) || 0;
  const aphelionKm = Number(body.aphelionKilometers) || 0;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function row(label, imp, met) {
    return `<tr><td>${esc(label)}</td><td class="lassp-iw__val"><div>${esc(imp)}</div><div class="lassp-iw__muted">${esc(met)}</div></td></tr>`;
  }

  const rows = [
    row("Click location:", `${Number(lat).toFixed(6)} lat`, `${Number(lng).toFixed(6)} lon`),
    row(
      "Apsides width actual:",
      `${Math.round(apsidesWidthKm * UNITS.kmToMiles).toLocaleString()} mi`,
      `${Math.round(apsidesWidthKm).toLocaleString()} km`,
    ),
    row(
      "Apsides width scaled:",
      `${Math.round(apsidesWidthKm * scaleFactor * UNITS.kmToFeet).toLocaleString()} ft`,
      `${Math.round(apsidesWidthKm * scaleFactor * UNITS.kmToMeters).toLocaleString()} m`,
    ),
    row(
      "Perihelion:",
      `${Math.round(perihelionKm * UNITS.kmToMiles).toLocaleString()} mi`,
      `${Math.round(perihelionKm).toLocaleString()} km`,
    ),
    row(
      "Aphelion:",
      `${Math.round(aphelionKm * UNITS.kmToMiles).toLocaleString()} mi`,
      `${Math.round(aphelionKm).toLocaleString()} km`,
    ),
  ].join("");

  const paras = (Array.isArray(body.bodyParagraphs) ? body.bodyParagraphs : [])
    .map((t) => `<p>${esc(String(t || ""))}</p>`)
    .join("");

  return `<table class="lassp-iw__table">${rows}</table>${paras ? `<div class="lassp-iw__desc">${paras}</div>` : ""}`;
}

// =======================
// Custom modal binder
// =======================
function createMapModalBinder(classSelector) {
  let mapDiv = null;
  let modalBackdrop = null;

  function closeModal() {
    if (modalBackdrop) {
      modalBackdrop.remove();
      modalBackdrop = null;
    }
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") closeModal();
  }

  function openModal({ titleText, bodyHTML, iconSVG, color, textColor, thumbnailBase }) {
    if (!mapDiv) return;
    closeModal();

    const safeTitle = titleText || "Details";
    const cssColor = (color && String(color).trim()) || "#0087CD";
    const cssText = (textColor && String(textColor).trim()) || "#ffffff";
    const iconHTML = iconSVG
      ? `<span class="map-modal-titleIcon" aria-hidden="true">${iconSVG}</span>`
      : "";

    const slugify =
      window.LASSP && typeof window.LASSP.slugifyTitle === "function"
        ? window.LASSP.slugifyTitle
        : null;

    const slug = slugify ? slugify(titleText || "") : "";

    const sitePath =
      window.LASSP && typeof window.LASSP.sitePath === "function"
        ? window.LASSP.sitePath
        : (p) => `/${p}`;

    const modelHref = slug ? sitePath("model/") + slug : "";

    let thumbsHTML = "";
    if (thumbnailBase && modelHref) {
      const illThumb = sitePath("img/illustrations/thumbs/") + thumbnailBase + "-tn.jpg";
      const fabThumb = sitePath("img/fabdrawings/thumbs/") + thumbnailBase + "-fab-tn.jpg";
      thumbsHTML = `
        <div class="map-modal-thumbs">
          <a href="${_lasspEscapeAttr(modelHref)}#illustration" title="View illustration">
            <img src="${_lasspEscapeAttr(illThumb)}" alt="${_lasspEscapeAttr(safeTitle)} illustration" loading="lazy" />
          </a>
          <a href="${_lasspEscapeAttr(modelHref)}#fabdrawing" title="View fabrication drawing">
            <img src="${_lasspEscapeAttr(fabThumb)}" alt="${_lasspEscapeAttr(safeTitle)} fabrication drawing" loading="lazy" />
          </a>
        </div>
      `;
    }

    modalBackdrop = document.createElement("div");
    modalBackdrop.className = "map-modal-backdrop";
    modalBackdrop.innerHTML = `
      <div class="map-modal-panel"
           role="dialog"
           aria-modal="true"
           aria-label="${safeTitle}"
           style="--overlay-color:${_lasspEscapeAttr(
             cssColor,
           )}; --overlay-text:${_lasspEscapeAttr(cssText)}">
        <div class="map-modal-header">
          <div class="map-modal-titleRow">
            ${iconHTML}
            <h2 class="map-modal-title">${safeTitle}</h2>
          </div>
          <button class="map-modal-close" type="button" aria-label="Close">×</button>
        </div>

        <div class="map-modal-body">
          ${bodyHTML}
          ${thumbsHTML}
          ${
            modelHref
              ? `
            <div class="map-modal-footer">
              <a class="map-modal-model-link" href="${_lasspEscapeAttr(
                modelHref,
              )}">
                <span>View model page</span>
                <svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="M7.5 4.5a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.8 10 7.5 5.9a1 1 0 0 1 0-1.4z"/>
                </svg>
              </a>
            </div>
          `
              : ""
          }
        </div>
      </div>
    `;

    modalBackdrop.addEventListener("click", () => closeModal());
    modalBackdrop
      .querySelector(".map-modal-panel")
      .addEventListener("click", (e) => e.stopPropagation());
    modalBackdrop
      .querySelector(".map-modal-close")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        closeModal();
      });

    const cs = getComputedStyle(mapDiv);
    if (cs.position === "static") mapDiv.style.position = "relative";

    mapDiv.appendChild(modalBackdrop);
    document.addEventListener("keydown", onKeyDown, true);

    const link = modalBackdrop.querySelector(".map-modal-model-link");
    if (link) requestAnimationFrame(() => link.classList.add("is-visible"));
  }

  function bindModals(map) {
    mapDiv = map.getDiv();
    const templateEls = Array.from(document.querySelectorAll(classSelector));

    templateEls.forEach((el) => {
      const lat = parseFloat(el.dataset.lat);
      const lng = parseFloat(el.dataset.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const titleText = (
        el.querySelector("[data-overlay-title]")?.textContent || ""
      ).trim();
      const bodyHTML = el.querySelector("[data-overlay-body]")?.innerHTML || "";

      const color = (el.dataset.color || "").trim() || "#0087CD";
      const textColor = (el.dataset.textColor || "").trim() || "#ffffff";

      const iconSVG = (
        el.querySelector(".map-overlay-icon")?.innerHTML || ""
      ).trim();

      const illustrationPath = (el.dataset.illustrationPath || "").trim();
      const thumbnailBase = illustrationPath
        ? illustrationPath.replace(/^.*\//, "").replace(/\.[^.]+$/, "")
        : "";

      const markerSvg = _lasspBuildCenteredMarkerSvg({
        iconSVG,
        bgColor: color,
        iconColor: textColor,
      });
      const markerUrl = _lasspSvgToDataUrl(markerSvg);
      if (!markerUrl) return;

      const markerWrap = _lasspMakeMarkerWrap(markerUrl, 44, titleText);
      if (!markerWrap) return;

      const position = { lat, lng };

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position,
        map,
        title: titleText || "",
        content: markerWrap,
        gmpClickable: true,
      });

      marker.addListener("gmp-click", () => {
        cancelZoom();
        openModal({
          titleText: titleText || "Details",
          bodyHTML,
          iconSVG,
          color,
          textColor,
          thumbnailBase,
        });
      });

      const hideAtZoom = Number(el.dataset.hideAtZoom);
      if (Number.isFinite(hideAtZoom)) {
        const updateVisibility = () => {
          marker.map = map.getZoom() <= hideAtZoom ? null : map;
        };
        updateVisibility();
        map.addListener("zoom_changed", updateVisibility);
      }
    });

    map.addListener("click", () => closeModal());
  }

  bindModals.openModal = openModal;
  return bindModals;
}

// =======================
// Expand map control
// =======================
function installExpandMapControl() {
  const mapCanvas = document.getElementById("map-canvas");
  const btn = document.getElementById("map-toggle");
  if (!mapCanvas || !btn) return;

  function updateLabel() {
    const expanded = mapCanvas.classList.contains("is-expanded");
    btn.textContent = expanded ? "Shrink Map" : "Expand Map";
    btn.setAttribute("aria-pressed", expanded ? "true" : "false");
  }

  function resizeMap() {
    if (!window.google || !map) return;
    const center = map.getCenter();
    requestAnimationFrame(() => {
      google.maps.event.trigger(map, "resize");
      if (center) map.setCenter(center);
    });
  }

  function getCollapsedHeightPx() {
    const wasExpanded = mapCanvas.classList.contains("is-expanded");
    if (wasExpanded) mapCanvas.classList.remove("is-expanded");
    const h = mapCanvas.getBoundingClientRect().height;
    if (wasExpanded) mapCanvas.classList.add("is-expanded");
    return h;
  }

  function updateVisibility() {
    const collapsedHeightPx = getCollapsedHeightPx();
    const expandedHeightPx = window.innerHeight - 50;

    const shouldHide = expandedHeightPx <= collapsedHeightPx + 1;

    if (shouldHide) {
      if (mapCanvas.classList.contains("is-expanded")) {
        mapCanvas.classList.remove("is-expanded");
        updateLabel();
        resizeMap();
      }
      btn.classList.add("is-hidden");
      return;
    }

    btn.classList.remove("is-hidden");
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const expanded = mapCanvas.classList.toggle("is-expanded");
    document.body.classList.toggle("map-expanded", expanded);

    if (expanded) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }

    // Allow wheel-to-zoom with no modifier when expanded
    if (window.google && map) {
      map.setOptions({
        gestureHandling: expanded ? "greedy" : "cooperative",
      });
    }

    updateLabel();
    resizeMap();

    requestAnimationFrame(updateVisibility);
  });

  window.addEventListener(
    "resize",
    () => {
      if (mapCanvas.classList.contains("is-expanded")) {
        mapCanvas.classList.remove("is-expanded");
        document.body.classList.remove("map-expanded");
        if (window.google && map) {
          map.setOptions({ gestureHandling: "cooperative" });
        }
        updateLabel();
        resizeMap();
      }
      updateVisibility();
    },
    { passive: true },
  );

  updateLabel();
  updateVisibility();
}

// =======================
// Google Maps callback MUST be global
// =======================
window.initMap = async function initMap() {
  try {
    await loadMapOverlaysFromJson("/data/map-model-markers.json", {
      imgBaseUrl: "/img/",
    });
  } catch (err) {
    console.error(err);
  }

  try {
    bodies = await loadBodiesFromJson("/data/map-bodies.json");
  } catch (err) {
    console.error(err);
    bodies = [];
  }

  function sunInfoWindowNode(event, sun) {
    const root = document.createElement("div");
    root.className = "lassp-iw";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", sun.title || "Details");

    const head = document.createElement("div");
    head.className = "lassp-iw__head";

    const title = document.createElement("div");
    title.className = "lassp-iw__title";
    title.textContent = sun.title || "Details";

    const close = document.createElement("button");
    close.className = "lassp-iw__close";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";

    head.appendChild(title);
    head.appendChild(close);

    const body = document.createElement("div");
    body.className = "lassp-iw__body";

    // table
    const table = document.createElement("table");
    table.className = "lassp-iw__table";

    const lat = event.latLng.lat();
    const lng = event.latLng.lng();

    const diameterMilesActual = Math.round(
      sun.diameterKm * UNITS.kmToMiles,
    ).toLocaleString();
    const diameterKilometersActual = Math.round(
      sun.diameterKm,
    ).toLocaleString();

    const diameterFeetScaled = Math.round(
      sun.diameterKm * scaleFactor * UNITS.kmToFeet,
    ).toLocaleString();
    const diameterMetersScaled = Math.round(
      sun.diameterKm * scaleFactor * UNITS.kmToMeters,
    ).toLocaleString();

    function addRow(label, imperial, metric) {
      const tr = document.createElement("tr");

      const tdLabel = document.createElement("td");
      tdLabel.textContent = label;

      const tdVal = document.createElement("td");
      tdVal.className = "lassp-iw__val";

      const top = document.createElement("div");
      top.textContent = imperial;

      const muted = document.createElement("div");
      muted.className = "lassp-iw__muted";
      muted.textContent = metric;

      tdVal.appendChild(top);
      tdVal.appendChild(muted);

      tr.appendChild(tdLabel);
      tr.appendChild(tdVal);
      table.appendChild(tr);
    }

    addRow(
      "Click location:",
      `${Number(lat).toFixed(6)} lat`,
      `${Number(lng).toFixed(6)} lon`,
    );
    addRow(
      "Diameter actual:",
      `${diameterMilesActual} mi`,
      `${diameterKilometersActual} km`,
    );
    addRow(
      "Diameter scaled:",
      `${diameterFeetScaled} ft`,
      `${diameterMetersScaled} m`,
    );

    const desc = document.createElement("div");
    desc.className = "lassp-iw__desc";
    _lasspAppendParagraphs(desc, Array.isArray(sun.bodyParagraphs) ? sun.bodyParagraphs : []);

    body.appendChild(table);
    body.appendChild(desc);

    root.appendChild(head);
    root.appendChild(body);

    return { root, closeBtn: close };
  }

  function orbitInfoWindowNode(event, body) {
    const root = document.createElement("div");
    root.className = "lassp-iw";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", `${body.name || "Details"} Orbit`);

    const head = document.createElement("div");
    head.className = "lassp-iw__head";

    const title = document.createElement("div");
    title.className = "lassp-iw__title";
    title.textContent = `${body.name || "Details"} Orbit`;

    const close = document.createElement("button");
    close.className = "lassp-iw__close";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";

    head.appendChild(title);
    head.appendChild(close);

    const bodyEl = document.createElement("div");
    bodyEl.className = "lassp-iw__body";

    const table = document.createElement("table");
    table.className = "lassp-iw__table";

    const lat = event.latLng.lat();
    const lng = event.latLng.lng();

    const apsidesWidthKm = Number(body.apsidesWidthKilometers) || 0;
    const perihelionKm = Number(body.perihelionKilometers) || 0;
    const aphelionKm = Number(body.aphelionKilometers) || 0;

    function addRow(label, imperial, metric) {
      const tr = document.createElement("tr");

      const tdLabel = document.createElement("td");
      tdLabel.textContent = label;

      const tdVal = document.createElement("td");
      tdVal.className = "lassp-iw__val";

      const top = document.createElement("div");
      top.textContent = imperial;

      const muted = document.createElement("div");
      muted.className = "lassp-iw__muted";
      muted.textContent = metric;

      tdVal.appendChild(top);
      tdVal.appendChild(muted);

      tr.appendChild(tdLabel);
      tr.appendChild(tdVal);
      table.appendChild(tr);
    }

    addRow(
      "Click location:",
      `${Number(lat).toFixed(6)} lat`,
      `${Number(lng).toFixed(6)} lon`,
    );

    addRow(
      "Apsides width actual:",
      `${Math.round(apsidesWidthKm * UNITS.kmToMiles).toLocaleString()} mi`,
      `${Math.round(apsidesWidthKm).toLocaleString()} km`,
    );

    addRow(
      "Apsides width scaled:",
      `${Math.round(apsidesWidthKm * scaleFactor * UNITS.kmToFeet).toLocaleString()} ft`,
      `${Math.round(apsidesWidthKm * scaleFactor * UNITS.kmToMeters).toLocaleString()} m`,
    );

    addRow(
      "Perihelion:",
      `${Math.round(perihelionKm * UNITS.kmToMiles).toLocaleString()} mi`,
      `${Math.round(perihelionKm).toLocaleString()} km`,
    );

    addRow(
      "Aphelion:",
      `${Math.round(aphelionKm * UNITS.kmToMiles).toLocaleString()} mi`,
      `${Math.round(aphelionKm).toLocaleString()} km`,
    );

    const desc = document.createElement("div");
    desc.className = "lassp-iw__desc";
    _lasspAppendParagraphs(desc, Array.isArray(body.bodyParagraphs) ? body.bodyParagraphs : []);

    bodyEl.appendChild(table);
    bodyEl.appendChild(desc);

    root.appendChild(head);
    root.appendChild(bodyEl);

    return { root, closeBtn: close };
  }

  const center = new google.maps.LatLng(SUN.lat, SUN.lng);

  map = new google.maps.Map(document.getElementById("map-canvas"), {
    center,
    mapTypeId: google.maps.MapTypeId.HYBRID,
    tilt: 0,
    mapId: "lassp_map_id",
    streetViewControl: false,
  });

  await google.maps.importLibrary("marker");

  const infoWindow = new google.maps.InfoWindow();
  infoWindow.addListener("closeclick", function () {
    scheduleNextZoom();
  });

  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];

    body.paths = [
      drawCircle(center, body.aphelionKilometers * scaleFactor, -1),
      drawCircle(center, body.perihelionKilometers * scaleFactor, 1),
    ];
    body.apsidesWidthKilometers = Math.round(
      body.aphelionKilometers - body.perihelionKilometers,
    );

    const bodyApsides = new google.maps.Polygon(body);
    bodyApsides.setMap(map);
    bodyApsides.set("name", body.name);

    bodyApsides.addListener("click", function (event) {
      cancelZoom();

      const lookupTitle = body.markerTitle || body.name;
      const overlayEl = _lasspFindOverlayEl(lookupTitle);
      if (overlayEl) {
        infoWindow.close();
        const overlayIllPath = (overlayEl.dataset.illustrationPath || "").trim();
        const overlayThumbBase = overlayIllPath
          ? overlayIllPath.replace(/^.*\//, "").replace(/\.[^.]+$/, "")
          : "";
        bindModals.openModal({
          titleText: overlayEl.querySelector("[data-overlay-title]")?.textContent?.trim() || body.name,
          bodyHTML: overlayEl.querySelector("[data-overlay-body]")?.innerHTML || "",
          iconSVG: overlayEl.querySelector(".map-overlay-icon")?.innerHTML?.trim() || "",
          color: overlayEl.dataset.color || body.fillColor,
          textColor: overlayEl.dataset.textColor || "#ffffff",
          thumbnailBase: overlayThumbBase,
        });
      } else {
        const { root, closeBtn } = orbitInfoWindowNode(event, body);
        infoWindow.setContent(root);
        infoWindow.setPosition(event.latLng);
        infoWindow.open(map);
        closeBtn.addEventListener("click", () => infoWindow.close(), { once: true });
      }
    });
  }

  // Sun overlay + click behavior (uses centralized SUN)
  const sunIcon = new google.maps.GroundOverlay(
    SUN.overlay.imgSrc,
    sunOverlayBoundsLatLng(),
  );
  sunIcon.setMap(map);

  sunIcon.addListener("click", function (event) {
    cancelZoom();

    const { root, closeBtn } = sunInfoWindowNode(event, SUN);
    infoWindow.setContent(root);
    infoWindow.setPosition(event.latLng);
    infoWindow.open(map);
    closeBtn.addEventListener("click", () => infoWindow.close(), {
      once: true,
    });
  });

  map.addListener("click", cancelZoom);
  map.addListener("dragstart", cancelZoom);
  map.addListener("zoom_changed", () => { if (!_zoomingOut) cancelZoom(); });

  map.setZoom(zoomLevels[0]);
  scheduleNextZoom();

  const bindModals = createMapModalBinder(".map-overlay");
  bindModals(map);
  installExpandMapControl();
};

// ---- LASSP: Map helpers (used by subpages) ----
window.LASSP = window.LASSP || {};

// Wait until Google Maps has loaded (subpages don't use callback=initMap)
LASSP.waitForGoogleMaps =
  LASSP.waitForGoogleMaps ||
  function waitForGoogleMaps({ timeoutMs = 15000 } = {}) {
    const start = Date.now();

    return new Promise((resolve, reject) => {
      (function tick() {
        if (
          window.google &&
          google.maps &&
          typeof google.maps.importLibrary === "function"
        ) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error("Timed out waiting for Google Maps JS API to load."),
          );
          return;
        }
        setTimeout(tick, 50);
      })();
    });
  };

// Shared cached SVG fetcher for icons
LASSP.fetchSvgTextCached =
  LASSP.fetchSvgTextCached ||
  (function () {
    const cache = new Map(); // url -> Promise<string>

    return function fetchSvgTextCached(url) {
      const u = String(url || "").trim();
      if (!u) return Promise.resolve("");

      if (cache.has(u)) return cache.get(u);

      const p = fetch(u, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) {
            console.warn(`Icon SVG not found: ${u} (${r.status})`);
            return "";
          }
          return r.text();
        })
        .catch((err) => {
          console.warn(`Failed to fetch SVG: ${u}`, err);
          return "";
        });

      cache.set(u, p);
      return p;
    };
  })();

LASSP.initMarkerMiniMap =
  LASSP.initMarkerMiniMap ||
  async function initMarkerMiniMap(marker, opts = {}) {
    const elId = typeof opts.elId === "string" ? opts.elId : "marker-map";
    const el = document.getElementById(elId);
    if (!el) return;

    if (
      !marker ||
      !Number.isFinite(marker.lat) ||
      !Number.isFinite(marker.lng)
    ) {
      return;
    }

    await LASSP.waitForGoogleMaps({ timeoutMs: 20000 });

    const center = { lat: Number(marker.lat), lng: Number(marker.lng) };

    const miniMap = new google.maps.Map(el, {
      center,
      zoom: 10,
      mapTypeId: google.maps.MapTypeId.SATELLITE,
      tilt: 0,
      mapId: "lassp_map_id",
    });

    const infoWindow = new google.maps.InfoWindow();

    function markerInfoWindowHtml({ title, lat, lng }) {
      const safeTitle = title || "Details";
      const safeLat = Number(lat).toFixed(6);
      const safeLng = Number(lng).toFixed(6);

      return `
        <div class="lassp-iw" role="dialog" aria-label="${safeTitle}">
          <div class="lassp-iw__head">
            <div class="lassp-iw__title">${safeTitle}</div>
            <button class="lassp-iw__close" type="button" aria-label="Close">×</button>
          </div>
          <div class="lassp-iw__body">
            <div>${safeLat} lat</div>
            <div>${safeLng} lng</div>
          </div>
        </div>
      `.trim();
    }

    function openInfo(anchor, payload) {
      const p = payload || {
        title: marker.title,
        lat: marker.lat,
        lng: marker.lng,
      };

      infoWindow.setContent(
        markerInfoWindowHtml({
          title: p.title,
          lat: p.lat,
          lng: p.lng,
        }),
      );

      if (anchor) {
        infoWindow.open({ map: miniMap, anchor });
      } else {
        infoWindow.setPosition(center);
        infoWindow.open({ map: miniMap });
      }

      google.maps.event.addListenerOnce(infoWindow, "domready", () => {
        const btn = miniMap.getDiv().querySelector(".lassp-iw__close");
        if (btn) {
          btn.addEventListener("click", () => infoWindow.close(), {
            once: true,
          });
        }
      });
    }

    await google.maps.importLibrary("marker");

    const sitePath =
      typeof LASSP.sitePath === "function"
        ? LASSP.sitePath.bind(LASSP)
        : (rel) => "/" + String(rel || "").replace(/^\//, "");

    // Helper to add an AdvancedMarkerElement with our centered SVG pin
    function addAdvancedSvgMarker({
      position,
      title,
      iconSVG,
      bgColor,
      iconColor,
      clickable = true,
    }) {
      const markerSvg = _lasspBuildCenteredMarkerSvg({
        iconSVG,
        bgColor,
        iconColor,
      });
      const markerUrl = _lasspSvgToDataUrl(markerSvg);
      if (!markerUrl) return null;

      const wrap = _lasspMakeMarkerWrap(markerUrl, 44, title);
      if (!wrap) return null;

      const adv = new google.maps.marker.AdvancedMarkerElement({
        position,
        map: miniMap,
        title: title || "",
        content: wrap,
        gmpClickable: !!clickable,
      });

      return adv;
    }

    // ---- Topic marker (subpages) ----
    const rawIconPath = String(marker.iconPath || "").trim();
    const iconUrl = rawIconPath
      ? /^https?:\/\//i.test(rawIconPath) || rawIconPath.startsWith("/")
        ? rawIconPath
        : sitePath("img/") + rawIconPath.replace(/^\//, "")
      : "";

    const iconSvg = iconUrl ? await LASSP.fetchSvgTextCached(iconUrl) : "";
    const bgColor = marker.color || "#0087CD";
    const iconColor = marker.textColor || "#ffffff";

    // Fallback: default Marker + click opens the styled InfoWindow
    if (!iconSvg) {
      const pin = new google.maps.Marker({
        position: center,
        map: miniMap,
        clickable: true,
        title: marker.title || "",
      });
      pin.addListener("click", () => openInfo(pin));
      // Still add Sun marker even if topic falls back
    } else {
      const topicAdv = addAdvancedSvgMarker({
        position: center,
        title: marker.title || "",
        iconSVG: iconSvg,
        bgColor,
        iconColor,
        clickable: true,
      });

      if (topicAdv) {
        topicAdv.addListener("gmp-click", () => openInfo(topicAdv));
      } else {
        // Secondary fallback if our SVG pin fails
        const pin = new google.maps.Marker({
          position: center,
          map: miniMap,
          clickable: true,
          title: marker.title || "",
        });
        pin.addListener("click", () => openInfo(pin));
      }
    }

    // ---- Add The Sun marker ----
    const sunPos = sunCenter();
    const sunAdv = addAdvancedSvgMarker({
      position: sunPos,
      title: SUN.title,
      iconSVG: SUN.markerStyle.glyphSvg,
      bgColor: SUN.markerStyle.bgColor,
      iconColor: SUN.markerStyle.iconColor,
      clickable: true,
    });

    if (sunAdv) {
      sunAdv.addListener("gmp-click", () =>
        openInfo(sunAdv, { title: SUN.title, lat: SUN.lat, lng: SUN.lng }),
      );
    } else {
      // If AdvancedMarkerElement fails for some reason, fall back to default pin
      const sunPin = new google.maps.Marker({
        position: sunPos,
        map: miniMap,
        clickable: true,
        title: SUN.title,
      });
      sunPin.addListener("click", () =>
        openInfo(sunPin, { title: SUN.title, lat: SUN.lat, lng: SUN.lng }),
      );
    }

    // Distance label at the midpoint of the dimension line
    (function addDimensionLabel() {
      const R = 6371; // km
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(marker.lat - SUN.lat);
      const dLng = toRad(marker.lng - SUN.lng);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(SUN.lat)) *
          Math.cos(toRad(marker.lat)) *
          Math.sin(dLng / 2) ** 2;
      const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distMi = distKm * 0.621371;

      const fmt = (n) =>
        n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString();

      const labelEl = document.createElement("div");
      labelEl.textContent = `${fmt(distMi)} mi (${fmt(distKm)} km)`;
      Object.assign(labelEl.style, {
        background: "rgba(15,23,42,0.82)",
        color: "#e8eaf0",
        fontSize: "11px",
        fontWeight: "600",
        padding: "3px 7px",
        borderRadius: "4px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        userSelect: "none",
      });

      new google.maps.marker.AdvancedMarkerElement({
        position: {
          lat: (SUN.lat + marker.lat) / 2,
          lng: (SUN.lng + marker.lng) / 2,
        },
        map: miniMap,
        content: labelEl,
      });
    })();

    // Dimension line between The Sun and the topic marker
    new google.maps.Polyline({
      path: [
        { lat: SUN.lat, lng: SUN.lng },
        { lat: marker.lat, lng: marker.lng },
      ],
      map: miniMap,
      geodesic: true,
      strokeColor: "#ffffff",
      strokeOpacity: 0,
      icons: [
        {
          icon: {
            path: "M 0,-1 0,1",
            strokeOpacity: 0.7,
            strokeColor: "#ffffff",
            scale: 2,
          },
          offset: "0",
          repeat: "12px",
        },
      ],
    });

    // Fit the mini-map so both the topic marker and The Sun are visible
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(new google.maps.LatLng(marker.lat, marker.lng));
    bounds.extend(new google.maps.LatLng(SUN.lat, SUN.lng));
    miniMap.fitBounds(bounds, 32);
  };
