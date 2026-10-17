# Mullion

**From sketch to render.** Upload a sketch of a space, let an assistant help you describe it, and get photorealistic views that keep your layout.

For anyone who draws spaces: architects, interior designers, contractors, kitchen and joinery studios.

| Locale | Tagline |
| --- | --- |
| English (default) | Sketch it, see it. |
| Spanish | Si lo veo, lo creo. |

## Architecture

```
Browser → Cloudflare Worker (web app + API + Google sign-in) → D1 / R2
                     ↓ Queue
              Cloudflare Tunnel → ComfyUI (Mac mini for the pilot, cloud GPU later)
```

## Languages

The codebase, docs and API are in English. The web app ships in **English and Spanish**: English is the default, and the locale comes from the user's choice, falling back to the browser's language. Option labels for the room brief already exist in both languages (`engine/brief.py`, `catalog(locale)`); the web app will keep its own strings in one file per locale.

## Status

| Step | Folder | Status |
| --- | --- | --- |
| 1. Validate the render engine | `engine/` | Ready to run on the Mac |
| 2. Foundation: web app, sign-in, D1, R2, queue | `web/` | Waiting on step 1 |
| 3. Prompt assistant (chat) | `web/` | Pending |
| 4. Product and pilot | | Pending |
