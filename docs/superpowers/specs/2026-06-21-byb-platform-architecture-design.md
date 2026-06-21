# BYB Platform — Whole-Platform Architecture Design

- **Date:** 2026-06-21
- **Status:** Approved (brainstorming) — pending written-spec review
- **Context:** BYB ("Build Your Business") is being built **for a client**, as a **clean, standalone, independently-deployable project**. It must not depend on or entangle the author's other repos (belcrm, Quantara, ncc, etc.); reuse is by **porting cleaned copies** of modules into this repo. BYB is fully independent of the Quantara emotion/biometric "Neural Workflow" stack.

## 1. Overview & goals

BYB is a **Context-Driven Operating System** for AU/NZ businesses. Its premise (from the pitch deck): instead of rebuilding business logic tool-by-tool, a business defines **how it operates once** in a single **Context Hub** (source of truth), and every modular feature **reads from and adapts to** that definition. A change in one place updates the whole system instantly.

The architecture's single job is to make that promise literally true:
- **One definition** of how the business operates.
- **Features adapt** to that definition (they never hold their own copy of it).
- **A change updates the entire system instantly.**
- **No duplicated logic, no rebuilt workflows, no lost context** between tools.

## 2. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where it lives | **Fresh, standalone repo** (`byb-platform`) | Client product; clean isolation; no entanglement with author's apps. |
| Substrate | **Supabase** (Postgres + Auth + RLS + Storage + Realtime), spine lifted from Cinder | Cinder already ships the exact multi-tenant + RLS + invites/OTP foundation BYB needs. |
| Backend | **Express modular monolith** | Lingua franca of the reusable logic (trigger engine, LLM chain, BI compiler, stores). One deploy. |
| Frontend | **React SPA (Vite)** on the Express API + Supabase Auth/Realtime | Component-heavy UI (wizards, tables, libraries, AI chat); existing HTML dashboards are design references. |
| Architecture style | **Modular monolith with a Context Hub core** (+ event bus + per-workspace feature registry) | Delivers the context-driven promise and modular add-ons without microservice ops; extractable later. |
| Data-access layer | **Native Postgres from day one** (Quantara SQLite↔Postgres adapter used only as a temporary porting aid) | RLS — the tenant-safety story — exists only in Postgres; dev-on-SQLite wouldn't exercise it. |
| v1 scope | "Broader v1": Foundation + Context Hub + Onboarding + IPL + Document Library + Risk Register + Complaints + Onboarding&Train + Trackers/Projects | User-selected. Reporting, Monitoring agent, Product Hub, Finance are v2. |

## 3. System architecture (the layers)

```
CLIENT — React SPA (Vite)
  Component library: wizard steps · data tables · library grids · AI chat · dashboards · Rule Builder
  ── talks to ──►  Express REST API  +  Supabase Auth (session)  +  Supabase Realtime (live events)
        │ JSON / HTTPS
API — Express modular monolith (one deploy)
  FEATURE MODULES (each: routes → service → Hub API; enable-able per workspace via Feature Registry)
    onboarding · ipl · documents · risk · complaints · training · tracker · projects
    · reporting* · monitoring* · product* · finance*            (* = v2+)
                    │  (read/write ONLY through ▼)
  ┌──────────────────────────────────────────────────────────────┐
  │  CONTEXT HUB CORE  (the source of truth)                      │
  │   • Domain entities + typed Repositories (the Context API)    │
  │   • Versioning + audit on every entity                        │
  │   • Rules / automation engine (ported from belcrm)           │
  │   • Event bus → emits rule.updated / obligation.added / …     │
  └──────────────────────────────────────────────────────────────┘
  PLATFORM SERVICES (shared, cross-cutting)
    auth+session · RBAC · AI/LLM gateway + agent sandbox · file store ·
    notifications/email · reporting dataset registry · job scheduler · feature registry
                    │ via DB adapter
DATA — Supabase
   Postgres + RLS (everything workspace-scoped) · Storage (files) · Auth (identity, OTP, invites) · Realtime
```

**The three rules that make this "context-driven":**

1. **Single source of truth.** Business rules, obligations, processes, org/people, risk frameworks live *only* in the Context Hub. Feature modules store their own feature data plus **references** to Hub entities — never a copy of the business logic.
2. **One read/write path.** Modules touch the Hub *only* through its typed repository API. No module reaches into another module's tables; no module writes business logic directly to Postgres.
3. **Change propagates instantly.** A Hub write emits an event; subscribed modules react; live clients update via Supabase Realtime.

