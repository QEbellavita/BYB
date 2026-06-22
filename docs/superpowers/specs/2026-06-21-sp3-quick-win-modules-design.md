# SP-3 — Quick-Win Modules: Risk Register, Complaints, Improvements (Design)

**Status:** approved (brainstorm 2026-06-21)
**Depends on:** SP-1 (Context Hub: entities, `context_links`, `context_events` outbox + subscriber registry, RLS spine) and SP-0 (module loader, Feature Registry, RBAC, RLS/pgTAP gate). Parallel to SP-2 in the roadmap; built after it.
**Branch / worktree:** `sp-3-modules` in `/private/tmp/byb-sp3` (shared local Supabase stack).

## Goal

Build the first three **feature modules** on top of the Context Hub, proving the
module pattern (each module owns its operational data + *references* Hub entities,
is gated per-workspace by the Feature Registry, and is RLS-isolated) and the
**event bus** (SP-1's `context_events` outbox + subscriber registry). The three
modules are deliberately "quick wins" — lite, CRUD-plus-workflow surfaces — chosen
to validate the pattern, not to be feature-complete.

Modules:
- **Risk Register (J)** — 5×5 likelihood×impact register of operational risks.
- **Complaints Register (E)** — intake → route → resolve complaint cases.
- **Improvements (the "Improvement agent")** — a register of improvement items
  that are *auto-suggested* from deterministic rules over risk/complaint activity
  (event-driven) **and** entered manually, with a unified workflow.

## Global Constraints (binding — copy into the implementation plan)

- BYB is standalone. No Quantara / Neural Workflow / biometric / ML / multifractal
  dependencies. No LLM/AI use (the AI gateway is deferred to SP-4) — all
  "intelligence" in SP-3 is **deterministic**.
- Each module owns ONLY its own tables. It must NEVER write business context
  (rules / obligations / processes / frameworks) to the Hub, and must NEVER read
  another module's tables. Cross-references to Hub entities go through
  `context_links` (the SP-1 link store); the one exception is a direct FK from a
  risk entry to its `risk_frameworks` Hub row.
- RLS on every new tenant table, keyed on `public.is_workspace_member(workspace_id)`,
  with a passing pgTAP cross-tenant isolation test before merge. This is the
  security spine — never relaxed. Explicit table grants to `authenticated` /
  `service_role` (per migration 0013 — new tables need the same grants).
- RLS-sensitive server queries use `userScopedClient` (user JWT). The improvement
  subscriber and event dispatch run server-side and may use the service-role
  client (they react to already-authorized writes); document this like SP-2.
- Each module is gated by the Feature Registry (`registerModules`) and mounted at
  `/api/m/<module>`; routes use the established `requireAuth` / `authedWorkspaceRoute`
  / `requirePermission` middleware.
- TypeScript strict + ESM; local imports use `.js` extensions (server). Web follows
  the existing design-system (tokens/panels) and import conventions; `web/tsconfig.json`
  has `noEmit` — no stray `.js`.
- Test-first (red/green) for every behavior. Conventional commits on `sp-3-modules`;
  never commit straight to `main`.

## Module pattern (all three follow this)

Mirror `server/src/modules/onboarding/`:
```
server/src/modules/<module>/
  types.ts        — DTOs + store interface
  validation.ts   — pure input validation/normalization (ok/errors result shape)
  supabase-store.ts — Supabase-backed store (maps DB rows ↔ DTOs)
  service.ts      — orchestration (named functions; optimistic concurrency where editing)
  routes.ts       — Express routes, error mapping (validation→400, conflict→409, else→500)
  manifest.ts     — ModuleManifest { id, defaultEnabled:true, dependsOn:[], register }
server/test/<module>/*.test.ts — unit tests (fakes)
supabase/migrations/00NN_<module>.sql — table(s) + RLS + grants
supabase/tests/<module>_isolation_test.sql — pgTAP cross-tenant gate
```
Wire each manifest into `createApp` and register it with the Feature Registry.
v1: each module is `defaultEnabled: true` (a per-workspace enable/disable UI is a
later concern).

---

## 1. Risk Register (J)

### Data — `risk_entries` (module-owned; NOT a Hub entity)
| column | notes |
|--------|-------|
| `id` uuid pk | |
| `workspace_id` uuid not null → workspaces | RLS key |
| `title` text not null, `description` text | |
| `category` text | free text in v1 (frameworks define categories in the Hub; not enforced) |
| `likelihood` int not null check 1..5, `impact` int not null check 1..5 | |
| `owner_person_id` uuid → org_people (nullable) | the risk owner |
| `treatment` text | mitigation / treatment plan (nullable) |
| `status` text check in ('open','mitigating','accepted','closed') default 'open' | |
| `review_date` date (nullable) | next review |
| `framework_id` uuid → risk_frameworks (nullable) | the Hub framework this risk uses |
| `version` int not null default 1 | optimistic concurrency for edits |
| audit: `created_by/at`, `updated_by/at` | |

**Severity** = `likelihood * impact`, bucketed low(<6)/med(6–11)/high(12–14)/ext(≥15)
— computed in the domain layer (matches the existing `RiskPage.tsx` `severity()`),
NOT stored.

### Behavior
- CRUD risk entries (create / edit with version check / close). List for the 5×5
  matrix view. Optionally link a risk to a `business_rule`/`compliance_obligation`
  via `context_links` (relation `'addresses'`).
- Emits events on write (see §4): `risk.created`, `risk.updated`, `risk.closed`.

### UI
Wire the existing `web/src/app/RiskPage.tsx` to the real API (replace its static
`RISKS`/demo data with fetched data; keep the matrix, severity legend, add-risk
form). Add a create/edit form (modal or panel) consistent with the design system.

---

## 2. Complaints Register (E)

### Data — `complaints` (module-owned)
| column | notes |
|--------|-------|
| `id` uuid pk, `workspace_id` uuid not null → workspaces | |
| `reference` text not null | human reference, generated `C-<short>` (unique per workspace) |
| `complainant_name` text, `complainant_contact` text | |
| `channel` text check in ('phone','email','in_person','web','other') | |
| `received_at` timestamptz not null default now() | |
| `description` text not null, `category` text | |
| `severity` text check in ('low','medium','high') default 'low' | |
| `assignee_person_id` uuid → org_people (nullable) | routing |
| `status` text check in ('new','in_progress','resolved','closed') default 'new' | |
| `resolution_notes` text, `resolved_at` timestamptz | |
| `version` int default 1, audit columns | |

Link to the rule/process a complaint "touches" via `context_links`
(from `complaint` → `business_rule`/`internal_process`, relation `'concerns'`).

### Behavior
Intake (create) → classify (category + link) → route (assign) → resolve
(status→resolved + notes, sets `resolved_at`) → close. Status transitions validated.
Emits `complaint.created`, `complaint.updated`, `complaint.resolved`.

### UI
New Complaints surface (list + filters by status; intake form; detail/resolve
panel). The Shell nav slot (`complaints`, code E) already exists — replace the
placeholder `ModulePage` with the real screen.

---

## 3. Improvements register + agent

### Data — `improvements` (module-owned)
| column | notes |
|--------|-------|
| `id` uuid pk, `workspace_id` uuid not null → workspaces | |
| `source` text check in ('auto','manual') not null | |
| `title` text not null, `detail` text | |
| `trigger_kind` text | null for manual; else 'recurring_complaints' \| 'untreated_high_risk' \| 'overdue_risk_review' |
| `source_ref` jsonb | what triggered it (e.g. {category} or {risk_id}) — also used for dedup |
| `dedup_key` text | stable key for an auto-suggestion; partial-unique (see below) |
| `suggested_change` text | e.g. "Review rule X" / "Add a process for category Y" |
| `status` text check in ('open','actioned','dismissed','done') default 'open' | |
| `assignee_person_id` uuid → org_people (nullable) | |
| `version` int default 1, audit columns | |

Optional `context_links` from an improvement → the Hub entity it suggests changing
(rule/process), relation `'suggests_change_to'`.

**Dedup:** a partial unique index on `(workspace_id, dedup_key)` `where source='auto'
and status='open'` so the same pattern doesn't pile up duplicate open suggestions.
Re-firing an already-open suggestion is a no-op; if it was dismissed/done, a new
occurrence may re-open per rule (kept simple: do not reopen dismissed in v1).

### The agent (deterministic, event-driven)
A subscriber registered on the SP-1 event registry reacts to module events and
upserts suggestions. Rules (v1):
1. **recurring_complaints** — on `complaint.*`: if ≥ **3** complaints share the same
   `category` within a rolling **90 days** (non-closed), suggest reviewing/creating
   the rule or process for that category. `dedup_key = 'recurring_complaints:'||category`.
2. **untreated_high_risk** — on `risk.*`: if a risk has severity high/ext
   (`likelihood*impact ≥ 12`), `status='open'`, and empty `treatment`, suggest adding
   a mitigation. `dedup_key = 'untreated_high_risk:'||risk_id`. Cleared (suggestion
   auto-`done`) when treatment is added or risk closed.
3. **overdue_risk_review** — on `risk.*`: if `review_date < today` and status not
   closed, suggest a review. `dedup_key = 'overdue_risk_review:'||risk_id`.
   *Limitation:* purely time-based overdue (no write touching the risk) is only
   detected when the risk is next read/written; a scheduled sweep is deferred to a
   later SP (no job runner yet) — documented, not silently dropped.

Thresholds (3 / 90 days / severity≥12) live as named constants for easy tuning.

### Manual + workflow
Users create improvements directly (`source='manual'`). All improvements move
open → actioned/dismissed → done. UI: a list grouped by status with auto vs manual
badges; create form; status actions. Add an "Improvements" nav item (code e.g. `IMP`).

---

## 4. Event mechanism (validates SP-1 outbox + registry)

- On a risk/complaint create/update, the module **service emits an event** by
  inserting a `context_events` row: `type` (e.g. `risk.created`), `entity_type`
  (`risk_entry`/`complaint`), `entity_id`, `after` (the row snapshot), `actor`.
  (v1 emits from the service for simplicity/testability; a DB AFTER-trigger that
  emits is a hardening option noted for later — improvements are advisory so
  non-atomic emit is acceptable.)
- After the write, the service calls SP-1's `dispatchPendingEvents(eventStore,
  registry)`. The registry has the improvement subscriber registered on prefixes
  `'risk.'` and `'complaint.'`; its handler evaluates the rules above (querying the
  relevant module store with the service-role client) and upserts `improvements`
  rows (dedup). At-least-once: a handler throw leaves the event undispatched.
- No scheduler is introduced. Dispatch is driven by the writes themselves.

The subscriber registration + dispatch wiring lives in `createApp` alongside the
existing onboarding wiring.

## 5. Cross-cutting

- **Hub linking** via `context_links` (`links.connect`/`links.list`), proving the
  SP-1 link store. Direct FK only for `risk_entries.framework_id → risk_frameworks`.
- **Feature Registry:** three manifests (`risk`, `complaints`, `improvements`),
  `defaultEnabled: true`, no inter-dependencies. Mounted at `/api/m/{risk,complaints,improvements}`.
- **RLS + grants:** every new table: `enable row level security` + a membership
  policy `using/with check (public.is_workspace_member(workspace_id))`, plus the
  table grants to `authenticated, service_role` (extend the 0013 pattern, or rely on
  its `alter default privileges` if those cover new tables — verify in the pgTAP gate).
  A pgTAP isolation test per table proves cross-tenant denial.
- **RBAC:** reads allowed for any workspace member; route-level `requirePermission`
  for sensitive writes/deletes (e.g. closing/deleting) — keep lite, default to
  member-writable in v1, gate destructive ops to admin.
- **Frontend:** wire RiskPage; build Complaints + Improvements screens using the
  existing tokens/panels; add the Improvements nav item.

## 6. Testing
- Unit (Vitest) per module: validation, service orchestration (fakes), and the
  improvement subscriber's rule logic (fakes feeding events → assert suggestions +
  dedup).
- pgTAP cross-tenant isolation test per new table (CI gate).
- One live integration test (real Supabase): create complaints in a category past
  the threshold → dispatch → an improvement suggestion appears (and dedups on
  repeat); create a high untreated risk → suggestion; cross-tenant cannot see
  another workspace's rows. afterAll cleanup.
- Full matrix green before merge: pgTAP (run via psql locally — the local
  `supabase test db` CLI is broken; CI runs the real gate), server + web unit,
  both builds, live integration.

## 7. Build order (≈10 TDD tasks)
1. DB: `risk_entries` + RLS + grants + pgTAP isolation.
2. DB: `complaints` + RLS + grants + pgTAP.
3. DB: `improvements` (+ dedup partial-unique) + RLS + grants + pgTAP.
4. Server: Risk module (types/validation/store/service/routes/manifest) + event emit + tests.
5. Server: Complaints module + event emit + tests.
6. Server: Improvements module + the event subscriber (rules + dedup) + dispatch wiring + tests.
7. Web: wire `RiskPage` to the API + create/edit form.
8. Web: Complaints screen (list/intake/resolve).
9. Web: Improvements screen (list/auto+manual/workflow) + nav item.
10. Live integration test + final scope/security verification (rg for cross-module
    reads, Hub-write violations, Quantara coupling; RLS inventory; full matrix).

## 8. Out of scope (deferred)
- Any LLM/semantic analysis (SP-4 AI gateway).
- Real ANZSIC→obligation data (SP-7).
- Scheduled/cron detection sweeps (needs a job runner — later SP).
- Per-workspace module enable/disable UI; SLA timers; complaint escalation
  workflows; risk treatment task tracking. (All later.)
