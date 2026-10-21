// Gallery, laid out like a streaming app: a hero for the latest render, then rows that scroll
// sideways (in progress, recent, one per room, failed). Hovering a card grows it and, after a
// moment, shows the sketch it came from. Opening one compares sketch and render with a slider.
import { onRoute } from "/app/router.js";
import { briefTitle, formatDate, onLocaleChange, optionLabel, state } from "/app/state.js";
import { api } from "/lib/api.js";
import { $, h, icon } from "/lib/dom.js";

const POLL_MS = 5000;
const RECENT_LIMIT = 12;

let renders = [];
let visible = false;
let pollTimer = null;

export function initGallery() {
  onRoute((route) => {
    visible = route === "gallery";
    clearTimeout(pollTimer);
    if (visible) refresh();
  });
  onLocaleChange(() => visible && draw());
  initDetail();
}

async function refresh() {
  clearTimeout(pollTimer);
  try {
    renders = await api.renders();
  } catch {
    return; // keep what is on screen; the next visit tries again
  }
  if (!visible) return;
  draw();
  if (renders.some(isPending)) pollTimer = setTimeout(refresh, POLL_MS);
}

const isPending = (r) => r.status === "queued" || r.status === "running";

function draw() {
  const { strings } = state;
  const done = renders.filter((r) => r.status === "done");
  const pending = renders.filter(isPending);
  const failed = renders.filter((r) => r.status === "failed");

  $("#gallery-hero").replaceChildren(hero(done[0], pending[0]));

  const rows = [];
  if (pending.length) rows.push(row(strings.rowInProgress, pending));
  if (done.length) rows.push(row(strings.rowRecent, done.slice(0, RECENT_LIMIT)));
  for (const room of state.catalog.rooms) {
    const inRoom = done.filter((r) => r.brief.room === room.id);
    if (inRoom.length) rows.push(row(room.label, inRoom));
  }
  if (failed.length) rows.push(row(strings.rowFailed, failed));
  $("#gallery-rows").replaceChildren(...rows);
}

// ---------- hero ------------------------------------------------------------------------
function hero(latest, pending) {
  const { strings } = state;
  if (!latest) {
    // Nothing finished yet: invite the first render, or say it is on its way.
    return h("section", { className: "hero hero-empty" },
      pending && h("img", { className: "hero-image", src: pending.sketchUrl, alt: "" }),
      h("div", { className: "hero-content" },
        h("p", { className: "hero-eyebrow" }, pending ? strings[`status.${pending.status}`] : strings.galleryEmptyEyebrow),
        h("h1", { className: "hero-title" }, pending ? briefTitle(pending.brief) : strings.galleryEmptyTitle),
        h("p", { className: "hero-text sketch" }, pending ? strings.galleryPendingText : strings.galleryEmptyText),
        !pending && h("a", { className: "primary-button", href: "#/create" }, icon("create"), strings.galleryEmptyCta)));
  }
  return h("section", { className: "hero" },
    h("img", { className: "hero-image", src: latest.resultUrl, alt: "" }),
    h("div", { className: "hero-content" },
      h("p", { className: "hero-eyebrow" }, strings.heroLatest),
      h("h1", { className: "hero-title" }, briefTitle(latest.brief)),
      h("p", { className: "hero-meta" }, `${optionLabel("lighting", latest.brief.lighting)} · ${formatDate(latest.createdAt)}`),
      h("div", { className: "hero-actions" },
        h("button", { type: "button", className: "primary-button", onclick: () => openDetail(latest) }, icon("play"), strings.view),
        h("a", { className: "secondary-button", href: latest.resultUrl, download: `mullion-${latest.id}.png` }, icon("download"), strings.download))));
}

// ---------- rows ------------------------------------------------------------------------
function row(title, items) {
  const { strings } = state;
  const track = h("ul", { className: "row-track" }, items.map((r) => h("li", {}, card(r))));
  const scroll = (direction) => track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: "smooth" });
  return h("section", { className: "row" },
    h("header", { className: "row-head" },
      h("h2", {}, title),
      h("span", { className: "row-count" }, String(items.length))),
    h("div", { className: "row-frame" },
      h("button", { type: "button", className: "row-arrow prev", "aria-label": strings.previous, onclick: () => scroll(-1) }, icon("chevronLeft")),
      track,
      h("button", { type: "button", className: "row-arrow next", "aria-label": strings.next, onclick: () => scroll(1) }, icon("chevronRight"))));
}

function card(r) {
  const { strings } = state;
  const pending = isPending(r);
  const image = r.resultUrl ?? r.sketchUrl;
  const el = h("button", {
    type: "button",
    className: `card card-${r.status}`,
    "aria-label": `${briefTitle(r.brief)}, ${strings[`status.${r.status}`]}`,
    onclick: () => openDetail(r),
  },
  h("img", { className: "card-image", src: image, alt: "", loading: "lazy" }),
  r.resultUrl && h("img", { className: "card-peek", src: r.sketchUrl, alt: "", loading: "lazy" }),
  pending && h("span", { className: "card-status" }, h("span", { className: "pulse" }), strings[`status.${r.status}`]),
  h("span", { className: "card-info" },
    h("strong", {}, briefTitle(r.brief)),
    h("span", {}, r.status === "failed" ? strings["status.failed"] : formatDate(r.createdAt))));

  // Like a trailer: after a short hover, the finished render fades to its sketch.
  let timer;
  el.addEventListener("pointerenter", () => (timer = setTimeout(() => el.classList.add("peeking"), 700)));
  el.addEventListener("pointerleave", () => {
    clearTimeout(timer);
    el.classList.remove("peeking");
  });
  return el;
}

// ---------- detail ----------------------------------------------------------------------
function initDetail() {
  const dialog = $("#detail");
  $("#detail-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close()); // click on the backdrop
  $("#compare-range").addEventListener("input", (e) => $("#compare").style.setProperty("--split", `${e.target.value}%`));
}

function openDetail(r) {
  const { strings } = state;
  const dialog = $("#detail");
  $("#detail-title").textContent = briefTitle(r.brief);
  $("#detail-meta").textContent = r.status === "done" ? formatDate(r.createdAt) : strings[`status.${r.status}`];

  const compare = $("#compare");
  compare.style.aspectRatio = `${r.width} / ${r.height}`;
  compare.style.setProperty("--split", "50%");
  compare.classList.toggle("sketch-only", !r.resultUrl);
  $("#compare-range").value = 50;
  $("#compare-sketch").src = r.sketchUrl;
  if (r.resultUrl) $("#compare-render").src = r.resultUrl;

  const chips = [
    optionLabel("rooms", r.brief.room),
    optionLabel("styles", r.brief.style),
    optionLabel("lighting", r.brief.lighting),
    ...r.brief.materials.map((m) => optionLabel("materials", m)),
  ];
  $("#detail-chips").replaceChildren(...chips.map((label) => h("li", {}, label)),
    r.brief.details && h("li", { className: "details" }, r.brief.details));

  const download = $("#detail-download");
  download.hidden = !r.resultUrl;
  if (r.resultUrl) Object.assign(download, { href: r.resultUrl, download: `mullion-${r.id}.png` });
  dialog.showModal();
}

