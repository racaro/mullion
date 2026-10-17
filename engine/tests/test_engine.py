"""Engine tests, no GPU or models needed.

A fake ComfyUI validates the workflow against the real node signatures (extracted from
ComfyUI's nodes.py, see comfyui_signatures.json) and answers like the real API.
"""
from __future__ import annotations

import json
import struct
import sys
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from brief import LIGHTING, MATERIALS, NEGATIVE, ROOMS, STYLES, Brief, InvalidBrief, build_prompt, catalog  # noqa: E402
from client import ComfyClient, ComfyError, image_size  # noqa: E402
from workflow import RenderParams, build_workflow, fit_size  # noqa: E402

SIGNATURES = {k: v for k, v in json.loads((Path(__file__).parent / "comfyui_signatures.json").read_text()).items() if not k.startswith("_")}
ALLOWED = {  # combo values copied from ComfyUI
    ("ImageScale", "upscale_method"): ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"],
    ("ImageScale", "crop"): ["disabled", "center"],
    ("KSampler", "sampler_name"): ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde"],
    ("KSampler", "scheduler"): ["normal", "karras", "exponential", "sgm_uniform", "simple"],
}
CHECKPOINTS = ["v1-5-pruned-emaonly.safetensors"]
CONTROLNETS = ["control_v11p_sd15_lineart.pth", "control_v11p_sd15_scribble.pth"]


def png(width: int, height: int) -> bytes:
    row = b"\x00" + b"\xff\xff\xff" * width

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * height)) + chunk(b"IEND", b""))


# ---------- validator using the real signatures --------------------------------------
def validate(workflow: dict) -> list[str]:
    errors = []
    for nid, node in workflow.items():
        sig = SIGNATURES.get(node["class_type"])
        if not sig:
            errors.append(f"{nid}: unknown node {node['class_type']}")
            continue
        inputs = node["inputs"]
        errors += [f"{nid}: missing {name}" for name in sig["required"] if name not in inputs]
        for name, value in inputs.items():
            expected = sig["required"].get(name) or sig["optional"].get(name)
            if expected is None:
                errors.append(f"{nid}: unknown input {name}")
                continue
            if isinstance(value, list):  # link ["id", output]
                source = workflow.get(value[0])
                if source is None:
                    errors.append(f"{nid}.{name}: links to missing node {value[0]}")
                    continue
                outputs = SIGNATURES[source["class_type"]]["returns"]
                got = outputs[value[1]] if value[1] < len(outputs) else "?"
                if got != expected:
                    errors.append(f"{nid}.{name}: expects {expected}, gets {got}")
            elif (node["class_type"], name) in ALLOWED and value not in ALLOWED[(node["class_type"], name)]:
                errors.append(f"{nid}.{name}: value not allowed {value}")
    return errors


