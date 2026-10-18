# The Lantern · Landing Page

Static landing page for The Lantern (Vite + TypeScript, no framework, same stack as `frontend/`).
It imports the app's own `tokens.css`, `components.css` and orb (`siri_orb.ts`) from `../frontend`,
so colors, fonts and the feature demos stay identical to the app.

```bash
cd landing
npm ci
npm run dev       # http://localhost:5174
npm run build     # outputs dist/ (index.html + demo.html)
```

## Pages

- `/`: the landing page.
- `/demo`: the wake-up page. Every "Try the Demo" button goes here (through the page transition).
  It polls the backend's `GET /ready` while the Render instance boots, shows the real start-up
  steps, then opens the app.
- `/app/`: the app itself (`frontend/`), built into `dist/app` by `npm run build`. It calls the
  backend at `VITE_API_URL`: REST with CORS, WebSockets directly.

## Deploy: site on Vercel, backend on Render

```
Vercel (static)                          Render (Docker, render.yaml)
  /        landing        ── GET /ready ──▶  FastAPI
  /demo    wake-up page                      ├─ /ws/realtime  AssemblyAI → model → voice
  /app/    the app        ── REST + WS ───▶  ├─ /ws/ops, /menu, /floor, /api/kitchen/…
                                             └─ SQLite, demo rate limits
```

1. **Render (backend).** New → Blueprint → this repo; `render.yaml` creates the `lantern` service.
   Fill in `GEMINI_API_KEY`, `CARTESIA_API_KEY`, `ASSEMBLYAI_API_KEY`. Note the URL
   (e.g. `https://lantern.onrender.com`) and check `GET /ready`.
2. **Vercel (landing + app).** Add New → Project → this repo.
   - Root Directory: `landing`. Keep "Include files outside the Root Directory" on (the build
     reads `../frontend`).
   - Environment variable: `VITE_API_URL` = the Render URL from step 1.
   - Deploy. `vercel.json` already sets the build, output and caching.
3. **Lock CORS.** On Render set `CORS_ALLOW_ORIGINS` to the Vercel URL(s), comma-separated, and
   redeploy.

The Render image still serves its own copy of the app at its root, which is handy for debugging.

## Public demo limits (backend)

`backend/app/services/rate_limit.py`, enabled with `RATE_LIMIT_ENABLED=true` (off locally):

| Limit | Default | Env |
|---|---|---|
| Voice sessions per IP per day | 8 | `DEMO_SESSIONS_PER_IP_PER_DAY` |
| Guest turns per IP per day | 80 | `DEMO_TURNS_PER_IP_PER_DAY` |
| Guest turns per day, all visitors | 2,000 | `DEMO_TURNS_PER_DAY` |
| Sessions open at once | 4 | `DEMO_MAX_CONCURRENT_SESSIONS` |
| Session length | 300 s | `DEMO_MAX_SESSION_SECONDS` |
| Turns per session | 30 | `DEMO_MAX_TURNS_PER_SESSION` |
| Staff writes per IP per minute | 30 | `DEMO_WRITES_PER_IP_PER_MINUTE` |
| Typed request length | 280 chars | `DEMO_MAX_TRANSCRIPT_CHARS` |

Days reset at UTC midnight. Over a limit, the socket gets `{"type": "rate_limited", ...}` and the
app shows the message; staff writes get HTTP 429. Counts live in memory (single instance).

## Media

- `public/media/lantern-teaser-1080p.mp4`: the official teaser for the web (1080p H.264 + AAC,
  ~34 MB, `faststart`), with the "The Latern" title typo corrected to "The Lantern" in the intro
  (≈11–14 s) and the outro (≈183–185 s). The corrected 4K master is
  `_media/The Lantern_Teaser_Official_fixed.mp4`, kept out of git.
- `public/audio/demo/*.mp3`: feature-demo audio from `scripts/generate_demo_audio.py`
  (`.venv/bin/python landing/scripts/generate_demo_audio.py`). The waiter uses the product's Kokoro
  voices and says the replies verbatim; the "one moment" clips are the app's real fillers.
- `public/shots/dining-welcome.jpg`: the app's Dining welcome screen (hero).
- `public/team/*`: portraits cropped from the presentation's "Our Team" slide.
- `public/logos/*`: official marks from each project's own site: AssemblyAI, lablab.ai, NativelyAI,
  Ollama, SQLite, FastAPI, Cartesia, Gemini; Qwen and Kokoro (hexgrad) use their Hugging Face avatars.
