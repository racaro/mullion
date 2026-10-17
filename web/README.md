# Step 2 · Foundation: web app, sign-in, D1, R2, queue

One Cloudflare Worker serves the pages, the API and Google sign-in, and consumes the render queue. The queue consumer sends each job to ComfyUI through Cloudflare Tunnel, protected by Cloudflare Access.

```
Browser → Worker (public/ + /api + /auth) → D1 (users, sessions, renders) / R2 (sketches, masks, renders)
                     ↓ Queue mullion-renders (one job at a time)
              Worker queue consumer → Cloudflare Tunnel + Access → ComfyUI
```

## Run it locally

Needs Node 20 or newer and ComfyUI running (step 1). Wrangler simulates D1, R2 and the queue on your machine.

```bash
npm install
cp .dev.vars.example .dev.vars        # points at ComfyUI on 127.0.0.1:8188
npm run db:migrate:local
npm run dev                           # http://localhost:8787
```

Open **http://localhost:8787/auth/dev** to sign in without Google (only works on localhost with `DEV_LOGIN=true`). To try real Google sign-in, fill `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.dev.vars` (see below).

Tests: `npm test` and `npm run typecheck`.

## Deploy

Run once, logged in with `npx wrangler login`:

1. **Database, storage, queue**
   ```bash
   npx wrangler d1 create mullion          # copy the database_id into wrangler.jsonc
   npx wrangler r2 bucket create mullion
   npx wrangler queues create mullion-renders
   npm run db:migrate:remote
   ```
2. **Google sign-in.** In Google Cloud Console → APIs & Services → Credentials, create an OAuth client of type *Web application* with these redirect URIs: `https://<your domain>/auth/google/callback` and `http://localhost:8787/auth/google/callback`. Then:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
3. **Tunnel to ComfyUI** (on the Mac that runs ComfyUI, with a domain on Cloudflare):
   ```bash
   brew install cloudflared
   cloudflared tunnel login
   cloudflared tunnel create mullion-comfy
   cloudflared tunnel route dns mullion-comfy comfy.<your domain>
   cloudflared tunnel run --url http://127.0.0.1:8188 mullion-comfy
   ```
   Set `COMFY_URL` in `wrangler.jsonc` to `https://comfy.<your domain>`.
4. **Access in front of the Tunnel.** In Cloudflare Zero Trust → Access: create a *service token*, then a *self-hosted application* for `comfy.<your domain>` with one policy whose action is **Service Auth** and that includes that token. Without it, anyone who finds the hostname can use your ComfyUI.
   ```bash
   npx wrangler secret put CF_ACCESS_CLIENT_ID
   npx wrangler secret put CF_ACCESS_CLIENT_SECRET
   ```
5. `npm run deploy`

## How a render flows

1. `POST /api/renders` (multipart: `sketch`, optional `mask`, `brief` as JSON) validates the brief, stores the images in R2, inserts a `queued` row in D1 and sends `{renderId}` to the queue.
2. The consumer marks it `running`, uploads the sketch and mask to ComfyUI, builds the prompt and workflow (same as the engine: ControlNet lineart at 0.8 by default), waits for the image and stores it in R2 as `renders/<id>.png`.
3. If ComfyUI fails, the job is retried twice (30 s, then 60 s); after that the render is `failed` with the reason.
4. The page polls `GET /api/renders` every 5 s while something is pending.

## What is here

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Routes and the queue handler |
| `src/auth.ts` | Google sign-in (code flow + PKCE), sessions in D1 (only a hash of the cookie is stored) |
| `src/api.ts` | `/api/catalog`, `/api/me`, `/api/renders` |
| `src/queue.ts` | Queue consumer: ComfyUI → R2 |
| `src/comfy.ts` | ComfyUI client, port of `engine/client.py`, with the Access service token |
| `src/engine.ts` | Port of `engine/brief.py` and `engine/workflow.py` |
| `src/generated/engine.json` | Brief options, written by `engine/export.py` — do not edit |
| `public/` | The web app (no build step); strings in `public/i18n/<locale>.json` |
| `migrations/` | D1 schema |
| `test/` | Port checked against reference cases from the Python engine, ComfyUI client |

When you change options in `engine/brief.py` or the workflow, run `python3 engine/export.py`; the engine tests fail until you do.