class FakeComfy(BaseHTTPRequestHandler):
    received: list[dict] = []
    fail_execution = False

    def log_message(self, *a):
        pass

    def _reply(self, code: int, data, content_type="application/json"):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/system_stats":
            return self._reply(200, {"system": {"os": "darwin"}})
        if self.path.startswith("/object_info/"):
            node = self.path.rsplit("/", 1)[1]
            field, values = {"CheckpointLoaderSimple": ("ckpt_name", CHECKPOINTS), "ControlNetLoader": ("control_net_name", CONTROLNETS)}[node]
            return self._reply(200, {node: {"input": {"required": {field: [values, {}]}}}})
        if self.path.startswith("/history/"):
            pid = self.path.rsplit("/", 1)[1]
            if FakeComfy.fail_execution:
                return self._reply(200, {pid: {"status": {"status_str": "error", "messages": [
                    ["execution_error", {"node_type": "KSampler", "exception_message": "MPS backend out of memory"}]]}}})
            return self._reply(200, {pid: {"status": {"status_str": "success"},
                                           "outputs": {"12": {"images": [{"filename": "x_00001_.png", "subfolder": "bench", "type": "output"}]}}}})
        if self.path.startswith("/view?"):
            return self._reply(200, png(8, 8), "image/png")
        self._reply(404, {})

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/upload/image":
            assert b'name="image"; filename="sketch.png"' in body
            return self._reply(200, {"name": "sketch.png", "subfolder": "", "type": "input"})
        if self.path == "/prompt":
            workflow = json.loads(body)["prompt"]
            for node in workflow.values():  # file check, like ComfyUI does
                if node["class_type"] == "CheckpointLoaderSimple" and node["inputs"]["ckpt_name"] not in CHECKPOINTS:
                    return self._reply(400, {"error": {"message": "Prompt outputs failed validation"}, "node_errors": {"1": {
                        "class_type": "CheckpointLoaderSimple",
                        "errors": [{"message": "Value not in list", "details": f"ckpt_name: '{node['inputs']['ckpt_name']}' not in list"}]}}})
            errors = validate(workflow)
            if errors:
                return self._reply(400, {"error": {"message": "; ".join(errors)}, "node_errors": {}})
            FakeComfy.received.append(workflow)
            return self._reply(200, {"prompt_id": f"id-{len(FakeComfy.received)}"})
        self._reply(404, {})


@pytest.fixture
def server():
    FakeComfy.received = []
    FakeComfy.fail_execution = False
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeComfy)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def params(**changes) -> RenderParams:
    base = dict(sketch_image="sketch.png", checkpoint=CHECKPOINTS[0], controlnet=CONTROLNETS[0],
                positive="living room", negative=NEGATIVE, width=768, height=512)
    return RenderParams(**{**base, **changes})


# ---------- brief -------------------------------------------------------------------
def test_prompt_order():
    pos, neg = build_prompt(Brief("living_room", "scandinavian", "golden_hour", ["floor_oak", "walls_white"]))
    assert pos.startswith("photorealistic interior design photography")
    assert pos.index("living room") < pos.index("scandinavian") < pos.index("light oak") < pos.index("golden hour")
    assert pos.endswith("sharp focus")
    assert "blurry" in neg


def test_prompt_dedupes_materials_and_adds_details():
    pos, _ = build_prompt(Brief("kitchen", "industrial", materials=["metal_black", "metal_black"], details="island with stools"))
    assert pos.count("matte black metal") == 1
    assert "island with stools" in pos


def test_invalid_brief_lists_valid_values():
    with pytest.raises(InvalidBrief, match="Unknown style 'gothic'.*scandinavian"):
        build_prompt(Brief("living_room", "gothic"))
    with pytest.raises(InvalidBrief, match="material"):
        build_prompt(Brief("living_room", "scandinavian", materials=["gold"]))


def test_every_option_has_english_and_spanish_label():
    for options in (ROOMS, STYLES, MATERIALS, LIGHTING):
        for key, option in options.items():
            assert option.label.get("en") and option.label.get("es"), key


def test_catalog_per_locale():
    assert catalog("es")["rooms"][0] == {"id": "living_room", "label": "Salón"}
    assert catalog("en")["rooms"][0] == {"id": "living_room", "label": "Living room"}
    assert catalog("fr")["styles"][0]["label"] == "Scandinavian"  # falls back to English


# ---------- workflow ----------------------------------------------------------------
def test_workflow_matches_real_signatures():
    assert validate(build_workflow(params())) == []


def test_workflow_without_invert_is_valid():
    workflow = build_workflow(params(invert_sketch=False))
    assert "4" not in workflow
    assert workflow["8"]["inputs"]["image"] == ["3", 0]
    assert validate(workflow) == []


def test_workflow_passes_parameters():
    w = build_workflow(params(seed=7, controlnet_strength=0.6, width=512, height=768))
    assert w["10"]["inputs"]["seed"] == 7
    assert w["8"]["inputs"]["strength"] == 0.6
    assert (w["9"]["inputs"]["width"], w["9"]["inputs"]["height"]) == (512, 768)
    assert (w["3"]["inputs"]["width"], w["3"]["inputs"]["height"]) == (512, 768)


