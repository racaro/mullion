"""Room brief: turns structured choices into the technical prompt for the image model.

Users pick options (shown in English or Spanish through ``label``); each option maps to a
prompt phrase that has been written for Stable Diffusion, which works best in English.
Free-text ``details`` must be in English; later the chat assistant will write it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import NamedTuple


class Option(NamedTuple):
    prompt: str
    label: dict[str, str]  # UI label per locale: {"en": ..., "es": ...}


ROOMS: dict[str, Option] = {
    "living_room": Option("living room", {"en": "Living room", "es": "Salón"}),
    "kitchen": Option("kitchen", {"en": "Kitchen", "es": "Cocina"}),
    "bedroom": Option("bedroom", {"en": "Bedroom", "es": "Dormitorio"}),
    "bathroom": Option("bathroom", {"en": "Bathroom", "es": "Baño"}),
    "dining_room": Option("dining room", {"en": "Dining room", "es": "Comedor"}),
    "home_office": Option("home office", {"en": "Home office", "es": "Despacho"}),
    "entrance_hall": Option("entrance hall", {"en": "Entrance hall", "es": "Recibidor"}),
    "retail": Option("retail shop interior", {"en": "Shop", "es": "Local comercial"}),
}

STYLES: dict[str, Option] = {
    "scandinavian": Option("scandinavian style, light wood, clean lines, cozy minimalism", {"en": "Scandinavian", "es": "Nórdico"}),
    "industrial": Option("industrial style, exposed concrete, black metal details", {"en": "Industrial", "es": "Industrial"}),
    "mediterranean": Option(
        "mediterranean style, lime plaster walls, natural textures, terracotta accents", {"en": "Mediterranean", "es": "Mediterráneo"}
    ),
    "contemporary": Option("contemporary style, neutral palette, refined finishes", {"en": "Contemporary", "es": "Contemporáneo"}),
    "classic": Option("classic style, moldings, elegant traditional furniture", {"en": "Classic", "es": "Clásico"}),
    "japandi": Option("japandi style, natural materials, muted tones, minimal decor", {"en": "Japandi", "es": "Japandi"}),
}

MATERIALS: dict[str, Option] = {
    "floor_oak": Option("light oak wooden floor", {"en": "Light oak floor", "es": "Suelo de roble claro"}),
    "floor_walnut": Option("dark walnut wooden floor", {"en": "Walnut floor", "es": "Suelo de nogal"}),
    "floor_marble": Option("white marble floor", {"en": "White marble floor", "es": "Suelo de mármol blanco"}),
    "floor_microcement": Option("grey microcement floor", {"en": "Microcement floor", "es": "Suelo de microcemento"}),
    "floor_encaustic": Option("patterned encaustic tile floor", {"en": "Encaustic tile floor", "es": "Suelo hidráulico"}),
    "walls_white": Option("white painted walls", {"en": "White walls", "es": "Paredes blancas"}),
    "walls_lime": Option("textured lime plaster walls", {"en": "Lime plaster walls", "es": "Paredes de cal"}),
    "walls_brick": Option("exposed brick wall", {"en": "Exposed brick", "es": "Ladrillo visto"}),
    "counter_marble": Option("marble countertop", {"en": "Marble countertop", "es": "Encimera de mármol"}),
    "counter_wood": Option("solid wood countertop", {"en": "Wood countertop", "es": "Encimera de madera"}),
    "textile_linen": Option("linen upholstery", {"en": "Linen upholstery", "es": "Tapicería de lino"}),
    "metal_black": Option("matte black metal details", {"en": "Black metal details", "es": "Detalles en metal negro"}),
}

LIGHTING: dict[str, Option] = {
    "morning": Option("soft natural morning light through the windows", {"en": "Morning light", "es": "Luz de mañana"}),
    "golden_hour": Option("warm golden hour sunlight, long soft shadows", {"en": "Golden hour", "es": "Atardecer"}),
    "overcast": Option("diffused overcast daylight, even soft light", {"en": "Overcast", "es": "Nublado"}),
    "evening": Option("evening ambience, warm interior lamps, cozy lighting", {"en": "Evening", "es": "Noche"}),
}

QUALITY = "photorealistic interior design photography, professional architectural photo, high detail, 8k"
CAMERA = "wide angle lens, eye level, sharp focus"

NEGATIVE = (
    "blurry, low quality, distorted perspective, warped walls, bent lines, extra furniture, "
    "people, text, watermark, logo, cartoon, sketch, drawing, lowres, oversaturated"
)

MAX_DETAILS = 300


class InvalidBrief(ValueError):
    """The brief has an unknown option; the message names it and lists the valid values."""


@dataclass
class Brief:
    room: str
    style: str
    lighting: str = "morning"
    materials: list[str] = field(default_factory=list)
    details: str = ""  # optional free text, in English

    def validate(self) -> None:
        _check("room", self.room, ROOMS)
        _check("style", self.style, STYLES)
        _check("lighting", self.lighting, LIGHTING)
        for m in self.materials:
            _check("material", m, MATERIALS)
        if len(self.details) > MAX_DETAILS:
            raise InvalidBrief(f"Details cannot exceed {MAX_DETAILS} characters.")


def _check(name: str, value: str, options: dict[str, Option]) -> None:
    if value not in options:
        raise InvalidBrief(f"Unknown {name} '{value}'. Valid values: {', '.join(sorted(options))}.")


def build_prompt(brief: Brief) -> tuple[str, str]:
    """Return (positive, negative). Order matters: earlier terms weigh more in the model."""
    brief.validate()
    parts = [
        QUALITY,
        ROOMS[brief.room].prompt,
        STYLES[brief.style].prompt,
        *[MATERIALS[m].prompt for m in dict.fromkeys(brief.materials)],  # de-duplicated, order kept
        LIGHTING[brief.lighting].prompt,
    ]
    if brief.details.strip():
        parts.append(brief.details.strip())
    parts.append(CAMERA)
    return ", ".join(parts), NEGATIVE


def catalog(locale: str = "en") -> dict[str, list[dict[str, str]]]:
    """Options with labels in one locale, ready to send to the web app. Falls back to English."""
    def items(options: dict[str, Option]) -> list[dict[str, str]]:
        return [{"id": k, "label": o.label.get(locale, o.label["en"])} for k, o in options.items()]

    return {"rooms": items(ROOMS), "styles": items(STYLES), "materials": items(MATERIALS), "lighting": items(LIGHTING)}
