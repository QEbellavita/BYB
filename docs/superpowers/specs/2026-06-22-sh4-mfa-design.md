# SH-4 — MFA (Supabase native TOTP) design spec

**Date:** 2026-06-22 · **Status:** approved (brainstorm) → ready for plan
**Sub-project:** Security Hardening track, SH-4 (after SH-2/2.1, SH-1, SH-3).

## Goal
TOTP MFA via Supabase Auth. Admins and sensitive actions require an MFA-verified (AAL2) session; full web UX (enroll / challenge-on-login / manage) so it's usable end-to-end.

## Decisions (brainstorm 2026-06-22)
1. **Supabase native TOTP** (not custom): enroll/challenge/verify run SPA→Supabase; JWT carries `aal` (aal1=password, aal2=MFA). Server enforces AAL2. No custom TOTP crypto.
2. **Scope = admins + sensitive actions require AAL2.** Regular staff may use the app at aal1 and optionally enroll. "Admins must have MFA" is enforced *implicitly* — admin/sensitive routes are AAL2-gated, so an admin with no factor can't perform admin actions until they enroll.
3. **Full UX:** server AAL2 enforcement + web enroll/challenge/manage screens.
4. **Recovery (v1):** operational reset — a service-role admin path clears a locked-out user's factor so they can re-enroll; document it. Self-service recovery codes deferred (would require custom hashed-code storage + verify flow).
5. **Session:** keep `jwt_expiry = 3600`; enable refresh-token rotation.

## Current state (grounding)
- `require-auth.ts` validates the JWT via `getUser(token)` and attaches `req.user`/`req.accessToken` — it does NOT read `aal`. No MFA wiring anywhere.
- `supabase/config.toml [auth]`: `jwt_expiry=3600`, no `[auth.mfa]`.
- Web: `web/src/{App.tsx, Login.tsx, Shell.tsx, supabase.ts, api.ts}`, pages under `web/src/app/`, onboarding under `web/src/onboarding/`. Supabase client in `web/src/supabase.ts`.
- SH-3's audit service is available for `mfa.required` denial events.

## Components

### A. Config — `supabase/config.toml`
Add:
```
[auth.mfa]
max_enrolled_factors = 10
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```
Enable refresh-token rotation under `[auth]` (e.g. `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`). Keep `jwt_expiry = 3600`. (Implementer: confirm the exact config keys for the installed Supabase CLI version against `supabase/config.toml` schema; adjust key names if the CLI differs.)

### B. Server — AAL2 enforcement
- **`require-auth.ts`:** after `getUser` validates the token, decode the validated JWT payload (middle segment, base64url → JSON) and read the `aal` claim; attach `req.aal: 'aal1' | 'aal2' | null`. Signature is already verified by `getUser`, so reading claims is safe. Add `aal` to the `Express.Request` augmentation.
- **New `server/src/middleware/require-aal2.ts`:** `requireAAL2(opts?: { audit?: AuditRecorder }): RequestHandler` → if `req.aal !== 'aal2'`, record `mfa.required` (actor=req.user?.id, workspace_id=req.workspaceId, metadata ip/route/method/requestId) and return `403 { error: 'MFA required', code: 'mfa_required' }`. Else `next()`.
- **Apply** `requireAAL2()` after `requireWorkspaceAdmin` on admin/sensitive routes: onboarding admin mutations (`/finish`, `/retry/:id`, and the step writes), invite creation, and `GET /api/audit`. Thread the audit recorder (like SH-3). (Read routes like `/session` may stay aal1; gate the *mutations* + the audit read.)

### C. Web — MFA UX (React)
- **`web/src/mfa/` module:** an MFA API wrapper over `supabase.auth.mfa` (enroll/challenge/verify/listFactors/unenroll/getAuthenticatorAssuranceLevel) + components.
- **Enroll screen** (in a Security/Settings area, reachable from the Shell): start enroll → render the returned TOTP QR (`totp.qr_code`) + manual secret → input 6-digit code → challenge+verify → on success, session is AAL2; show "MFA enabled".
- **Challenge-on-login:** in the auth gate (App.tsx / Login flow), after sign-in call `getAuthenticatorAssuranceLevel()`; if `currentLevel==='aal1' && nextLevel==='aal2'` (factor exists, not challenged) → show a challenge screen (enter code → challenge+verify) before reaching the Shell.
- **Manage:** list factors + disable (unenroll requires AAL2).
- **Gating interception:** in the shared API client (`web/src/api.ts`), when a response is `403` with `code:'mfa_required'`, surface an "MFA required" state that routes the user into enroll (if no factor) or challenge (if factor exists). Minimal: show a clear message + link to the MFA screen.

### D. Recovery (v1, documented only)
Add a short doc section (DEPLOY/OWNER guide or a SECURITY note) describing the operational reset: an operator with service-role access deletes the user's factor (`auth.admin` / `auth.mfa_factors`) so they can re-enroll. Self-service recovery codes = tracked follow-up.

## Testing
- **Server:** `require-auth` attaches `aal` from a crafted token (aal1 vs aal2); `requireAAL2` returns 403+`mfa_required`+audit when aal1, calls `next()` when aal2; applied routes reject aal1 admins. Supertest with hand-built JWTs (sign with the local JWT secret or stub `getUser` + inject token claims via the decode path — prefer injecting a token whose payload has the aal claim).
- **Web:** enroll renders QR and verifies (mocked `supabase.auth.mfa`); challenge-on-login prompts when aal1→aal2 and elevates; api client surfaces `mfa_required`. Testing Library + mocked supabase client.
- **Integration (best-effort):** with `[auth.mfa]` enabled locally, an enroll+verify elevates a session to aal2 and an aal2 token passes a gated route while an aal1 token gets 403. (If local MFA enablement is flaky, document and rely on unit coverage.)
- Regression: full suite green (SH-3 baseline: 253 server + 78 web + 21 integration).

## Base branch / sequencing
Stacked on PR #12 (`sh-3-audit-log`). Likely **no DB migration** (Supabase MFA uses the managed `auth` schema). Merge order: #9 → #11 → #12 → this.

## Out of scope (follow-ups)
Self-service recovery codes; per-workspace MFA policy; requiring MFA for ALL users; WebAuthn/passkeys; step-up re-auth with a freshness window (beyond aal2 presence).
