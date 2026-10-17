# The Lantern · Landing Page

Static landing page for The Lantern (Vite + TypeScript, no framework, same stack as `frontend/`).
Colors and fonts come from the app's design tokens (`src/styles/tokens.css` is a copy of
`frontend/src/styles/tokens.css`; keep the two in sync).

```bash
cd landing
npm ci
npm run dev       # http://localhost:5174
npm run build     # outputs dist/
```

## Deploy

- **Landing → Vercel.** Import the repo, set **Root Directory** to `landing`. `vercel.json` sets the
  Vite build. Add the environment variable `VITE_APP_URL` with the Render URL of the live app.
- **Live app → Render.** The root `Dockerfile` + `render.yaml` serve the backend and the app.
  Every "Try the Demo" button links to `VITE_APP_URL` (default `https://lantern.onrender.com`).

## Media

- `public/media/lantern-teaser-1080p.mp4`: the official teaser re-encoded for the web
  (1080p H.264 + AAC, ~34 MB, `faststart`). The 4K master stays out of git.
- `public/media/lantern-teaser-poster.jpg`: the team's cover image, used as poster and OG image.
- `public/team/*`: portraits cropped from the presentation's "Our Team" slide.
- `public/shots/*`: the app's Dining, Management and Logs screenshots (`docs/assets/`).
