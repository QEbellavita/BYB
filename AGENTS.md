# AGENTS.md — BYB Platform

Instructions for any AI agent (Codex, Claude Code, etc.) working in this repo.

## What this is
BYB ("Build Your Business") Platform — a **Context-Driven Operating System** for AU/NZ
businesses. A business defines how it operates ONCE in a **Context Hub** (source of truth);
every modular feature reads from and adapts to it. Built **for a client**: this is a clean,
standalone, independently-deployable product. It must NOT depend on the author's other repos.

- **Architecture spec:** `docs/superpowers/specs/2026-06-21-byb-platform-architecture-design.md` (read this first)
- **Current sub-project plan:** `docs/superpowers/plans/2026-06-21-sp0-foundation-platform-spine.md`
- **Latest handoff / status:** `docs/HANDOFF-2026-06-21.md` (read this to know what's done and what's next)
- **Reuse reference (donor code on this machine):** `/Users/belindaswitzer/BYB-REUSE-PLAN.md`

## Stack
- **Backend:** Node 20+ / Express 4 / TypeScript (strict, ESM) — `server/`
- **Frontend:** React 18 + Vite + TypeScript — `web/`
- **Data:** Supabase (Postgres + Auth + RLS + Storage + Realtime), migrations in `supabase/`
- **Tests:** Vitest + Supertest (server), Vitest + Testing Library (web), pgTAP (database)
- npm **workspaces** monorepo (`server`, `web`; `supabase/` at root)

## How to run / test
```bash
npm install                 # once (registry reachable)
# Supabase local stack — on THIS machine (Colima) it needs excludes:
supabase start --exclude vector,mailpit,storage-api,logflare
# On a clean machine / CI, plain `supabase start` works (see .github/workflows/ci.yml).
npm run db:reset            # apply all migrations
npm run db:test             # pgTAP RLS gate  (must be GREEN)
npm test                    # server + web unit tests (must be GREEN)
npm run dev:server          # Express on :3001
npm run dev:web             # Vite dev server
```
- **Dedicated Supabase ports:** api `54331`, db `54332`, studio `54333` (NOT the 54321-3
  defaults) so BYB coexists with other local Supabase projects. `SUPABASE_URL` / `VITE_SUPABASE_URL`
  use `127.0.0.1:54331`. Copy `.env.example` → `.env` and fill keys from `supabase start` output.
- A separate Supabase project named **Cinder** runs on this machine on the default ports —
  do NOT stop, reset, or touch it. It is an unrelated workload (and a read-only code donor).

## Non-negotiable conventions
1. **RLS on every tenant table**, keyed on `public.is_workspace_member(workspace_id)`. Every
   tenant table ships with a **passing pgTAP cross-tenant isolation test** before merge. This is
   the security spine of a compliance product — never relax it.
2. **Context-driven rule:** feature modules read/write business logic ONLY through the Context
   Hub's typed repositories (Context Hub is SP-1, not built yet). Modules store their own feature
   data + references to Hub entities — never a copy of business rules/obligations/processes.
3. **Postgres functions** that touch membership are `SECURITY DEFINER set search_path = public`,
   guard `auth.uid()`, and (for invites) bind to the invited email.
4. **Server queries that must respect RLS** use `userScopedClient(config, accessToken)` (carries
   the user's JWT) — NOT the anon or service client.
5. **TypeScript strict + ESM** — local imports use `.js` extensions (NodeNext). No SQLite.
6. **Conventional commits.** Branch per sub-project; do not commit straight to `main` without review.
7. **Reuse = port cleaned copies** of donor code into this repo. No runtime dependency on
   belcrm / Quantara / ncc / Cinder. BYB is independent of the Quantara emotion/biometric stack.

## Roadmap (each sub-project = its own spec→plan→build cycle)
SP-0 Foundation ✅ (done) → **SP-1 Context Hub (next, the keystone)** → SP-2 Onboarding wizard
→ SP-3 Risk Register + Complaints → SP-4 IPL + Document Library → SP-5 Trackers + Projects
→ SP-6 Onboarding & Train → (v1 ships) → SP-7 ANZSIC obligations + Monitoring agent
→ SP-8 Insights & Reporting → SP-9 Product Hub → SP-10 Finance (Xero/MYOB + Stripe AU).
Build order and dependencies are in §10 of the architecture spec.
