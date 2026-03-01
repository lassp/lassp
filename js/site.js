// js/site.js

window.LASSP = window.LASSP || {};

// If you already have this, keep one copy.
LASSP.slugifyTitle =
  LASSP.slugifyTitle ||
  function slugifyTitle(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  };

// ---- Auto-detect site base path (no options needed) ----
// Works on root and subpages, and also if deployed under a subdirectory.
// It infers base from the URL that loaded /js/site.js.
LASSP.getSiteBasePath =
  LASSP.getSiteBasePath ||
  function getSiteBasePath() {
    const scripts = Array.from(document.scripts || []);
    const siteScript =
      scripts.find((s) => /\/js\/site\.js(\?|#|$)/.test(s.src)) ||
      scripts.find((s) =>
        /(^|\/)js\/site\.js(\?|#|$)/.test(s.getAttribute("src") || ""),
      );

    if (siteScript) {
      const u = new URL(siteScript.src, window.location.href);
      // Strip trailing "/js/site.js" => base path
      return u.pathname.replace(/\/js\/site\.js(\?.*)?$/, "/");
    }

    // Fallback (typical local dev at root)
    return "/";
  };

// Helper: build an absolute site path under the computed base.
LASSP.sitePath =
  LASSP.sitePath ||
  function sitePath(rel) {
    const base = LASSP.getSiteBasePath(); // e.g. "/" or "/lassp/"
    const clean = String(rel || "").replace(/^\//, "");
    return new URL(clean, window.location.origin + base).pathname;
  };

// ---- Shared JSON loader (cached) ----
LASSP.loadMarkersJson = (function () {
  let cache = null;
  let inFlight = null;

  return async function loadMarkersJson(jsonUrl) {
    const url =
      typeof jsonUrl === "string" && jsonUrl.trim()
        ? jsonUrl.trim()
        : LASSP.sitePath("data/map-model-markers.json");

    if (cache) return cache;
    if (inFlight) return inFlight;

    inFlight = fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
        return r.json();
      })
      .then((arr) => {
        cache = Array.isArray(arr) ? arr : [];
        return cache;
      })
      .catch((err) => {
        console.error(err);
        cache = [];
        return cache;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
})();

// ---- Nav builder (from JSON) ----
// No opts required. Builds absolute links under the detected site base.
LASSP.buildModelMenuFromJson = async function buildModelMenuFromJson() {
  const menu = document.getElementById("model-submenu");
  const details = document.querySelector("details.nav-model");
  if (!menu || !details) return;

  const jsonUrl = LASSP.sitePath("data/map-model-markers.json");
  const modelBase = LASSP.sitePath("model/"); // "/model/" or "/lassp/model/"

  const markers = await LASSP.loadMarkersJson(jsonUrl);

  const items = markers
    .map((m) => {
      const title = (m?.title || "").trim();
      if (!title) return null;
      return { title, slug: LASSP.slugifyTitle(title) };
    })
    .filter(Boolean);

  menu.innerHTML = "";

  if (!items.length) {
    details.style.display = "none";
    return;
  }
  details.style.display = "";

  for (const item of items) {
    const a = document.createElement("a");
    a.textContent = item.title;
    a.href = modelBase + item.slug; // absolute under base
    menu.appendChild(a);
  }

  // Close on outside click (install once)
  if (!details.__outsideClickInstalled) {
    details.__outsideClickInstalled = true;
    document.addEventListener(
      "click",
      (e) => {
        if (!details.contains(e.target)) details.removeAttribute("open");
      },
      { capture: true },
    );
  }
};

// ---- Subpage helper: infer the marker slug from URL ----
LASSP.getMarkerSlugFromLocation = function getMarkerSlugFromLocation(
  pathname = window.location.pathname,
) {
  // Works for:
  //  /model/neptune
  //  /model/neptune/
  //  /model/neptune/index.html
  // and also under a base path:
  //  /lassp/model/neptune
  const parts = String(pathname).split("/").filter(Boolean);

  // Find "model" segment and take the next segment as slug
  const i = parts.indexOf("model");
  if (i >= 0 && parts[i + 1]) return parts[i + 1];

  // Fallback: last segment, ignoring "index.html"
  const last = parts[parts.length - 1];
  if (last && last !== "index.html") return last;

  const prev = parts[parts.length - 2];
  return prev || "";
};

LASSP.getPrevNextMarkers =
  LASSP.getPrevNextMarkers ||
  function getPrevNextMarkers(markers, currentSlug) {
    const slugOf = (m) => LASSP.slugifyTitle(m?.title || "");
    const idx = markers.findIndex((m) => slugOf(m) === currentSlug);
    if (idx < 0) return { prev: null, next: null };

    const prev = idx > 0 ? markers[idx - 1] : null;
    const next = idx < markers.length - 1 ? markers[idx + 1] : null;
    return { prev, next };
  };

// ---- Subpage binder: binds marker -> DOM and builds nav ----
// No opts required. Uses detected base paths and inferred slug.
LASSP.initSubpage = async function initSubpage() {
  const jsonUrl = LASSP.sitePath("data/map-model-markers.json");

  // 1) Build nav menu (Model dropdown)
  await LASSP.buildModelMenuFromJson();

  // 2) Load markers and resolve the marker object for this page
  const markers = await LASSP.loadMarkersJson(jsonUrl);

  const markerSlug = LASSP.getMarkerSlugFromLocation();

  // Match by slugified title
  const marker =
    markers.find((m) => LASSP.slugifyTitle(m?.title) === markerSlug) || null;

  // Expose on window for debugging / reuse
  LASSP.pageMarker = marker;

  if (!marker) {
    console.warn(`No marker found for slug "${markerSlug}" in ${jsonUrl}`);
    return;
  }

// ---- Prev / Next pager (subpages) ----
const navHost = document.querySelector('[data-bind="prevNextNav"]');
const prevEl = document.querySelector('[data-bind="prevMarker"]');
const nextEl = document.querySelector('[data-bind="nextMarker"]');

if (navHost && (prevEl || nextEl)) {
  const slugOf = (m) => LASSP.slugifyTitle(m?.title || "");
  const idx = markers.findIndex((m) => slugOf(m) === markerSlug);

  const prev = idx > 0 ? markers[idx - 1] : null;
  const next = idx >= 0 && idx < markers.length - 1 ? markers[idx + 1] : null;

  const modelBase = LASSP.sitePath("model/");

  function bind(el, m, label) {
    if (!el || !m) return false;
    const title = (m.title || "").trim();
    const slug = slugOf(m);
    if (!title || !slug) return false;

    el.hidden = false;
    el.textContent = `${label}: ${title}`;
    el.href = modelBase + slug;
    el.title = title; // hover reveals which object
    el.setAttribute("aria-label", `${label}: ${title}`);
    return true;
  }

  const hasPrev = bind(prevEl, prev, "In To");
  const hasNext = bind(nextEl, next, "Out To");

  // Show container only if at least one exists
  navHost.hidden = !(hasPrev || hasNext);

  // Optional: keep corners even if only one button exists (no :has needed)
  if (hasPrev && !hasNext) {
    // ensure prev stays left; add spacer to push it
    navHost.querySelector(".pager-spacer")?.remove();
    const spacer = document.createElement("div");
    spacer.className = "pager-spacer";
    spacer.style.flex = "1 1 auto";
    navHost.appendChild(spacer);
  } else if (!hasPrev && hasNext) {
    navHost.querySelector(".pager-spacer")?.remove();
    const spacer = document.createElement("div");
    spacer.className = "pager-spacer";
    spacer.style.flex = "1 1 auto";
    navHost.insertBefore(spacer, nextEl);
  } else {
    navHost.querySelector(".pager-spacer")?.remove();
  }
}

  // Render subpage mini-map (satellite, max zoom, static)
  try {
    if (typeof LASSP.initMarkerMiniMap === "function") {
      await LASSP.initMarkerMiniMap(marker);
    }
  } catch (err) {
    console.error(err);
  }

  // 3) Bind marker -> page header
  const header = document.querySelector(".page-header");
  if (!header) return;

  /* ---- Title binding ---- */
  const pageTitle = marker.title || "";

  /* 1. Bind visible H1 */
  const titleEl =
    header.querySelector('[data-bind="modelSubpageTitle"]') ||
    header.querySelector("h1");

  if (titleEl) {
    titleEl.textContent = pageTitle;
  }

  /* 2. Bind <title> in document head */
  if (pageTitle) {
    const siteName = "LASSP"; // change if you ever rebrand
    document.title = `${siteName} — ${pageTitle}`;
  }

  /* ---- bodyParagraphs binding (split into <p>) ---- */
  const bodyHost = header.querySelector('[data-bind="bodyParagraphs"]');
  if (bodyHost) {
    bodyHost.innerHTML = "";

    const paras = Array.isArray(marker.bodyParagraphs)
      ? marker.bodyParagraphs
      : [];

    for (const t of paras) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = String(t || "");
      bodyHost.appendChild(p);
    }
  }

  // Illustration binding
  const illustrationRel = (marker.illustrationPath || "").trim();
  if (
    illustrationRel &&
    window.LASSP &&
    typeof window.LASSP.sitePath === "function"
  ) {
    const illustrationUrl =
      window.LASSP.sitePath("img/") + illustrationRel.replace(/^\//, "");

    const illEl = document.querySelector("[data-illustration]");
    if (illEl) {
      illEl.style.backgroundImage = `url("${illustrationUrl}")`;
      illEl.setAttribute("aria-label", `${pageTitle} illustration`);
    }
  } else {
    document.body.classList.remove("has-illustration-bg");
    document.documentElement.style.removeProperty("--illustration-url");
  }
};

// ---- Auto-init (root vs subpage) ----
// If #model-submenu exists, build the dropdown.
// If URL indicates /model/* AND .page-header exists, bind marker context too.
document.addEventListener("DOMContentLoaded", async () => {
  // Year (safe everywhere)
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  const hasMenu = !!document.getElementById("model-submenu");
  const isModelPage = window.location.pathname.includes("/model/");
  const hasHeader = !!document.querySelector(".page-header");

  try {
    if (isModelPage && hasHeader) {
      await LASSP.initSubpage(); // we'll extend this to also create the mini-map
      return;
    }

    if (hasMenu) {
      await LASSP.buildModelMenuFromJson();
    }
  } catch (err) {
    console.error("LASSP auto-init failed:", err);
  }
});