## 4. The Context Hub core (keystone)

Eight workspace-scoped domain entities, each versioned + audited, all linkable to each other:

| Entity | Holds | Deck source |
|---|---|---|
| `business_profile` | name, ANZSIC industry, size, AU/NZ jurisdiction | Business Profile step |
| `business_rules` | `rule_type` (business_rule \| value/setting \| must_do), `area`, condition/question, operator+value/threshold, **consequence if not met**, `applies_to` (roles/people/teams) | Rule Builder screen |
| `compliance_obligations` | name, description, `source` (Australian Law / State Reg), linked-status, subscribe-to-updates | Industry Compliance screen |
| `internal_processes` | process steps/maps, role/area/frequency tags, approval status, FAQs | IPL |
| `decision_logic` | decision trees / approval thresholds referenced by rules & processes | Decision logic |
| `risk_frameworks` | categories, appetite, 5×5 matrix config | Risk frameworks |
| `governance` | committees, approval authorities, escalation paths | Governance structures |
| `org_people` | person (name, title, email), responsibilities, role, **access scope** | People & Responsibilities |

**Process definitions and decision logic are Hub entities** (canonical context), with the IPL module as the authoring/presentation surface over them. This is what lets training auto-generate from processes and lets rules flag process conflicts.

**Versioning + audit (one consistent pattern, from Quantara `model_versioning` + belcrm supersede):** every row carries `version`, `status` (draft/active/archived), `created_by/at`, `updated_by/at`, `approved_by/at`, and a supersede chain; full history in a generic `entity_versions` table. Entities **deprecate, never hard-delete.**

**The Context API (the only door in/out).** Each entity gets a typed repository of the same shape:
```
ContextHub.rules.list(workspaceId, {area, appliesTo})  → Rule[]
ContextHub.rules.get(id)                                → Rule
ContextHub.rules.upsert(rule, actor)   → writes + audits + emits rule.updated
ContextHub.rules.deprecate(id, actor)
ContextHub.links.connect(ruleId, obligationId, actor)   // cross-entity links
```
Reads are RLS-scoped automatically; **every write goes through here**, so audit + event emission cannot be bypassed.

**Rules/automation engine** (ported from belcrm `trigger-engine` + `automations-runner`): evaluates `condition (AND/OR) → action` against Hub entities and feature events, with cooldown + audit. Hosts **conflict detection** — v1 is **deterministic** (same `applies_to` + `area` + `condition` with opposing consequences), advisory only (flags, never auto-blocks). Semantic/LLM conflict reasoning is a later upgrade.

**Event bus:** any Hub write emits `{type, workspace_id, entity, before, after, actor}` via an **outbox** (event row written in the same transaction as the data, dispatched after commit). In-process module subscribers react; a Postgres `NOTIFY` → Supabase Realtime bridge pushes to live clients.

## 5. Feature module anatomy + module map

Every feature module has the identical shape:
```
modules/<name>/
  routes.js      Express REST routes (auth + RLS-scoped middleware)
  service.js     logic; READS context via ContextHub API, WRITES only its own tables
  events.js      subscribes to Hub events; emits its own module events
  schema.sql     its OWN workspace-scoped tables = feature data + FK refs to Hub entity ids
  manifest.js    registers with Feature Registry: id, deps, default-enabled?, required role
```
A module cannot read another module's tables or write business logic to the Hub directly — only its own data + references. The **Feature Registry** enables/disables modules **per workspace** (deck's "modular add-ons" / "IPL feature enablement") and enforces dependency order.

| Module | Area | Release | Primary reuse source |
|---|---|---|---|
| `onboarding` | **A** Business-Profile setup wizard | v1 | Cinder onboarding state machine + invites/OTP |
| _(core)_ | **B** Context Hub | v1 | greenfield (§4) |
| `ipl` | **C** Internal Process Library | v1 | training-hub SOP surfaces + belcrm autonomous-agent + Quantara-KB |
| `documents` | **D** Document Library | v1 | belcrm file-upload + email templating + smart-search + Quantara-KB |
| `complaints` | **E** Complaints Register + Improvement agent | v1 | belcrm ticketing/auto-resolve + emotion detector |
| `training` | **G** Onboarding & Train | v1 | training-hub gamified hub + automation-runner + business-calendar |
| `tracker` | **H** Build-your-own Tracker | v1 | ncc planner/data-bundle + trigger-engine |
| `risk` | **J** Lite Risk Register | v1 | ncc risk-store (near drop-in) |
| `projects` | **K** Lite Project Manager | v1 | ncc planner-store |
| `reporting` | **L** Insights & Reporting | v2 | belcrm bi-store/compiler + aws-connect ETL |
| `monitoring` | **I** Industry Monitoring agent | v2 | shortages-ai RAG + Quantara job-lease + notifier |
| `product` | **F** Product Hub | v2 | greenfield (+ generic card-grid UI) |
| `finance` | **M** Finance & Payments | v2 | partner: Xero/MYOB + Stripe AU on belcrm OAuth scaffold |

