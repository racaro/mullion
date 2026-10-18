# Mullion

**From sketch to render.** Upload a sketch of a space, let an assistant help you describe it, and get photorealistic views that keep your layout.

For anyone who draws spaces: architects, interior designers, contractors, kitchen and joinery studios.

| Locale | Tagline |
| --- | --- |
| English (default) | Sketch it, see it. |
| Spanish | Si no lo veo, lo creo. |

## Architecture

```
Browser → Cloudflare Worker (web app + API + Google sign-in) → D1 / R2
                     ↓ Queue
              Cloudflare Tunnel → ComfyUI (Mac mini for the pilot, cloud GPU later)
```

## Languages

The codebase, docs and API are in English. The web app ships in **English and Spanish**: English is the default, and the locale comes from the user's choice, falling back to the browser's language. Option labels for the room brief live in both languages in `engine/brief.py` and reach the web app through `engine/export.py`; the web app keeps its own strings in one file per locale (`web/public/i18n/`).

## Status

| Step | Folder | Status |
| --- | --- | --- |
| 1. Validate the render engine | `engine/` | Done: ControlNet lineart at 0.8 keeps the layout; erase mask removes people |
| 2. Foundation: web app, sign-in, D1, R2, queue | `web/` | Runs locally; deploy pending |
| 3. Prompt assistant (chat) | `web/` | Pending |
| 4. Product and pilot | | Pending |
