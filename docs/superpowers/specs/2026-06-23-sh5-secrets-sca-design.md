# SH-5 — Secrets management + dependency/SCA CI gate (design spec)

**Date:** 2026-06-23 · **Status:** built autonomously (user AFK, "continue building") — decisions documented for review.
**Sub-project:** Security Hardening track, SH-5 (final coding phase). Compliance scoping remains a separate non-code track.

## Goal
Add supply-chain + secret-leak defenses to the merge gate, and document secret handling: (1) a dependency/SCA gate, (2) secret scanning, (3) automated dependency updates, (4) CI least-privilege, (5) a SECURITY.md policy.

## Findings (grounding, 2026-06-23)
- **No real secrets committed.** `git grep` for `eyJ…` JWTs / `sk_…` / committed service_role values → none. The only "secret-ish" tracked string is `const password = 'Test-pass-123456'` in integration tests (a test fixture). `.env` / `.env.local` are gitignored.
- **`npm audit`:** 5 vulns total (3 moderate, 1 high, 1 critical) — **all in dev/build tooling** (`vite`/`vitest`/`esbuild`/`vite-node`). **Production-only audit (`npm audit --omit=dev`) = 0 vulns.** Runtime deps are `express`, `@supabase/supabase-js`, `express-rate-limit`, `react`, `react-dom` — all clean.
- CI = a single Node-20 `test` job; no `permissions:` block; no secret scan, SCA, or Dependabot.

## Decisions
1. **SCA gate = production dependencies only, fail on high+critical.** Add a CI step: `npm audit --omit=dev --audit-level=high`. Rationale: the deployed attack surface is the *runtime* deps (the dev toolchain — vite/vitest/esbuild — ships in neither the server `dist` nor the web bundle's runtime). This blocks real production-dep vulns (currently passes: 0 prod high/critical) without a false-red on un-deployable dev-tooling CVEs. Dev-tooling vulns are tracked by Dependabot (fixing them = risky major bumps of vite/vitest, out of scope here).
2. **Secret scanning = gitleaks** (pinned binary downloaded from the official GitHub release + SHA256-verified, run as a CI step — deliberately NOT `gitleaks/gitleaks-action`, which requires a paid license for GitHub Organization repos) on every PR + push to main. A `.gitleaks.toml` extends the default rules with an allowlist for the test password and `.env.example` placeholders (no real secrets exist, but this prevents future leaks). Fails CI on any finding.
3. **Dependabot** (`.github/dependabot.yml`) — weekly update PRs for the npm ecosystem (root, covers workspaces) + github-actions. Catches the dev-tooling vulns and keeps actions current.
4. **CI least-privilege** — add `permissions: contents: read` to the workflow (the default `GITHUB_TOKEN` is otherwise broadly scoped); align `setup-node` to **22** to match `engines.node >= 22` (added in #10) so CI runs the same major as prod.
5. **SECURITY.md** — secret-handling policy (env vars only; never commit secrets; `service_role` key server-side only, never in the web bundle; rotate before prod; the local Supabase demo keys must never reach prod), the SCA/secret-scan approach, and a vulnerability-reporting line.

## Out of scope (follow-ups)
Paid SCA (Snyk/Socket); runtime secret manager (Vault/Doppler) — env-var-based for now; SBOM/artifact signing; fixing the dev-tooling vite/vitest vulns (Dependabot will surface; major-bump decision later); GitHub secret-scanning/push-protection settings (repo-admin UI, not code).

## Testing / verification
- Locally: `npm audit --omit=dev --audit-level=high` exits 0 (verified). YAML validity. `npm test` + builds still green (unchanged code).
- The real gate is **CI on the PR**: the new SCA + gitleaks steps must pass; the existing test/build/pgTAP gates must stay green. CI `setup-node@22` must still run `npm ci`/tests cleanly.
