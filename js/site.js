// js/site.js

window.LASSP = window.LASSP || {};

// ---- Hamburger menu links — edit this array to configure ----
// Each entry: { label: string, href: string }
LASSP.hamburgerLinks = [
  { label: "Home",                  href: "./"                          },
  { label: "The Scale of the Model", href: "/model/"                   },
  { label: "Fabrication Package",   href: "/downloads/lassp_fab.pdf",  target: "_blank" },
];

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

// ---- Model card icon rows ----
LASSP.buildModelCardIcons = async function buildModelCardIcons() {
  const dts = Array.from(document.querySelectorAll("[data-model-icons]"));
  if (!dts.length) return;

  const jsonUrl   = LASSP.sitePath("data/map-model-markers.json");
  const imgBase   = LASSP.sitePath("img/").replace(/\/?$/, "/");
  const modelBase = LASSP.sitePath("model/");

  const markers = await LASSP.loadMarkersJson(jsonUrl);
  if (!markers.length) return;

  const bySlug = new Map(markers.map((m) => [LASSP.slugifyTitle(m.title), m]));

  // Collect unique slugs then fetch their SVGs in parallel
  const neededSlugs = [
    ...new Set(
      dts.flatMap((dt) =>
        dt.dataset.modelIcons.split(",").map((s) => s.trim()).filter(Boolean)
      )
    ),
  ];

  const svgMap = new Map();
  await Promise.all(
    neededSlugs.map(async (slug) => {
      const m = bySlug.get(slug);
      if (!m) return;
      const url = imgBase + String(m.iconPath || "").trim().replace(/^\//, "");
      try {
        const r = await fetch(url, { cache: "no-store" });
        svgMap.set(slug, r.ok ? await r.text() : "");
      } catch { svgMap.set(slug, ""); }
    })
  );

  dts.forEach((dt) => {
    const slugs = dt.dataset.modelIcons.split(",").map((s) => s.trim()).filter(Boolean);
    const row = document.createElement("span");
    row.className = "model-icon-row";

    slugs.forEach((slug) => {
      const m = bySlug.get(slug);
      if (!m) return;

      const a = document.createElement("a");
      a.className = "model-icon-btn";
      a.href = modelBase + slug;
      a.setAttribute("data-tooltip", m.title);
      a.setAttribute("aria-label", m.title);
      a.style.setProperty("--btn-bg", m.color || "#0087cd");
      a.style.setProperty("--btn-fg", m.textColor || "#fff");

      const circle = document.createElement("span");
      circle.className = "model-icon-circle";
      circle.innerHTML = svgMap.get(slug) || "";
      a.appendChild(circle);
      row.appendChild(a);
    });

    if (dt.hasAttribute("data-model-icons-before")) {
      dt.prepend(row);
    } else {
      dt.appendChild(row);
    }
  });
};

// ---- Strip nav builder ----
LASSP.buildStripNav = async function buildStripNav(mountEl) {
  if (!mountEl) return;

  const jsonUrl  = LASSP.sitePath("data/map-model-markers.json");
  const imgBase  = LASSP.sitePath("img/").replace(/\/?$/, "/");
  const homeUrl  = LASSP.sitePath("");
  const modelBase = LASSP.sitePath("model/");

  const markers = await LASSP.loadMarkersJson(jsonUrl);
  if (!markers.length) return;

  // Fetch all icon SVGs in parallel
  async function fetchSvg(iconPath) {
    const clean = String(iconPath || "").trim();
    if (!clean) return "";
    const url = imgBase + clean.replace(/^\//, "");
    try {
      const r = await fetch(url, { cache: "no-store" });
      return r.ok ? await r.text() : "";
    } catch { return ""; }
  }
  const svgs = await Promise.all(markers.map((m) => fetchSvg(m.iconPath)));

  // Current-page detection
  const currentSlug = LASSP.getMarkerSlugFromLocation();
  const onHome = !currentSlug;

  function makeBtn(m, svg, href, isCurrent, isHome) {
    const a = document.createElement("a");
    a.className = "strip-btn" + (isHome ? " strip-btn--home" : "");
    a.href = href;
    if (isCurrent) a.setAttribute("aria-current", "page");
    a.style.setProperty("--btn-bg", m.color || "var(--nav-bg)");
    a.style.setProperty("--btn-fg", m.textColor || "#ffffff");

    const icon = document.createElement("span");
    icon.className = "strip-btn-icon";
    icon.innerHTML = svg;
    a.appendChild(icon);

    if (!isHome) {
      const label = document.createElement("span");
      label.className = "strip-btn-label";
      label.textContent = m.title;
      a.appendChild(label);
    }
    return a;
  }

  const [sunMarker, ...restMarkers] = markers;
  const [sunSvg,   ...restSvgs]    = svgs;

  // Pinned Sun
  const pin = document.createElement("div");
  pin.className = "strip-pin";
  pin.appendChild(makeBtn(sunMarker, sunSvg, homeUrl, onHome, true));

  // Scrollable track
  const track = document.createElement("div");
  track.className = "strip-track";
  restMarkers.forEach((m, i) => {
    const slug = LASSP.slugifyTitle(m.title);
    track.appendChild(makeBtn(m, restSvgs[i], modelBase + slug, slug === currentSlug, false));
  });

  const scroller = document.createElement("div");
  scroller.className = "strip-scroller";
  scroller.appendChild(track);

  // Arrows
  function makeArrow(dir) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "strip-arrow strip-arrow--" + (dir < 0 ? "prev" : "next");
    btn.setAttribute("aria-label", dir < 0 ? "Scroll left" : "Scroll right");
    btn.innerHTML = dir < 0 ? "&#8249;" : "&#8250;";
    btn.hidden = true;
    return btn;
  }
  const prevArrow = makeArrow(-1);
  const nextArrow = makeArrow(1);

  const scrollWrap = document.createElement("div");
  scrollWrap.className = "strip-scroll-wrap";
  scrollWrap.appendChild(prevArrow);
  scrollWrap.appendChild(scroller);
  scrollWrap.appendChild(nextArrow);

  mountEl.innerHTML = "";
  mountEl.appendChild(pin);
  mountEl.appendChild(scrollWrap);

  // Arrow visibility
  function updateArrows() {
    const sl  = scroller.scrollLeft;
    const max = scroller.scrollWidth - scroller.clientWidth;
    prevArrow.hidden = sl < 2;
    nextArrow.hidden = max < 2 || sl >= max - 2;
  }

  function scrollByOne(dir) {
    const w = track.firstElementChild ? track.firstElementChild.offsetWidth : 60;
    scroller.scrollBy({ left: dir * w, behavior: "smooth" });
  }

  prevArrow.addEventListener("click", () => scrollByOne(-1));
  nextArrow.addEventListener("click", () => scrollByOne(1));
  scroller.addEventListener("scroll", updateArrows, { passive: true });
  new ResizeObserver(updateArrows).observe(scroller);

  // Scroll current item into view on model pages
  if (currentSlug) {
    const current = track.querySelector('[aria-current="page"]');
    if (current) {
      requestAnimationFrame(() => {
        current.scrollIntoView({ inline: "nearest", block: "nearest" });
        requestAnimationFrame(updateArrows);
      });
    }
  }

  updateArrows();

  // ---- Hamburger menu ----
  const links = Array.isArray(LASSP.hamburgerLinks) ? LASSP.hamburgerLinks : [];
  if (links.length) {
    const hamburger = document.createElement("div");
    hamburger.className = "strip-hamburger";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "strip-hamburger-btn";
    btn.setAttribute("aria-label", "Navigation menu");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true" focusable="false">
      <rect width="18" height="2" rx="1" fill="currentColor"/>
      <rect y="6" width="18" height="2" rx="1" fill="currentColor"/>
      <rect y="12" width="18" height="2" rx="1" fill="currentColor"/>
    </svg>`;

    const menu = document.createElement("div");
    menu.className = "strip-hamburger-menu";
    menu.hidden = true;

    links.forEach(({ label, href, target }) => {
      const a = document.createElement("a");
      // Resolve root-relative and ./-relative hrefs through sitePath so they
      // work correctly from any page depth.
      a.href = /^https?:\/\//.test(href)
        ? href
        : LASSP.sitePath(href.replace(/^\.\//, ""));
      if (target) {
        a.target = target;
        if (target === "_blank") a.rel = "noopener";
      }
      a.textContent = label;
      menu.appendChild(a);
    });

    hamburger.appendChild(btn);
    hamburger.appendChild(menu);
    mountEl.appendChild(hamburger);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("click", (e) => {
      if (!hamburger.contains(e.target)) {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    }, { capture: true });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
        btn.focus();
      }
    });
  }
};

// ---- Footer enhancement ----
LASSP.initFooter = function initFooter() {
  const INSTAGRAM = "https://www.instagram.com/planetaryorbitworks/";
  const logos = document.querySelector(".footer-logos");
  if (!logos) return;

  const powPicture = logos.querySelector("#pow-logo");
  if (powPicture) {
    const tpl = document.createElement("template");
    tpl.innerHTML = `
      <a href="${INSTAGRAM}"
         target="_blank"
         rel="noopener"
         aria-label="Planetary Orbit Works on Instagram">
      </a>
    `;
    const a = tpl.content.firstElementChild;
    powPicture.replaceWith(a);
    a.appendChild(powPicture);
  }

  const tpl = document.createElement("template");
  tpl.innerHTML = `
    <a href="${INSTAGRAM}"
       target="_blank"
       rel="noopener"
       aria-label="Planetary Orbit Works on Instagram"
       class="footer-ig">
      <img src="${LASSP.sitePath("img/svg-icons/instagram.svg")}"
           alt=""
           aria-hidden="true"
           width="22"
           height="22" />
    </a>
  `;
  logos.appendChild(tpl.content.firstElementChild);

  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
};

// ---- Auto-init ----
document.addEventListener("DOMContentLoaded", async () => {

  const isModelPage = window.location.pathname.includes("/model/");
  const hasHeader   = !!document.querySelector(".page-header");

  try {
    const stripNavEl = document.getElementById("strip-nav");
    if (stripNavEl) {
      await LASSP.buildStripNav(stripNavEl);
    } else if (document.getElementById("model-submenu")) {
      await LASSP.buildModelMenuFromJson();
    }

    await LASSP.buildModelCardIcons();

    if (isModelPage && hasHeader) {
      await LASSP.initSubpage();
    }

    LASSP.initFooter();
  } catch (err) {
    console.error("LASSP auto-init failed:", err);
  }
});
