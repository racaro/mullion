// Create screen: the sketch fills the workspace (drop or pick a file, then paint over what to
// ignore) and the brief sits beside it. Submitting queues the render and opens the gallery.
import { navigate } from "/app/router.js";
import { onLocaleChange, state } from "/app/state.js";
import { api } from "/lib/api.js";
import { $, $$, h, toast } from "/lib/dom.js";

// Brief groups: radio chips pick one, checkbox chips pick several.
const GROUPS = [
  { name: "room", catalog: "rooms", type: "radio", container: "#room-options" },
  { name: "style", catalog: "styles", type: "radio", container: "#style-options" },
  { name: "lighting", catalog: "lighting", type: "radio", container: "#lighting-options" },
  { name: "materials", catalog: "materials", type: "checkbox", container: "#material-options" },
];

export function initCreate() {
  onLocaleChange(fillOptions);
  initSketch();
  $("#new-render").addEventListener("submit", submitRender);
}

function fillOptions() {
  const form = $("#new-render");
  for (const group of GROUPS) {
    const chosen = new Set($$(`[name="${group.name}"]:checked`, form).map((el) => el.value));
    const options = state.catalog[group.catalog];
    $(group.container).replaceChildren(...options.map((option, i) => {
      const checked = chosen.size ? chosen.has(option.id) : group.type === "radio" && i === 0;
      return h("label", { className: "chip" },
        h("input", { type: group.type, name: group.name, value: option.id, checked }),
        h("span", {}, option.label));
    }));
  }
}

// ---------- sketch and erase brush ------------------------------------------------------
// The visible canvas shows the sketch with the erased areas tinted. Two hidden canvases the size
// of the sketch hold the strokes: the mask (white = ignore) sent with the render, and its tint.
const sketch = { file: null, image: null, mask: null, tint: null, painted: false, drawing: false };

function initSketch() {
  const input = $("#sketch-input");
  const workspace = $("#workspace");
  input.addEventListener("change", () => {
    if (input.files[0]) loadSketch(input.files[0]);
    input.value = ""; // picking the same file again still fires change
  });
  $("#change-sketch").addEventListener("click", () => input.click());
  $("#clear-erase").addEventListener("click", clearMask);

  workspace.addEventListener("dragover", (e) => {
    e.preventDefault();
    workspace.classList.add("dragging");
  });
  workspace.addEventListener("dragleave", () => workspace.classList.remove("dragging"));
  workspace.addEventListener("drop", (e) => {
    e.preventDefault();
    workspace.classList.remove("dragging");
    const file = [...e.dataTransfer.files].find((f) => ["image/png", "image/jpeg"].includes(f.type));
    if (file) loadSketch(file);
  });

  const canvas = $("#sketch-canvas");
  canvas.addEventListener("pointerdown", (e) => {
    sketch.drawing = true;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  canvas.addEventListener("pointermove", (e) => sketch.drawing && paint(e));
  canvas.addEventListener("pointerup", () => (sketch.drawing = false));
  canvas.addEventListener("pointercancel", () => (sketch.drawing = false));
}

function loadSketch(file) {
  const image = new Image();
  image.onload = () => {
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    Object.assign($("#sketch-canvas"), size);
    Object.assign(sketch, {
      file, image,
      mask: Object.assign(document.createElement("canvas"), size),
      tint: Object.assign(document.createElement("canvas"), size),
    });
    clearMask();
    $("#dropzone").hidden = true;
    $("#canvas-stage").hidden = false;
    $("#workspace-toolbar").hidden = false;
    $("#form-error").hidden = true;
  };
  image.src = URL.createObjectURL(file);
}

function clearMask() {
  if (!sketch.mask) return;
  const ctx = sketch.mask.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, sketch.mask.width, sketch.mask.height);
  sketch.tint.getContext("2d").clearRect(0, 0, sketch.tint.width, sketch.tint.height);
  sketch.painted = false;
  redraw();
}

function redraw() {
  const ctx = $("#sketch-canvas").getContext("2d");
  ctx.drawImage(sketch.image, 0, 0);
  ctx.globalAlpha = 0.45;
  ctx.drawImage(sketch.tint, 0, 0);
  ctx.globalAlpha = 1;
}

function paint(event) {
  const canvas = $("#sketch-canvas");
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const radius = Math.max(canvas.width, canvas.height) * 0.02;
  for (const [layer, color] of [[sketch.mask, "#fff"], [sketch.tint, "#dc3c3c"]]) {
    const ctx = layer.getContext("2d");
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  sketch.painted = true;
  redraw();
}

// ---------- submit ----------------------------------------------------------------------
async function submitRender(event) {
  event.preventDefault();
  const form = event.target;
  const button = $("#submit-render");
  const error = $("#form-error");
  const { strings } = state;
  error.hidden = true;
  if (!sketch.file) {
    error.textContent = strings.needSketch;
    error.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = strings.submitting;
  try {
    const body = new FormData();
    body.append("sketch", sketch.file);
    if (sketch.painted) body.append("mask", await new Promise((resolve) => sketch.mask.toBlob(resolve, "image/png")), "mask.png");
    const value = (name) => form.querySelector(`[name="${name}"]:checked`)?.value;
    body.append("brief", JSON.stringify({
      room: value("room"),
      style: value("style"),
      lighting: value("lighting"),
      materials: $$('[name="materials"]:checked', form).map((el) => el.value),
      details: form.elements.details.value,
    }));
    await api.createRender(body);
    toast(strings.queued);
    navigate("gallery");
  } catch (e) {
    error.textContent = e.message || strings.error;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = strings.submit;
  }
}