Notes: `training` auto-generates role-based modules by reading processes + rules + obligations from the Hub (no double-authoring). `tracker` (H) and `projects` (K) share **one configurable planner store**, two surfaces.

## 6. Cross-cutting platform layer (area X)

Shared services every module consumes (almost all port-and-assemble, not new):

| Service | What it does | Source |
|---|---|---|
| Auth + multi-tenancy | Supabase Auth (email OTP + invites); `workspace` = tenant; `workspace_members` (role + permissions JSONB); `is_workspace_member()` security-definer; **RLS on every table** | Cinder |
| RBAC | role defaults (owner/admin · manager · compliance_officer · accountant · staff) + per-person overrides + **per-person view access**; `org_people` access-scope in Hub, platform enforces | belcrm `ROLE_DEFAULTS`, adapted |
| AI/LLM gateway + agent sandbox | provider chain Groq→Gemini→Anthropic, **per-workspace budget caps** + usage logging; agent writes to Hub **only via `requires_approval` + human confirm** | belcrm `ai.js` + `agent-sandbox` |
| File storage | Supabase Storage; MIME whitelist + executable blocking + size cap + opaque names | belcrm upload pattern |
| Notifications/email | safe-interpolation templates for invites, approvals, training reminders, obligation alerts | belcrm `email-templates` |
| Job scheduler | leased cron for training scheduling, **obligation-deadline checks**, monitoring, rollups — **AU/NZ working-day/holiday-aware** | Quantara `job-lease` + belcrm runner + ncc `business-calendar` |
| Reporting dataset registry | named datasets → Hub/module queries; dashboards read from it | belcrm `bi-compiler` (v2 reporting) |
| Feature registry | per-workspace module enable/disable + dependency order | new (small) |

**AU/NZ-specific concerns (compliance product = higher bar):**
- **LLM data residency / privacy** — gateway supports routing to AU-region/privacy-tier models; the obligations agent uses **RAG over a vetted source with provenance + "verify with adviser" disclaimers** — never free-hallucinated obligations.
- **RLS isolation as a CI gate** — every Hub/module table ships with a passing pgTAP isolation test (Cinder harness).

## 7. Data flow

**Flow 1 — Onboarding writes the source of truth**
```
Wizard steps (Profile → Rules → ANZSIC/Obligations → People)
  → onboarding.service validates
  → ContextHub.profile.upsert · rules.upsert · obligations.connect · people.invite (version+audit+event)
  → Feature Registry enables the workspace's v1 modules
  → invited people get Supabase Auth invites with role-scoped access
```

**Flow 2 — A rule change propagates instantly**
```
compliance_officer edits a business_rule in the Rule Builder
  → ContextHub.rules.upsert → version bump + audit + `rule.updated`
  → rules engine re-runs deterministic conflict check
  → subscribers react: ipl re-flags conflicting steps; training marks modules "stale"; reporting cache invalidated
  → Postgres NOTIFY → Supabase Realtime → open dashboards update live
```

**Flow 3 — Chat-to-build a process (AI + approval gate)**
```
User: "build a supplier onboarding process" (IPL)
  → AI gateway (budget check) → agent drafts steps, READING Hub rules/obligations/roles
  → deterministic conflict check vs business_rules
  → draft shown for human review/edit (nothing persisted)
  → on approve: write via agent-sandbox (requires_approval) → ContextHub.processes.upsert(actor=user)
  → audit + `process.created` → training can auto-generate a role module
```

Throughline: **writes flow into the Hub, events flow out of it.** Every module is a producer or consumer of context, never an island.

## 8. Error handling & safety

