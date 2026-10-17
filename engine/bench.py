"""Engine bench: does the render respect the sketch?

Renders the same sketch several times, changing one thing at a time (ControlNet strength,
ControlNet type and materials) with a fixed seed, and builds comparison.html to view
them side by side.

Usage (with ComfyUI running):
    python3 bench.py --list
    python3 bench.py --sketch sketch.jpg --checkpoint <file> --controlnet <file>
"""
from __future__ import annotations

import argparse
import html
import sys
import time
from pathlib import Path

from brief import LIGHTING, MATERIALS, ROOMS, STYLES, Brief, InvalidBrief, build_prompt
from client import ComfyClient, ComfyError, image_size
from workflow import RenderParams, build_workflow, fit_size


def csv_list(text: str) -> list[str]:
    return [t.strip() for t in text.split(",") if t.strip()]


def parse_args() -> argparse.Namespace:
    a = argparse.ArgumentParser(description="Mullion engine bench: sketch → render with ComfyUI")
    a.add_argument("--url", default="http://127.0.0.1:8000", help="ComfyUI address (desktop app: 8000; manual install: 8188)")
    a.add_argument("--list", action="store_true", help="Show installed checkpoints and ControlNets, then exit")
    a.add_argument("--sketch", type=Path, help="Sketch image (PNG or JPG)")
    a.add_argument("--checkpoint", help="Base model file (models/checkpoints)")
    a.add_argument("--controlnet", type=csv_list, help="One or more ControlNet files, comma-separated")
    a.add_argument("--strengths", type=lambda t: [float(x) for x in csv_list(t)], default=[0.6, 0.8, 1.0])
    a.add_argument("--seed", type=int, default=42)
    a.add_argument("--steps", type=int, default=25)
    a.add_argument("--room", default="living_room", choices=sorted(ROOMS))
    a.add_argument("--style", default="scandinavian", choices=sorted(STYLES))
    a.add_argument("--lighting", default="morning", choices=sorted(LIGHTING))
    a.add_argument("--materials", type=csv_list, default=["floor_oak", "walls_white"])
    a.add_argument("--materials-b", type=csv_list, default=["floor_marble", "walls_lime"],
                   help="Second material set, to check that changing materials keeps the layout")
    a.add_argument("--erase-mask", type=Path,
                   help="Image the size of the sketch, white over what to ignore (people, notes), black elsewhere")
    a.add_argument("--no-invert", action="store_true", help="Use if your sketch already has white lines on black")
    a.add_argument("--out", type=Path, default=Path("results"))
    return a.parse_args()


def list_models(client: ComfyClient) -> None:
    for title, node, field in (("Checkpoints", "CheckpointLoaderSimple", "ckpt_name"), ("ControlNets", "ControlNetLoader", "control_net_name")):
        names = client.options(node, field)
        print(f"{title}:")
        print("\n".join(f"  · {n}" for n in names) or "  (none — download one with the Manager)")


def check_names(client: ComfyClient, checkpoint: str, controlnets: list[str]) -> None:
    checkpoints = client.options("CheckpointLoaderSimple", "ckpt_name")
    available = client.options("ControlNetLoader", "control_net_name")
    missing = ([checkpoint] if checkpoint not in checkpoints else []) + [c for c in controlnets if c not in available]
    if missing:
        raise SystemExit("Not found in ComfyUI: " + ", ".join(missing) + ". Run with --list to see the exact names.")


def comparison_page(rows: list[dict], sketch: str, prompt_a: str, prompt_b: str) -> str:
    cards = "\n".join(
        f"""<figure><img src="{html.escape(r['image'])}" alt=""><figcaption>
<b>{html.escape(r['controlnet'])}</b><br>strength {r['strength']} · materials {r['variant']} · {r['seconds']:.0f} s</figcaption></figure>"""
        for r in rows
    )
    return f"""<!doctype html><html lang="en"><meta charset="utf-8"><title>Mullion bench</title>
<style>body{{font:15px/1.5 -apple-system,Segoe UI,sans-serif;margin:24px;background:#f6f6f4;color:#1d1d1b}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}}
figure{{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden}}
img{{width:100%;display:block}} figcaption{{padding:8px 12px;font-size:13px}} code{{font-size:12px}}</style>
<h1>Sketch → render comparison</h1>
<p>Same seed everywhere. Check whether furniture, doors and windows stay where the sketch puts them.</p>
<div class="grid"><figure><img src="{html.escape(sketch)}" alt=""><figcaption><b>Original sketch</b></figcaption></figure>
{cards}</div>
<h2>Prompts</h2><p><b>A:</b> <code>{html.escape(prompt_a)}</code></p><p><b>B:</b> <code>{html.escape(prompt_b)}</code></p></html>"""


def main() -> int:
    args = parse_args()
    client = ComfyClient(args.url)
    try:
        client.ping()
        if args.list:
            list_models(client)
            return 0
        if not (args.sketch and args.checkpoint and args.controlnet):
            print("Missing --sketch, --checkpoint or --controlnet (use --list to see the names).", file=sys.stderr)
            return 2
        check_names(client, args.checkpoint, args.controlnet)

        prompt_a, negative = build_prompt(Brief(args.room, args.style, args.lighting, args.materials))
        prompt_b, _ = build_prompt(Brief(args.room, args.style, args.lighting, args.materials_b))

        width, height = fit_size(*image_size(args.sketch))
        uploaded = client.upload_image(args.sketch)
        erase_mask = client.upload_image(args.erase_mask) if args.erase_mask else None
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / args.sketch.name).write_bytes(args.sketch.read_bytes())

        runs = [
            (cn, strength, variant, prompt)
            for cn in args.controlnet
            for strength in args.strengths
            for variant, prompt in (("A", prompt_a), ("B", prompt_b))
        ]
        print(f"Sketch {args.sketch.name} → {width}×{height} px. {len(runs)} images to render.")
        rows = []
        for n, (cn, strength, variant, prompt) in enumerate(runs, 1):
            name = f"{Path(cn).stem}_s{strength:.2f}_{variant}"
            workflow = build_workflow(RenderParams(
                sketch_image=uploaded, checkpoint=args.checkpoint, controlnet=cn, positive=prompt, negative=negative,
                width=width, height=height, seed=args.seed, controlnet_strength=strength, steps=args.steps,
                invert_sketch=not args.no_invert, erase_mask=erase_mask, output_prefix=f"bench/{name}",
            ))
            started = time.monotonic()
            path = client.generate(workflow, args.out, name)[0]
            seconds = time.monotonic() - started
            print(f"  [{n}/{len(runs)}] {name}: {seconds:.0f} s")
            rows.append({"image": path.name, "controlnet": cn, "strength": strength, "variant": variant, "seconds": seconds})
            (args.out / "comparison.html").write_text(comparison_page(rows, args.sketch.name, prompt_a, prompt_b), encoding="utf-8")

        print(f"Done. Open {args.out / 'comparison.html'}")
        return 0
    except (ComfyError, InvalidBrief, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
