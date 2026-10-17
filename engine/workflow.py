"""ComfyUI workflow in API format: sketch → ControlNet → photorealistic image.

Uses only nodes that ship with ComfyUI (no custom nodes). Inputs checked against ComfyUI's
source (Comfy-Org/ComfyUI, nodes.py, October 2026).

Links between nodes are written as ["node_id", output_index].
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RenderParams:
    sketch_image: str  # name returned by /upload/image
    checkpoint: str  # file in models/checkpoints
    controlnet: str  # file in models/controlnet
    positive: str
    negative: str
    width: int
    height: int
    seed: int = 42
    controlnet_strength: float = 0.9  # how strictly the sketch is enforced (0–2; ~0.8–1.0 works well)
    controlnet_end: float = 1.0  # fraction of steps after which the sketch stops being enforced
    steps: int = 25
    cfg: float = 7.0
    sampler: str = "dpmpp_2m"
    scheduler: str = "karras"
    invert_sketch: bool = True  # line ControlNets expect white lines on black
    output_prefix: str = "mullion"


def build_workflow(p: RenderParams) -> dict:
    if p.width % 8 or p.height % 8:
        raise ValueError("Width and height must be multiples of 8.")
    workflow: dict = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": p.checkpoint}},
        "2": {"class_type": "LoadImage", "inputs": {"image": p.sketch_image}},
        "3": {
            "class_type": "ImageScale",
            "inputs": {"image": ["2", 0], "upscale_method": "lanczos", "width": p.width, "height": p.height, "crop": "disabled"},
        },
    }
    control_image = ["3", 0]
    if p.invert_sketch:
        workflow["4"] = {"class_type": "ImageInvert", "inputs": {"image": ["3", 0]}}
        control_image = ["4", 0]

    workflow.update(
        {
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": p.positive, "clip": ["1", 1]}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": p.negative, "clip": ["1", 1]}},
            "7": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": p.controlnet}},
            "8": {
                "class_type": "ControlNetApplyAdvanced",
                "inputs": {
                    "positive": ["5", 0],
                    "negative": ["6", 0],
                    "control_net": ["7", 0],
                    "image": control_image,
                    "strength": p.controlnet_strength,
                    "start_percent": 0.0,
                    "end_percent": p.controlnet_end,
                    "vae": ["1", 2],
                },
            },
            "9": {"class_type": "EmptyLatentImage", "inputs": {"width": p.width, "height": p.height, "batch_size": 1}},
            "10": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "seed": p.seed,
                    "steps": p.steps,
                    "cfg": p.cfg,
                    "sampler_name": p.sampler,
                    "scheduler": p.scheduler,
                    "positive": ["8", 0],
                    "negative": ["8", 1],
                    "latent_image": ["9", 0],
                    "denoise": 1.0,
                },
            },
            "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["1", 2]}},
            "12": {"class_type": "SaveImage", "inputs": {"images": ["11", 0], "filename_prefix": p.output_prefix}},
        }
    )
    return workflow


def fit_size(width: int, height: int, long_side: int = 768) -> tuple[int, int]:
    """Keep the sketch's aspect ratio, with a fixed long side and both sides multiples of 8.

    768 px suits Stable Diffusion 1.5 (larger sizes distort and are much slower).
    """
    if width <= 0 or height <= 0:
        raise ValueError("Invalid sketch dimensions.")
    scale = long_side / max(width, height)

    def snap(v: int) -> int:
        return max(256, int(round(v * scale / 8)) * 8)

    return snap(width), snap(height)