| Risk | Containment |
|---|---|
| Cross-tenant leak | Defense in depth: app-layer workspace scoping **+** Postgres RLS as the last line. |
| Partial / rolled-back Hub writes | Transactional writes; **outbox** events (same tx, dispatch after commit) — events never fire for rolled-back writes. |
| Missed event delivery | Events are an optimization; module reactions are **recomputable on read** — a dropped event degrades freshness, never corrupts state. |
| AI provider down / over budget | Provider fallback; graceful "AI unavailable, draft manually"; agent **never persists without approval**. |
| False-positive rule conflicts | v1 conflict detection is **advisory** (flags), never auto-blocks. |
| Wrong compliance obligations | RAG over vetted source + provenance + "verify with adviser" disclaimers; never authoritative legal advice. |
| Accidental data loss | Entities **deprecate, never hard-delete**; full `entity_versions` history → recoverable. |

## 9. Testing strategy (TDD throughout)

- **pgTAP RLS isolation tests = CI gate.** Every Hub/module table ships with a passing cross-tenant isolation test before merge. Never relaxed.
- **Context API contract tests.** Pin the repository interface *and* the invariant that **every write audits + emits an event** — stops future modules bypassing the Hub.
- **Module unit tests** — each service in isolation, mocking the Context API.
- **Integration tests** for the three §7 flows.
- **Migration tests** — migrations apply cleanly; every new table has its RLS policy.

## 10. Build-order decomposition (sub-projects)

Each is independently spec-able — one spec → plan → build cycle per sub-project, in this order:

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| **SP-0** | Foundation & platform spine | Repo + Supabase; Cinder migrations (workspaces, members, RLS, invites, OTP); RBAC; Express skeleton + module loader + Feature Registry; pgTAP RLS CI gate; React SPA shell + auth; platform-service scaffolds | — |
| **SP-1** | Context Hub core ⭐ | 8 entities + versioning/audit + Context API + event bus (outbox) + rules engine + deterministic conflict detection + contract/RLS tests | SP-0 |
| **SP-2** | Onboarding wizard (A) | React wizard: Profile · Rule Builder UI · ANZSIC selector (placeholder obligations) · People & RBAC — writes to Hub | SP-1 |
| **SP-3** | Quick-win modules (J, E) | Lite Risk Register + Complaints Register + Improvement agent — validates module pattern | SP-1 (parallel to SP-2) |
| **SP-4** | IPL + Document Library (C, D) | Process authoring (chat-to-build + upload) with conflict flags; Document Library (upload/AI-build, versioning-on-finalise) | SP-1, AI gateway |
| **SP-5** | Trackers + Projects (H, K) | One configurable planner store, two surfaces | SP-1 |
| **SP-6** | Onboarding & Train (G) | Auto-generate role modules from Hub; gamified delivery; scheduling | SP-1, SP-4 |
| — | **— v1 ships here —** | | |
| **SP-7** | ANZSIC obligations library + Monitoring agent (I) | Curate ANZSIC→AU/NZ obligations dataset (replaces placeholder) + subscribe-to-updates + RAG monitoring agent | SP-1, SP-2 |
| **SP-8** | Insights & Reporting (L) | Dataset registry → Hub; dashboards; weekly rollups | SP-1 + modules |
| **SP-9** | Product Hub (F) | Catalog, customer view, troubleshooting | SP-1, SP-4 |
| **SP-10** | Finance & Payments (M) | Xero/MYOB + Stripe AU partner integration | SP-0 |

**Critical path:** `SP-0 → SP-1 → everything`. The Hub (SP-1) is the chokepoint — built before any feature module, never parallelized away. SP-2 and SP-3 run together once SP-1 lands. Real ANZSIC data is deferred to SP-7 with a placeholder in SP-2.

## 11. Reuse reference

The full asset-by-asset reuse map (which file in which source app feeds each area, with reuse level) lives in `/Users/belindaswitzer/BYB-REUSE-PLAN.md`. All reuse is by **porting cleaned copies** into this repo — no runtime dependency on the source repos.

## 12. Non-goals / out of scope

- **No microservices** for v1 (modular monolith; extractable later if the client ever needs it).
- **No dependency on the author's other apps** at runtime — reuse is copy-and-clean only.
- **No coupling to the Quantara Neural Workflow / emotion-biometric / multifractal stack** — BYB only reuses Quantara's generic infra (db adapter, crypto, tokens, job-lease).
- **No in-house invoicing engine** — Finance (M) is a partner integration.
- **No native mobile app** for v1 — React web only; SwiftUI/React-Native code is a future reference, not v1 scope.
- **No semantic/LLM rule-conflict detection** in v1 — deterministic checks first.
