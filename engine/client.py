"""Minimal ComfyUI API client (Python standard library only).

Routes used (from ComfyUI's server.py): POST /upload/image, POST /prompt,
GET /history/{id}, GET /view, GET /object_info/{node}. The backend will reuse this.
"""
from __future__ import annotations

import json
import struct
import time
import uuid
from pathlib import Path
from urllib import error, parse, request


class ComfyError(RuntimeError):
    """A ComfyUI failure with a human-readable explanation."""


class ComfyClient:
    def __init__(self, url: str = "http://127.0.0.1:8000", timeout: float = 30):
        self.url = url.rstrip("/")
        self.timeout = timeout

    # --- HTTP helpers ----------------------------------------------------------------
    def _request(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None) -> bytes:
        req = request.Request(self.url + path, data=body, method=method, headers=headers or {})
        try:
            with request.urlopen(req, timeout=self.timeout) as r:
                return r.read()
        except error.HTTPError as e:
            raise ComfyError(_explain_http_error(e.code, e.read())) from None
        except error.URLError as e:
            raise ComfyError(
                f"Cannot reach ComfyUI at {self.url}. Is it running? "
                "The desktop app usually listens on port 8000 and a manual install on 8188. "
                f"Details: {e.reason}"
            ) from None

    def _json(self, method: str, path: str, data: dict | None = None) -> dict:
        body = json.dumps(data).encode() if data is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        return json.loads(self._request(method, path, body, headers) or b"{}")

    # --- API -----------------------------------------------------------------------
    def ping(self) -> dict:
        return self._json("GET", "/system_stats")

    def options(self, node: str, input_name: str) -> list[str]:
        """Allowed values of a node input, e.g. the installed models."""
        info = self._json("GET", f"/object_info/{node}").get(node, {})
        definition = info.get("input", {}).get("required", {}).get(input_name, [[]])
        values = definition[0]
        if isinstance(values, str) and len(definition) > 1:  # newer format: ("COMBO", {"options": [...]})
            values = definition[1].get("options", [])
        return list(values) if isinstance(values, list) else []

    def upload_image(self, path: Path) -> str:
        """Upload the sketch to ComfyUI's input folder and return the name to reference it by."""
        boundary = f"----mullion{uuid.uuid4().hex}"
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n".encode(),
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n"
            ).encode()
            + path.read_bytes()
            + b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        resp = json.loads(
            self._request("POST", "/upload/image", b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"})
        )
        sub = resp.get("subfolder") or ""
        return f"{sub}/{resp['name']}" if sub else resp["name"]

    def queue(self, workflow: dict) -> str:
        return self._json("POST", "/prompt", {"prompt": workflow, "client_id": "mullion"})["prompt_id"]

    def wait(self, prompt_id: str, timeout_s: float = 900, poll_s: float = 2) -> dict:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            history = self._json("GET", f"/history/{prompt_id}")
            if prompt_id in history:
                entry = history[prompt_id]
                status = entry.get("status", {})
                if status.get("status_str") == "error":
                    raise ComfyError(f"ComfyUI failed while generating: {_execution_message(status)}")
                return entry
            time.sleep(poll_s)
        raise ComfyError(f"Generation did not finish within {timeout_s:.0f} s.")

    def download_images(self, entry: dict, folder: Path, name: str) -> list[Path]:
        folder.mkdir(parents=True, exist_ok=True)
        paths = []
        for output in entry.get("outputs", {}).values():
            for i, img in enumerate(output.get("images", [])):
                q = parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")})
                target = folder / (f"{name}.png" if i == 0 else f"{name}_{i}.png")
                target.write_bytes(self._request("GET", f"/view?{q}"))
                paths.append(target)
        if not paths:
            raise ComfyError("Generation finished but returned no image.")
        return paths

    def generate(self, workflow: dict, folder: Path, name: str) -> list[Path]:
        return self.download_images(self.wait(self.queue(workflow)), folder, name)


def _explain_http_error(code: int, body: bytes) -> str:
    try:
        data = json.loads(body)
    except ValueError:
        return f"ComfyUI returned {code}: {body[:300].decode(errors='replace')}"
    lines = [f"ComfyUI rejected the request ({code}): {data.get('error', {}).get('message', '')}".strip()]
    for node, info in (data.get("node_errors") or {}).items():
        for err in info.get("errors", []):
            lines.append(f"  · Node {node} ({info.get('class_type', '?')}): {err.get('details') or err.get('message')}")
    if any("not in" in line for line in lines):
        lines.append("  Hint: the checkpoint or ControlNet name does not match a file in your ComfyUI (run with --list).")
    return "\n".join(lines)


def _execution_message(status: dict) -> str:
    for kind, data in status.get("messages", []):
        if kind == "execution_error":
            return f"{data.get('node_type', '?')}: {data.get('exception_message', '').strip()}"
    return "unknown error"


def image_size(path: Path) -> tuple[int, int]:
    """Width and height of a PNG or JPEG, read from its header (no external libraries)."""
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = struct.unpack(">H", data[i + 2 : i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">HH", data[i + 5 : i + 9])
                return width, height
            i += 2 + length
    raise ValueError(f"{path.name}: unsupported format. Use PNG or JPG.")