def test_workflow_rejects_sizes_not_multiple_of_8():
    with pytest.raises(ValueError):
        build_workflow(params(width=770))


@pytest.mark.parametrize("original,expected", [((1600, 1200), (768, 576)), ((1080, 1920), (432, 768)), ((800, 800), (768, 768))])
def test_fit_size_keeps_aspect_ratio(original, expected):
    assert fit_size(*original) == expected


def test_image_size_png_and_jpeg(tmp_path):
    p = tmp_path / "a.png"
    p.write_bytes(png(1600, 1200))
    assert image_size(p) == (1600, 1200)
    j = tmp_path / "a.jpg"  # minimal JPEG: SOI + APP0 + SOF0 (height 300, width 400)
    j.write_bytes(b"\xff\xd8" + b"\xff\xe0\x00\x10" + b"JFIF\x00" + b"\x00" * 9 + b"\xff\xc0\x00\x11\x08\x01\x2c\x01\x90" + b"\x00" * 10)
    assert image_size(j) == (400, 300)


# ---------- client against the fake ComfyUI -----------------------------------------
def test_full_cycle(server, tmp_path):
    sketch = tmp_path / "sketch.png"
    sketch.write_bytes(png(1600, 1200))
    c = ComfyClient(server)
    assert c.options("ControlNetLoader", "control_net_name") == CONTROLNETS
    name = c.upload_image(sketch)
    paths = c.generate(build_workflow(params(sketch_image=name)), tmp_path / "out", "test")
    assert paths[0].read_bytes().startswith(b"\x89PNG")
    assert FakeComfy.received[0]["2"]["inputs"]["image"] == "sketch.png"


def test_validation_error_is_explained(server):
    with pytest.raises(ComfyError, match="Node 1.*not in list(.|\n)*Hint: the checkpoint"):
        ComfyClient(server).queue(build_workflow(params(checkpoint="missing.safetensors")))


def test_execution_error_is_explained(server):
    FakeComfy.fail_execution = True
    with pytest.raises(ComfyError, match="KSampler: MPS backend out of memory"):
        ComfyClient(server).wait("id-1", poll_s=0.01)


def test_unreachable_server_hints_at_port():
    with pytest.raises(ComfyError, match="port 8000"):
        ComfyClient("http://127.0.0.1:9", timeout=1).ping()


def test_bench_end_to_end(server, tmp_path, monkeypatch):
    import bench

    sketch = tmp_path / "sketch.png"
    sketch.write_bytes(png(1600, 1200))
    out = tmp_path / "res"
    monkeypatch.setattr(sys, "argv", ["bench.py", "--url", server, "--sketch", str(sketch), "--checkpoint", CHECKPOINTS[0],
                                      "--controlnet", ",".join(CONTROLNETS), "--strengths", "0.8,1.0", "--out", str(out)])
    assert bench.main() == 0
    assert len(FakeComfy.received) == 2 * 2 * 2  # 2 ControlNets × 2 strengths × 2 material sets
    assert {w["10"]["inputs"]["seed"] for w in FakeComfy.received} == {42}  # same seed everywhere
    page = (out / "comparison.html").read_text()
    assert page.count("<figure>") == 9 and "Original sketch" in page


def test_bench_reports_missing_controlnet(server, tmp_path, monkeypatch):
    import bench

    sketch = tmp_path / "sketch.png"
    sketch.write_bytes(png(100, 100))
    monkeypatch.setattr(sys, "argv", ["bench.py", "--url", server, "--sketch", str(sketch), "--checkpoint", CHECKPOINTS[0], "--controlnet", "other.pth"])
    with pytest.raises(SystemExit, match="other.pth"):
        bench.main()
