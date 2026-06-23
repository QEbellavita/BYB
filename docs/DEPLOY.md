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
  | `NODE_ENV` | `production` — **required**: enables HSTS and the strict-CORS production behaviour (without it, HSTS is not sent) |
  | `SUPABASE_URL` | Supabase Cloud project URL |
  | `SUPABASE_ANON_KEY` | anon public key |
  | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server only — never on the web service) |
  | `CORS_ORIGIN` | the web service's public URL, e.g. `https://byb-web-production.up.railway.app` — **required in prod** (the server warns at startup if unset/`*`). Comma-separate for multiple origins. |
  | `PORT` | set automatically by Railway — do not hardcode |
- **Optional tuning** (sane defaults, override only if needed): `RATE_LIMIT_MAX` (100), `RATE_LIMIT_STRICT_MAX` (10), `RATE_LIMIT_WINDOW_MS` (60000), `BODY_LIMIT` (`64kb`), `TRUST_PROXY` (`1` — correct for Railway's single proxy; don't raise it or clients can spoof `X-Forwarded-For` to evade rate limits).
- Health check path: `/health` (returns `{"status":"ok"}`).

### MFA (SH-4) — enable on the Cloud project
`supabase db push` applies **migrations only**, not `config.toml`. The local `[auth.mfa]` TOTP enablement is therefore NOT carried to the Cloud project — enable it there separately, either:
- in the **Supabase dashboard** → Authentication → Sign In / Providers → **Multi-Factor Authentication** → enable **TOTP (Authenticator app)**, or
- run `supabase config push` (pushes `config.toml`, incl. `[auth.mfa]` + refresh-token rotation) against the linked Cloud project.

Without this, enrollment works in the UI but the Cloud project may reject TOTP factors. (Set the Auth **Site URL** to the web service URL while you're in the dashboard.)

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

## MFA recovery (operational)

If a user is locked out because they have lost access to their TOTP authenticator app:

1. An operator with **service-role** or Supabase dashboard access navigates to:
   **Supabase dashboard → Authentication → Users → [select user] → MFA factors → Remove factor**
   (or uses the `auth.mfa_factors` table / `auth.admin` API with a service-role key to delete the row for that user's factor.)
2. The user can then sign in at AAL1 (password only) and re-enroll a new TOTP device.

**Notes:**
- Only operators with service-role access can perform this reset — there is no self-service path in v1.
- Self-service recovery codes are a tracked follow-up (would require custom hashed-code storage + verify flow; out of scope for SH-4).
- Audit the reset manually in the Supabase dashboard logs or via the BYB audit log if a `mfa.factor_removed` event is added.

---

## Notes / follow-ups

- `vite preview` is a minimal static server — fine to start; for scale, serve the
  built `web/dist` from a CDN/static host and keep only the API on Railway.
- Tenant isolation: all user-scoped reads/writes (risk/complaints/improvements/Hub
  **and onboarding** session/invite/completion) go through a per-request user-JWT
  client, so Postgres **RLS is the last line of defense** (SH-2 + SH-2.1). The
  service-role client is used only for the event outbox/subscriber and the
  `workspace_features` config flag.
- No emails are sent in production yet — invite delivery uses a console transport
  (`createEmailService`); wire a real transport (and set the from/domain) before
  inviting real users.
