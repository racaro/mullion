"""Flujo de ComfyUI en formato API: boceto → ControlNet → imagen realista.

Solo usa nodos que vienen con ComfyUI (sin extensiones). Entradas comprobadas contra el
código de ComfyUI (Comfy-Org/ComfyUI, nodes.py, octubre 2026).

Cada nodo se referencia como ["id_nodo", indice_salida].
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ParametrosRender:
    imagen_boceto: str  # nombre devuelto por /upload/image
    modelo: str  # archivo en models/checkpoints
    controlnet: str  # archivo en models/controlnet
    positivo: str
    negativo: str
    ancho: int
    alto: int
    semilla: int = 42
    fuerza_controlnet: float = 0.9  # cuánto obliga el boceto (0–2; ~0.8–1.0 suele ir bien)
    fin_controlnet: float = 1.0  # en qué % de los pasos deja de obligar (1.0 = hasta el final)
    pasos: int = 25
    cfg: float = 7.0
    muestreador: str = "dpmpp_2m"
    planificador: str = "karras"
    invertir_boceto: bool = True  # los ControlNet de líneas esperan líneas blancas sobre negro
    prefijo_salida: str = "boceto_render"


def construir_flujo(p: ParametrosRender) -> dict:
    if p.ancho % 8 or p.alto % 8:
        raise ValueError("Ancho y alto deben ser múltiplos de 8.")
    flujo: dict = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": p.modelo}},
        "2": {"class_type": "LoadImage", "inputs": {"image": p.imagen_boceto}},
        "3": {
            "class_type": "ImageScale",
            "inputs": {"image": ["2", 0], "upscale_method": "lanczos", "width": p.ancho, "height": p.alto, "crop": "disabled"},
        },
    }
    imagen_control = ["3", 0]
    if p.invertir_boceto:
        flujo["4"] = {"class_type": "ImageInvert", "inputs": {"image": ["3", 0]}}
        imagen_control = ["4", 0]

    flujo.update(
        {
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": p.positivo, "clip": ["1", 1]}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": p.negativo, "clip": ["1", 1]}},
            "7": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": p.controlnet}},
            "8": {
                "class_type": "ControlNetApplyAdvanced",
                "inputs": {
                    "positive": ["5", 0],
                    "negative": ["6", 0],
                    "control_net": ["7", 0],
                    "image": imagen_control,
                    "strength": p.fuerza_controlnet,
                    "start_percent": 0.0,
                    "end_percent": p.fin_controlnet,
                    "vae": ["1", 2],
                },
            },
            "9": {"class_type": "EmptyLatentImage", "inputs": {"width": p.ancho, "height": p.alto, "batch_size": 1}},
            "10": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "seed": p.semilla,
                    "steps": p.pasos,
                    "cfg": p.cfg,
                    "sampler_name": p.muestreador,
                    "scheduler": p.planificador,
                    "positive": ["8", 0],
                    "negative": ["8", 1],
                    "latent_image": ["9", 0],
                    "denoise": 1.0,
                },
            },
            "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["1", 2]}},
            "12": {"class_type": "SaveImage", "inputs": {"images": ["11", 0], "filename_prefix": p.prefijo_salida}},
        }
    )
    return flujo


def medidas_para(ancho_original: int, alto_original: int, lado_largo: int = 768) -> tuple[int, int]:
    """Mantiene la proporción del boceto; lado largo fijo y ambos lados múltiplos de 8.

    768 px es un buen tamaño para Stable Diffusion 1.5 (más grande deforma y tarda mucho).
    """
    if ancho_original <= 0 or alto_original <= 0:
        raise ValueError("Medidas del boceto no válidas.")
    escala = lado_largo / max(ancho_original, alto_original)
    redondear = lambda v: max(256, int(round(v * escala / 8)) * 8)  # noqa: E731
    return redondear(ancho_original), redondear(alto_original)
