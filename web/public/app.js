// Mullion web app: the render form with the erase brush, and the render list. Signed-out
// visitors are sent to /login.
import { applyLocale, mountLanguagePicker, preferredLocale, saveLocale } from "/i18n.js";

const $ = (selector) => document.querySelector(selector);
const POLL_MS = 5000;

let strings = {};
let locale = "en";
let user = null;

async function setLocale(next, { save = false } = {}) {
  [locale, strings] = await applyLocale(next);
  if (save) {
    saveLocale(locale);
    fetch("/api/me/locale", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) });
  }
  await fillOptions();
  await refreshRenders();
}

// ---------- brief options --------------------------------------------------------------
async function fillOptions() {
  const catalog = await (await fetch(`/api/catalog?locale=${locale}`)).json();
  const form = $("#new-render");
  for (const [name, group] of [["room", "rooms"], ["style", "styles"], ["lighting", "lighting"]]) {
    const select = form.elements[name];
    const previous = select.value;
    select.replaceChildren(...catalog[group].map((o) => new Option(o.label, o.id)));
    if (previous) select.value = previous;
  }
  const checked = new Set([...form.querySelectorAll("[name=materials]:checked")].map((el) => el.value));
  $("#materials").replaceChildren(...catalog.materials.map((m) => {
    const label = document.createElement("label");
    const box = Object.assign(document.createElement("input"), { type: "checkbox", name: "materials", value: m.id, checked: checked.has(m.id) });
    label.append(box, m.label);
    return label;
  }));
}

// ---------- erase brush ----------------------------------------------------------------
// The visible canvas shows the sketch with the erased areas tinted. Two hidden canvases the size
// of the sketch hold the strokes: the mask (white = ignore) sent with the render, and its tint.
const eraser = { image: null, mask: null, tint: null, painted: false, drawing: false };

function loadSketch(file) {
  const image = new Image();
  image.onload = () => {
    const canvas = $("#sketch-canvas");
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    Object.assign(canvas, size);
    eraser.image = image;
    eraser.mask = Object.assign(document.createElement("canvas"), size);
    eraser.tint = Object.assign(document.createElement("canvas"), size);
    clearMask();
    $("#eraser").hidden = false;
  };
  image.src = URL.createObjectURL(file);
}

function clearMask() {
  const ctx = eraser.mask.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, eraser.mask.width, eraser.mask.height);
  eraser.tint.getContext("2d").clearRect(0, 0, eraser.tint.width, eraser.tint.height);
  eraser.painted = false;
  redraw();
}

function redraw() {
  const ctx = $("#sketch-canvas").getContext("2d");
  ctx.drawImage(eraser.image, 0, 0);
  ctx.globalAlpha = 0.45;
  ctx.drawImage(eraser.tint, 0, 0);
  ctx.globalAlpha = 1;
}

function paint(event) {
  const canvas = $("#sketch-canvas");
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const radius = Math.max(canvas.width, canvas.height) * 0.02;
  for (const [layer, color] of [[eraser.mask, "#fff"], [eraser.tint, "#dc3c3c"]]) {
    const ctx = layer.getContext("2d");
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  eraser.painted = true;
  redraw();
}

function initEraser() {
  const canvas = $("#sketch-canvas");
  canvas.addEventListener("pointerdown", (e) => { eraser.drawing = true; canvas.setPointerCapture(e.pointerId); paint(e); });
  canvas.addEventListener("pointermove", (e) => eraser.drawing && paint(e));
  canvas.addEventListener("pointerup", () => (eraser.drawing = false));
  canvas.addEventListener("pointercancel", () => (eraser.drawing = false));
  $("#clear-erase").addEventListener("click", clearMask);
  $("#new-render").elements.sketch.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) loadSketch(file);
    else $("#eraser").hidden = true;
  });
}

