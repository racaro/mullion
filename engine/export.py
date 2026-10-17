"""Export the engine to the web app: brief options and reference cases for the TypeScript port.

The web app (web/) builds prompts and ComfyUI workflows in TypeScript. This script writes the
data it needs and a set of reference cases computed here, so both sides cannot drift apart:

    python3 export.py          # writes web/src/generated/engine.json and web/test/engine-cases.json

tests/test_engine.py fails if the committed files are out of date.
"""
from __future__ import annotations

import json
from pathlib import Path

from brief import CAMERA, LIGHTING, MATERIALS, MAX_DETAILS, NEGATIVE, QUALITY, ROOMS, STYLES, Brief, build_prompt
from workflow import RenderParams, build_workflow, fit_size

WEB = Path(__file__).resolve().parents[1] / "web"
ENGINE_FILE = WEB / "src" / "generated" / "engine.json"
CASES_FILE = WEB / "test" / "engine-cases.json"


def engine_data() -> dict:
    def options(group: dict) -> dict:
        return {k: {"prompt": o.prompt, "label": o.label} for k, o in group.items()}

    return {
        "_generated": "by engine/export.py — do not edit",
        "rooms": options(ROOMS),
        "styles": options(STYLES),
        "materials": options(MATERIALS),
        "lighting": options(LIGHTING),
        "quality": QUALITY,
        "camera": CAMERA,
        "negative": NEGATIVE,
        "maxDetails": MAX_DETAILS,
    }


def cases() -> dict:
    briefs = [
        Brief("living_room", "contemporary"),
        Brief("kitchen", "industrial", "golden_hour", ["floor_microcement", "metal_black", "floor_microcement"], " open shelves "),
    ]
    renders = [
        RenderParams(sketch_image="sketch.png", checkpoint="base.safetensors", controlnet="lineart.pth",
                     positive="living room", negative="blurry", width=768, height=560),
        RenderParams(sketch_image="s.jpg", checkpoint="base.safetensors", controlnet="lineart.pth", positive="p", negative="n",
                     width=512, height=768, seed=7, controlnet_strength=0.8, invert_sketch=False, erase_mask="m.png",
                     output_prefix="mullion/abc"),
    ]
    return {
        "_generated": "by engine/export.py — do not edit",
        "prompts": [{"brief": vars(b), "positive": build_prompt(b)[0], "negative": build_prompt(b)[1]} for b in briefs],
        "workflows": [{"params": vars(p), "workflow": build_workflow(p)} for p in renders],
        "fitSize": [{"size": s, "fit": fit_size(*s)} for s in [(2048, 1489), (1489, 2048), (1000, 1000), (100, 3000)]],
    }


def dump(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


def main() -> None:
    for path, data in ((ENGINE_FILE, engine_data()), (CASES_FILE, cases())):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dump(data), encoding="utf-8")
        print(f"Wrote {path.relative_to(WEB.parent)}")


if __name__ == "__main__":
    main()
