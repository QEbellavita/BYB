# BYB Platform — Deployment (Railway + Supabase Cloud)

The app is three pieces: a **web** service (React/Vite SPA), a **server** service
(Express API), and a **Supabase Cloud** project (Postgres + Auth + RLS). Local dev
uses a local Supabase stack; production needs a hosted Supabase project.

Repo: `github.com/QEbellavita/BYB` · monorepo with npm workspaces (`web`, `server`).

---

## 0. Gating dependency — Supabase Cloud (do this first)

The deployed backend cannot use the local Supabase (`127.0.0.1:54331`). Create a
hosted project and apply the migrations:

```bash
# one-time
supabase login
supabase link --project-ref <your-cloud-project-ref>
supabase db push        # applies supabase/migrations/* to the cloud DB
```

Then from the Supabase dashboard (Project Settings → API) copy:
- **Project URL** → used as `SUPABASE_URL` and `VITE_SUPABASE_URL`
- **anon public key** → `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (server only — never ship to the browser)

Set the cloud project's Auth redirect/site URL to the web service URL once known
(Auth → URL Configuration).

---

## 1. Server service (Express API)

- **Runtime requirement: Node 22+.** `@supabase/supabase-js` eagerly initialises its
  realtime client, which throws on Node 20 (`Node.js 20 detected without native
  WebSocket support`). The server builds a Supabase client on every request, so on
  Node ≤21 it crashes at runtime. This is pinned via `engines.node: ">=22"` (root +
  `server/package.json`) and `.nvmrc` — Railway/Nixpacks reads `engines.node` to pick
  the Node version, so no manual setting is needed. Don't downgrade it.
- **Config:** `server/railway.json` — `buildCommand: npm run build --workspace server`,
  `startCommand: npm run start --workspace server` (which runs `node dist/index.js`).
- **Railway service settings:** Root Directory = repo root; Config-as-code path =
  `server/railway.json`. (Root = repo root so npm-workspace install resolves.)
- **Environment variables:**
  | var | value |
  |-----|-------|
  | `SUPABASE_URL` | Supabase Cloud project URL |
  | `SUPABASE_ANON_KEY` | anon public key |
  | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
  | `CORS_ORIGIN` | the web service's public URL (e.g. `https://byb-web.up.railway.app`) |
  | `PORT` | set automatically by Railway — do not hardcode |
- Health check path: `/health` (returns `{"status":"ok"}`).

## 2. Web service (Vite SPA)

- **Config:** `railway.json` (repo root) — `buildCommand: npm run build --workspace web`,
  `startCommand: npm run start --workspace web` (`vite preview --host 0.0.0.0 --port $PORT`).
- **Railway service settings:** Root Directory = repo root; Config path = `railway.json`.
- **Environment variables** (note: `VITE_*` are **build-time** — a change requires a redeploy/rebuild):
  | var | value |
  |-----|-------|
  | `VITE_SUPABASE_URL` | Supabase Cloud project URL |
  | `VITE_SUPABASE_ANON_KEY` | anon public key |
  | `VITE_API_URL` | the server service's public URL (e.g. `https://byb-api.up.railway.app`) |

## 3. Wiring order (the two services reference each other)

1. Create both services from the GitHub repo.
2. Deploy the **server** first; note its public URL.
3. Set the **web** `VITE_API_URL` to the server URL; deploy web; note its URL.
4. Set the **server** `CORS_ORIGIN` to the web URL; redeploy the server.
5. Set Supabase Auth site URL to the web URL.

## 4. Auto-deploy

Connect each Railway service to the GitHub repo and the `main` branch. After that,
`git push origin main` redeploys both. (Until then, `railway up` does a manual deploy
from local files.)

---

## Notes / follow-ups

- `vite preview` is a minimal static server — fine to start; for scale, serve the
  built `web/dist` from a CDN/static host and keep only the API on Railway.
- The server uses the Supabase **service-role** client for onboarding writes;
  tenant isolation is enforced at the app layer (auth + admin gate + per-write
  workspace-ownership checks), not by RLS as the last line. See the SP-2 ledger
  follow-ups before relying on multi-tenant hardening.
- No emails are sent in production yet — invite delivery uses a console transport
  (`createEmailService`); wire a real transport (and set the from/domain) before
  inviting real users.
