"""Plantilla de interiorismo: convierte una ficha en español en el prompt técnico (en inglés).

Los modelos Stable Diffusion entienden mucho mejor el inglés, así que el usuario elige
opciones en español y aquí se traducen a frases probadas. El texto libre se acepta solo
en inglés: más adelante lo generará el asistente de chat.
"""
from __future__ import annotations

from dataclasses import dataclass, field

ESTANCIAS = {
    "salon": "living room",
    "cocina": "kitchen",
    "dormitorio": "bedroom",
    "bano": "bathroom",
    "comedor": "dining room",
    "despacho": "home office",
    "recibidor": "entrance hall",
    "local": "retail shop interior",
}

ESTILOS = {
    "nordico": "scandinavian style, light wood, clean lines, cozy minimalism",
    "industrial": "industrial style, exposed concrete, black metal details",
    "mediterraneo": "mediterranean style, lime plaster walls, natural textures, terracotta accents",
    "contemporaneo": "contemporary style, neutral palette, refined finishes",
    "clasico": "classic style, moldings, elegant traditional furniture",
    "japandi": "japandi style, natural materials, muted tones, minimal decor",
}

MATERIALES = {
    "suelo_roble": "light oak wooden floor",
    "suelo_nogal": "dark walnut wooden floor",
    "suelo_marmol": "white marble floor",
    "suelo_microcemento": "grey microcement floor",
    "suelo_hidraulico": "patterned hydraulic tile floor",
    "paredes_blancas": "white painted walls",
    "paredes_cal": "textured lime plaster walls",
    "paredes_ladrillo": "exposed brick wall",
    "encimera_marmol": "marble countertop",
    "encimera_madera": "solid wood countertop",
    "textil_lino": "linen upholstery",
    "metal_negro": "matte black metal details",
}

LUCES = {
    "manana": "soft natural morning light through the windows",
    "tarde": "warm golden hour sunlight, long soft shadows",
    "nublado": "diffused overcast daylight, even soft light",
    "noche": "evening ambience, warm interior lamps, cozy lighting",
}

CALIDAD = "photorealistic interior design photography, professional architectural photo, high detail, 8k"
CAMARA = "wide angle lens, eye level, sharp focus"

NEGATIVO = (
    "blurry, low quality, distorted perspective, warped walls, bent lines, extra furniture, "
    "people, text, watermark, logo, cartoon, sketch, drawing, lowres, oversaturated"
)


class FichaInvalida(ValueError):
    """La ficha tiene una opción que no existe; el mensaje dice cuál y qué valores valen."""


@dataclass
class Ficha:
    estancia: str
    estilo: str
    luz: str = "manana"
    materiales: list[str] = field(default_factory=list)
    detalles_en: str = ""  # texto libre en inglés, opcional

    def validar(self) -> None:
        _comprobar("estancia", self.estancia, ESTANCIAS)
        _comprobar("estilo", self.estilo, ESTILOS)
        _comprobar("luz", self.luz, LUCES)
        for m in self.materiales:
            _comprobar("material", m, MATERIALES)
        if len(self.detalles_en) > 300:
            raise FichaInvalida("Los detalles no pueden superar 300 caracteres.")


def _comprobar(campo: str, valor: str, opciones: dict[str, str]) -> None:
    if valor not in opciones:
        validos = ", ".join(sorted(opciones))
        raise FichaInvalida(f"{campo} «{valor}» no existe. Valores posibles: {validos}.")


def construir_prompt(ficha: Ficha) -> tuple[str, str]:
    """Devuelve (positivo, negativo). El orden importa: lo primero pesa más en el modelo."""
    ficha.validar()
    partes = [
        CALIDAD,
        ESTANCIAS[ficha.estancia],
        ESTILOS[ficha.estilo],
        *[MATERIALES[m] for m in dict.fromkeys(ficha.materiales)],  # sin duplicados, en orden
        LUCES[ficha.luz],
    ]
    if ficha.detalles_en.strip():
        partes.append(ficha.detalles_en.strip())
    partes.append(CAMARA)
    return ", ".join(partes), NEGATIVO