// ---------- render form ----------------------------------------------------------------
async function submitRender(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("[type=submit]");
  const error = $("#form-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = strings.submitting;
  try {
    const body = new FormData();
    body.append("sketch", form.elements.sketch.files[0]);
    if (eraser.painted) body.append("mask", await new Promise((resolve) => eraser.mask.toBlob(resolve, "image/png")), "mask.png");
    body.append("brief", JSON.stringify({
      room: form.elements.room.value,
      style: form.elements.style.value,
      lighting: form.elements.lighting.value,
      materials: [...form.querySelectorAll("[name=materials]:checked")].map((el) => el.value),
      details: form.elements.details.value,
    }));
    const response = await fetch("/api/renders", { method: "POST", body });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? strings.error);
    await refreshRenders();
  } catch (e) {
    error.textContent = e.message || strings.error;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = strings.submit;
  }
}

// ---------- render list ----------------------------------------------------------------
let pollTimer = null;

async function refreshRenders() {
  clearTimeout(pollTimer);
  const response = await fetch("/api/renders");
  if (!response.ok) return;
  const renders = await response.json();
  $("#empty").hidden = renders.length > 0;
  $("#render-list").replaceChildren(...renders.map(renderCard));
  if (renders.some((r) => r.status === "queued" || r.status === "running")) pollTimer = setTimeout(refreshRenders, POLL_MS);
}

function renderCard(r) {
  const li = Object.assign(document.createElement("li"), { className: "render" });
  if (r.resultUrl) {
    const link = Object.assign(document.createElement("a"), { href: r.resultUrl, target: "_blank" });
    link.append(Object.assign(document.createElement("img"), { src: r.resultUrl, alt: "", width: r.width, height: r.height, loading: "lazy" }));
    li.append(link);
  } else {
    li.append(Object.assign(document.createElement("div"), { className: "placeholder", textContent: strings[`status.${r.status}`] }));
  }
  const meta = Object.assign(document.createElement("div"), { className: "meta" });
  const status = Object.assign(document.createElement("span"), { className: `status-${r.status}`, textContent: strings[`status.${r.status}`] });
  if (r.error && r.status === "failed") status.title = r.error;
  meta.append(status);
  if (r.resultUrl) meta.append(Object.assign(document.createElement("a"), { href: r.resultUrl, download: `mullion-${r.id}.png`, textContent: strings.download }));
  li.append(meta);
  return li;
}

// ---------- account menu ---------------------------------------------------------------
// Google profile photos come from this host only (it is allowed in the CSP); anything else shows initials.
const AVATAR_HOST = "https://lh3.googleusercontent.com/";

function initials(user) {
  const words = (user.name || user.email).split(/[\s@.]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function fillAvatar(el, user) {
  el.textContent = initials(user);
  if (!user.picture?.startsWith(AVATAR_HOST)) return;
  const img = Object.assign(document.createElement("img"), { src: user.picture, alt: "", referrerPolicy: "no-referrer" });
  img.addEventListener("load", () => el.replaceChildren(img));
}

function initAccountMenu() {
  const button = $("#account-button");
  const menu = $("#account-menu");
  const open = (next) => {
    menu.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
  };
  button.addEventListener("click", () => open(menu.hidden));
  document.addEventListener("click", (e) => !menu.hidden && !e.target.closest(".account") && open(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      open(false);
      button.focus();
    }
  });
}

// ---------- start ------------------------------------------------------------------------
async function start() {
  const me = await fetch("/api/me");
  if (!me.ok) {
    location.replace(me.status === 403 ? "/login?signin=not_invited" : "/login"); // 403: removed from the pilot
    return;
  }
  user = await me.json();
  $("#user-name").textContent = user.name || user.email;
  $("#menu-name").textContent = user.name || user.email;
  $("#menu-email").textContent = user.email;
  fillAvatar($("#avatar"), user);
  fillAvatar($("#avatar-large"), user);
  document.body.hidden = false;
  mountLanguagePicker($("#menu-lang"), (choice) => setLocale(choice, { save: true }));
  await setLocale(preferredLocale(user.locale));
  initAccountMenu();
  window.MullionTheme.bindToggle($("#theme-toggle"));
  initEraser();
  $("#new-render").addEventListener("submit", submitRender);
}

start();
