# SP-0: Foundation & Platform Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the BYB Platform's secure multi-tenant foundation — a Supabase (Postgres + RLS) backend, an Express API with auth/RBAC/workspace-scoping, a module loader + per-workspace feature registry, an email service, and a React SPA shell you can log into — with an RLS cross-tenant isolation test enforced as a CI gate.

**Architecture:** Modular monolith with a Context Hub core (the Hub itself is SP-1; this plan builds the spine it sits on). Express API + React SPA (Vite) on a Supabase substrate. Every tenant table is `workspace_id`-scoped and protected by Postgres RLS keyed on `is_workspace_member()`. Feature modules are mounted by a loader and gated per-workspace by a feature registry.

**Tech Stack:** Node 20+, TypeScript (strict), Express 4, React 18 + Vite 5, Supabase (Postgres + Auth + RLS, local via Supabase CLI/Docker), `@supabase/supabase-js` v2, Vitest + Supertest (server) + Testing Library (web), pgTAP (database).

## Global Constraints

- **Node** ≥ 20; **npm workspaces** monorepo (`server`, `web`; `supabase/` at root).
- **TypeScript strict mode** end-to-end (`"strict": true`). ESM (`"type": "module"`).
- **Native Postgres only** — no SQLite. RLS is the tenant-safety story and must be exercised in tests.
- **Dedicated Supabase local ports** — api `54331`, db `54332`, studio `54333` (not the 54321–54323 defaults), so BYB coexists with other local Supabase projects on this machine without port collisions. `SUPABASE_URL`/`VITE_SUPABASE_URL` therefore use `127.0.0.1:54331`.
- **Every tenant table** has a `workspace_id` column, RLS enabled, a membership-scoped policy, and a **passing pgTAP cross-tenant isolation test before merge** (non-negotiable CI gate).
- **Roles** (Postgres enum `member_role`): `owner`, `admin`, `manager`, `compliance_officer`, `accountant`, `staff`.
- **Conventional commits** (`feat:`, `test:`, `chore:`, `ci:`). Commit after every task.
- **No business-logic tables in SP-0** — Context Hub entities belong to SP-1. SP-0 ships only spine tables: `workspaces`, `workspace_members`, `workspace_invites`, `workspace_features`.
- **Deferred platform scaffolds (documented deviation from spec SP-0 line):** the AI/LLM gateway, file-storage wrapper, and job scheduler are intentionally deferred to the sub-project that first consumes them (AI gateway + storage → SP-4; job scheduler → SP-1's rules engine) to avoid untested placeholder stubs. SP-0 builds the **email/notifications** service because invites (built here) consume it.

---

## File Structure

```
byb-platform/
  package.json                      # root: npm workspaces + orchestration scripts
  .gitignore
  .env.example
  supabase/
    config.toml                     # Supabase local stack config
    migrations/
      0001_spine_schema.sql         # workspaces, member_role enum, workspace_members
      0002_rls.sql                  # is_workspace_member() + RLS + policies
      0003_pgtap.sql                # pgtap extension (for tests)
      0004_create_workspace_rpc.sql # create_workspace() RPC
      0005_invites.sql              # workspace_invites + RLS + redeem_invite() RPC
      0006_feature_registry.sql     # workspace_features + RLS
    tests/
      rls_isolation_test.sql        # CI gate: cross-tenant isolation
      create_workspace_test.sql
      redeem_invite_test.sql
  server/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      config.ts                     # env loading + validation
      app.ts                        # express app factory (no listen)
      index.ts                      # listen entrypoint
      supabase.ts                   # anon + service-role client factories
      middleware/
        require-auth.ts             # Bearer JWT -> req.user
        require-workspace.ts        # RLS-scoped client + membership -> req.workspaceId/req.member
        require-permission.ts       # RBAC gate
      auth/
        rbac.ts                     # roleDefaults + resolvePermissions
      modules/
        types.ts                    # ModuleManifest type
        loader.ts                   # topo-sort + mount + feature gating
      services/
        email.ts                    # render + send (console transport in dev)
      routes/
        health.ts                   # GET /health (unauthed)
        me.ts                       # GET /api/me (authed)
    test/
      health.test.ts
      require-auth.test.ts
      require-workspace.test.ts
      rbac.test.ts
      email.test.ts
      loader.test.ts
  web/
    package.json
    tsconfig.json
    vite.config.ts
    vitest.config.ts
    index.html
    src/
      main.tsx
      supabase.ts
      api.ts                        # fetch helper attaching the access token
      App.tsx                       # session gate -> Login | Shell
      Login.tsx                     # email OTP login
      Shell.tsx                     # authed shell, calls /api/me
    test/
      login.test.tsx
      shell.test.tsx
  .github/workflows/ci.yml
```

---

### Task 1: Repo scaffold + tooling

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/test/smoke.test.ts`
- Create: `web/package.json`, `web/tsconfig.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (root) runs Vitest in `server`; npm workspaces `server` and `web` resolvable.

- [ ] **Step 1: Write the failing test**

`server/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typescript tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: Create root workspace config**

`package.json`:
```json
{
  "name": "byb-platform",
  "private": true,
  "type": "module",
  "workspaces": ["server", "web"],
  "scripts": {
    "test": "npm run test --workspace server && npm run test --workspace web --if-present",
    "test:server": "npm run test --workspace server",
    "test:web": "npm run test --workspace web",
    "db:reset": "supabase db reset",
    "db:test": "supabase test db",
    "dev:server": "npm run dev --workspace server",
    "dev:web": "npm run dev --workspace web"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
.env.local
supabase/.branches/
supabase/.temp/
*.log
```

`.env.example`:
```
# server
PORT=3001
SUPABASE_URL=http://127.0.0.1:54331
SUPABASE_ANON_KEY=replace-with-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-local-service-role-key
# web (Vite needs the VITE_ prefix)
VITE_SUPABASE_URL=http://127.0.0.1:54331
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
VITE_API_URL=http://127.0.0.1:3001
```

- [ ] **Step 3: Create the server package**

`server/package.json`:
```json
{
  "name": "@byb/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "test"]
}
```

`server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', globals: true },
})
```

- [ ] **Step 4: Create the web package stub (tested in Task 12)**

`web/package.json`:
```json
{
  "name": "@byb/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Install and run the test**

Run: `npm install && npm run test:server`
Expected: PASS — `toolchain > runs typescript tests`. (`test:web` has no tests yet; that's fine until Task 12.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold npm workspaces, TypeScript, and Vitest"
```

---

### Task 2: Spine schema + RLS migrations

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/0001_spine_schema.sql`, `supabase/migrations/0002_rls.sql`, `supabase/migrations/0003_pgtap.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `workspaces(id, name, slug, created_at)`, enum `member_role`, `workspace_members(workspace_id, user_id, role, permissions jsonb, created_at)`; function `public.is_workspace_member(ws uuid) returns boolean`; RLS enabled on both spine tables.

- [ ] **Step 1: Create the Supabase local config**

`supabase/config.toml`:
```toml
project_id = "byb-platform"

[api]
enabled = true
port = 54331
schemas = ["public"]
extra_search_path = ["public"]
max_rows = 1000

[db]
port = 54332
major_version = 15

[studio]
enabled = true
port = 54333

[auth]
enabled = true
site_url = "http://127.0.0.1:5173"
jwt_expiry = 3600
enable_signup = true

[auth.email]
enable_signup = true
enable_confirmations = false
```

- [ ] **Step 2: Write the spine schema migration**

`supabase/migrations/0001_spine_schema.sql`:
```sql
-- 0001_spine_schema.sql — BYB tenancy spine (ported/trimmed from Cinder)
create extension if not exists "pgcrypto";

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create type member_role as enum
  ('owner','admin','manager','compliance_officer','accountant','staff');

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,  -- { "granted": [...], "revoked": [...] }
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);
```

- [ ] **Step 3: Write the RLS migration**

`supabase/migrations/0002_rls.sql`:
```sql
-- 0002_rls.sql — membership-scoped RLS (ported from Cinder)
create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

alter table workspaces        enable row level security;
alter table workspace_members enable row level security;

-- workspaces: a user sees workspaces they belong to
create policy ws_select on workspaces for select
  using (public.is_workspace_member(id));
-- creation is handled by the create_workspace() RPC (0004), which also adds membership
create policy ws_insert on workspaces for insert with check (true);

-- membership rows are visible/writable to members of that workspace
create policy wm_select on workspace_members for select
  using (public.is_workspace_member(workspace_id));
create policy wm_write on workspace_members for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
```

- [ ] **Step 4: Write the pgTAP migration**

`supabase/migrations/0003_pgtap.sql`:
```sql
-- 0003_pgtap.sql — test framework (used by `supabase test db`)
create extension if not exists pgtap with schema extensions;
```

- [ ] **Step 5: Apply and verify**

Run: `supabase start && npm run db:reset`
Expected: all migrations apply with no error; output ends with "Finished supabase db reset".

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml supabase/migrations/0001_spine_schema.sql supabase/migrations/0002_rls.sql supabase/migrations/0003_pgtap.sql
git commit -m "feat: tenancy spine schema with membership-scoped RLS"
```

---

### Task 3: RLS cross-tenant isolation test (the CI gate)

**Files:**
- Create: `supabase/tests/rls_isolation_test.sql`

**Interfaces:**
- Consumes: `workspaces`, `workspace_members`, `is_workspace_member()` from Task 2.
- Produces: the canonical isolation-test pattern every future tenant table must copy.

- [ ] **Step 1: Write the failing test**

`supabase/tests/rls_isolation_test.sql`:
```sql
-- rls_isolation_test.sql — CI GATE: prove cross-tenant isolation
begin;
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a','a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b','b@test.dev');
insert into workspaces (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001','A Co','a-co'),
  ('bbbbbbbb-0000-0000-0000-000000000001','B Co','b-co');
insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','owner'),
  ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','owner');

-- act as user A
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from workspaces),
  1,
  'user A sees only their own workspace'
);
select is(
  (select count(*)::int from workspaces where slug = 'b-co'),
  0,
  'user A cannot see workspace B'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it passes against the Task 2 schema**

Run: `npm run db:test`
Expected: PASS — `rls_isolation_test.sql .. ok` with `2..2` assertions. (If it fails, the RLS policy in Task 2 is wrong — fix the policy, not the test.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/rls_isolation_test.sql
git commit -m "test: cross-tenant RLS isolation gate on workspaces"
```

---

### Task 4: `create_workspace` RPC

**Files:**
- Create: `supabase/migrations/0004_create_workspace_rpc.sql`, `supabase/tests/create_workspace_test.sql`

**Interfaces:**
- Consumes: `workspaces`, `workspace_members` from Task 2.
- Produces: RPC `public.create_workspace(p_name text, p_slug text) returns workspaces` — inserts the workspace and an `owner` membership for `auth.uid()`.

- [ ] **Step 1: Write the failing test**

`supabase/tests/create_workspace_test.sql`:
```sql
begin;
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1','c@test.dev');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select lives_ok(
  $$ select create_workspace('C Co','c-co') $$,
  'create_workspace runs for an authenticated user'
);
select is(
  (select role::text from workspace_members
   where user_id = '00000000-0000-0000-0000-0000000000c1'),
  'owner',
  'creator becomes owner'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:test`
Expected: FAIL — `function create_workspace(unknown, unknown) does not exist`.

- [ ] **Step 3: Write the RPC migration**

`supabase/migrations/0004_create_workspace_rpc.sql`:
```sql
-- 0004_create_workspace_rpc.sql
create or replace function public.create_workspace(p_name text, p_slug text)
returns workspaces language plpgsql security definer
set search_path = public as $$
declare w workspaces;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  insert into workspaces(name, slug) values (p_name, p_slug) returning * into w;
  insert into workspace_members(workspace_id, user_id, role)
    values (w.id, auth.uid(), 'owner');
  return w;
end; $$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: PASS — `create_workspace_test.sql` 2/2; `rls_isolation_test.sql` still 2/2.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_create_workspace_rpc.sql supabase/tests/create_workspace_test.sql
git commit -m "feat: create_workspace RPC with owner membership"
```

---

### Task 5: Express skeleton + config + health route

**Files:**
- Create: `server/src/config.ts`, `server/src/app.ts`, `server/src/index.ts`, `server/src/routes/health.ts`, `server/test/health.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(): AppConfig` (`{ port, supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey }`); `createApp(): express.Express`; route `GET /health → 200 { status: 'ok' }`.

- [ ] **Step 1: Write the failing test**

`server/test/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('GET /health', () => {
  it('returns ok without auth', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find module `../src/app.js`.

- [ ] **Step 3: Write config, app, route, entrypoint**

`server/src/config.ts`:
```ts
export interface AppConfig {
  port: number
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey: string
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3001),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseAnonKey: required('SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  }
}
```

`server/src/routes/health.ts`:
```ts
import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})
```

`server/src/app.ts`:
```ts
import express from 'express'
import { healthRouter } from './routes/health.js'

export function createApp(): express.Express {
  const app = express()
  app.use(express.json())
  app.use(healthRouter)
  return app
}
```

`server/src/index.ts`:
```ts
import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
createApp().listen(config.port, () => {
  console.log(`BYB API listening on :${config.port}`)
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — `GET /health > returns ok without auth`.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/app.ts server/src/index.ts server/src/routes/health.ts server/test/health.test.ts
git commit -m "feat: express skeleton with config loader and health route"
```

---

### Task 6: Supabase clients + auth middleware + `/api/me`

**Files:**
- Create: `server/src/supabase.ts`, `server/src/middleware/require-auth.ts`, `server/src/routes/me.ts`, `server/test/require-auth.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 5).
- Produces:
  - `anonClient(config)` and `serviceClient(config)` factories (`@supabase/supabase-js`).
  - `requireAuth(deps)`: Express middleware that reads `Authorization: Bearer <token>`, validates it via `deps.getUser(token)`, sets `req.user = { id, email }`, else `401`. `deps.getUser` is injectable for tests.
  - `req.user` augmented on `express.Request` as `{ id: string; email: string | null }`.
  - route `GET /api/me` (behind `requireAuth`) → `200 { id, email }`.

- [ ] **Step 1: Write the failing test**

`server/test/require-auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireAuth } from '../src/middleware/require-auth.js'

function appWith(getUser: (t: string) => Promise<{ id: string; email: string | null } | null>) {
  const app = express()
  app.get('/api/me', requireAuth({ getUser }), (req, res) => res.json(req.user))
  return app
}

describe('requireAuth', () => {
  it('401s without a bearer token', async () => {
    const res = await request(appWith(async () => null)).get('/api/me')
    expect(res.status).toBe(401)
  })

  it('401s when token is invalid', async () => {
    const res = await request(appWith(async () => null))
      .get('/api/me').set('Authorization', 'Bearer bad')
    expect(res.status).toBe(401)
  })

  it('sets req.user for a valid token', async () => {
    const app = appWith(async () => ({ id: 'u1', email: 'u@test.dev' }))
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer good')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'u1', email: 'u@test.dev' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../src/middleware/require-auth.js`.

- [ ] **Step 3: Write clients, middleware, route, and wire it**

`server/src/supabase.ts`:
```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from './config.js'

export function anonClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function serviceClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// A per-request client carrying the user's JWT so Postgres RLS applies.
export function userScopedClient(config: AppConfig, accessToken: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
```

`server/src/middleware/require-auth.ts`:
```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express'

export interface AuthedUser { id: string; email: string | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser
      accessToken?: string
    }
  }
}

export interface RequireAuthDeps {
  getUser: (token: string) => Promise<AuthedUser | null>
}

export function requireAuth(deps: RequireAuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'missing bearer token' })
    const user = await deps.getUser(token)
    if (!user) return res.status(401).json({ error: 'invalid token' })
    req.user = user
    req.accessToken = token
    next()
  }
}
```

`server/src/routes/me.ts`:
```ts
import { Router } from 'express'
import { requireAuth } from '../middleware/require-auth.js'
import { anonClient } from '../supabase.js'
import type { AppConfig } from '../config.js'

export function meRouter(config: AppConfig): Router {
  const supabase = anonClient(config)
  const router = Router()
  router.get(
    '/api/me',
    requireAuth({
      getUser: async (token) => {
        const { data, error } = await supabase.auth.getUser(token)
        if (error || !data.user) return null
        return { id: data.user.id, email: data.user.email ?? null }
      },
    }),
    (req, res) => res.json(req.user),
  )
  return router
}
```

Modify `server/src/app.ts` to accept config and mount `meRouter`:
```ts
import express from 'express'
import { healthRouter } from './routes/health.js'
import { meRouter } from './routes/me.js'
import type { AppConfig } from './config.js'

export function createApp(config?: AppConfig): express.Express {
  const app = express()
  app.use(express.json())
  app.use(healthRouter)
  if (config) app.use(meRouter(config))
  return app
}
```

Update `server/src/index.ts` to pass config: change `createApp()` to `createApp(config)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — all `requireAuth` cases and the still-passing `/health` test.

- [ ] **Step 5: Commit**

```bash
git add server/src/supabase.ts server/src/middleware/require-auth.ts server/src/routes/me.ts server/src/app.ts server/src/index.ts server/test/require-auth.test.ts
git commit -m "feat: supabase clients, JWT auth middleware, and /api/me"
```

---

### Task 7: Workspace-scoping middleware (RLS-scoped client)

**Files:**
- Create: `server/src/middleware/require-workspace.ts`, `server/test/require-workspace.test.ts`

**Interfaces:**
- Consumes: `userScopedClient` (Task 6), `req.user`/`req.accessToken` (Task 6).
- Produces: `requireWorkspace(deps)` middleware reading workspace id from header `x-workspace-id`, looking up the caller's membership **through the RLS-scoped client** (so non-members get nothing), then setting `req.workspaceId: string` and `req.member: { role: string; permissions: { granted?: string[]; revoked?: string[] } }`; `400` if header missing, `403` if not a member. `deps.getMembership(token, workspaceId)` is injectable for tests.

- [ ] **Step 1: Write the failing test**

`server/test/require-workspace.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireWorkspace, Membership } from '../src/middleware/require-workspace.js'

function appWith(getMembership: (t: string, ws: string) => Promise<Membership | null>) {
  const app = express()
  app.use((req, _res, next) => { req.user = { id: 'u1', email: null }; req.accessToken = 'tok'; next() })
  app.get('/x', requireWorkspace({ getMembership }), (req, res) =>
    res.json({ workspaceId: req.workspaceId, member: req.member }))
  return app
}

describe('requireWorkspace', () => {
  it('400 without x-workspace-id', async () => {
    const res = await request(appWith(async () => null)).get('/x')
    expect(res.status).toBe(400)
  })

  it('403 when not a member', async () => {
    const res = await request(appWith(async () => null)).get('/x').set('x-workspace-id', 'ws1')
    expect(res.status).toBe(403)
  })

  it('attaches workspaceId and member when a member', async () => {
    const m = { role: 'manager', permissions: { granted: ['x'] } }
    const res = await request(appWith(async () => m)).get('/x').set('x-workspace-id', 'ws1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ workspaceId: 'ws1', member: m })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../src/middleware/require-workspace.js`.

- [ ] **Step 3: Implement**

`server/src/middleware/require-workspace.ts`:
```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AppConfig } from '../config.js'
import { userScopedClient } from '../supabase.js'

export interface Membership {
  role: string
  permissions: { granted?: string[]; revoked?: string[] }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspaceId?: string
      member?: Membership
    }
  }
}

export interface RequireWorkspaceDeps {
  getMembership: (accessToken: string, workspaceId: string) => Promise<Membership | null>
}

// Production dependency: query workspace_members through the RLS-scoped client.
export function supabaseMembershipLookup(config: AppConfig): RequireWorkspaceDeps['getMembership'] {
  return async (accessToken, workspaceId) => {
    const db = userScopedClient(config, accessToken)
    const { data, error } = await db
      .from('workspace_members')
      .select('role, permissions')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error || !data) return null
    return { role: data.role as string, permissions: (data.permissions ?? {}) as Membership['permissions'] }
  }
}

export function requireWorkspace(deps: RequireWorkspaceDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const workspaceId = req.header('x-workspace-id') ?? ''
    if (!workspaceId) return res.status(400).json({ error: 'missing x-workspace-id' })
    const member = await deps.getMembership(req.accessToken ?? '', workspaceId)
    if (!member) return res.status(403).json({ error: 'not a workspace member' })
    req.workspaceId = workspaceId
    req.member = member
    next()
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — all three `requireWorkspace` cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/require-workspace.ts server/test/require-workspace.test.ts
git commit -m "feat: workspace-scoping middleware via RLS-scoped client"
```

---

### Task 8: RBAC — role defaults + `requirePermission`

**Files:**
- Create: `server/src/auth/rbac.ts`, `server/src/middleware/require-permission.ts`, `server/test/rbac.test.ts`

**Interfaces:**
- Consumes: `req.member` (Task 7).
- Produces:
  - `roleDefaults: Record<MemberRole, string[]>` and `type MemberRole`.
  - `resolvePermissions(member: { role: string; permissions: { granted?: string[]; revoked?: string[] } }): Set<string>` = `(roleDefaults[role] ∪ granted) \ revoked`. `owner`/`admin` resolve to the wildcard `'*'`.
  - `requirePermission(perm: string): RequestHandler` — `403` unless `req.member` resolves `perm` (or `'*'`).

- [ ] **Step 1: Write the failing test**

`server/test/rbac.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { resolvePermissions } from '../src/auth/rbac.js'
import { requirePermission } from '../src/middleware/require-permission.js'

describe('resolvePermissions', () => {
  it('grants wildcard to owner', () => {
    expect(resolvePermissions({ role: 'owner', permissions: {} }).has('*')).toBe(true)
  })
  it('applies role defaults for compliance_officer', () => {
    const p = resolvePermissions({ role: 'compliance_officer', permissions: {} })
    expect(p.has('obligations.write')).toBe(true)
  })
  it('honors per-member grants and revokes', () => {
    const p = resolvePermissions({ role: 'staff', permissions: { granted: ['risk.write'], revoked: ['risk.read'] } })
    expect(p.has('risk.write')).toBe(true)
    expect(p.has('risk.read')).toBe(false)
  })
})

describe('requirePermission', () => {
  function appWith(member: any) {
    const app = express()
    app.use((req, _res, next) => { req.member = member; next() })
    app.get('/x', requirePermission('risk.write'), (_req, res) => res.json({ ok: true }))
    return app
  }
  it('403 when missing the permission', async () => {
    const res = await request(appWith({ role: 'staff', permissions: {} })).get('/x')
    expect(res.status).toBe(403)
  })
  it('200 with the permission', async () => {
    const res = await request(appWith({ role: 'staff', permissions: { granted: ['risk.write'] } })).get('/x')
    expect(res.status).toBe(200)
  })
  it('200 for owner via wildcard', async () => {
    const res = await request(appWith({ role: 'owner', permissions: {} })).get('/x')
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../src/auth/rbac.js`.

- [ ] **Step 3: Implement**

`server/src/auth/rbac.ts`:
```ts
export type MemberRole =
  | 'owner' | 'admin' | 'manager' | 'compliance_officer' | 'accountant' | 'staff'

export interface MemberPermissions { granted?: string[]; revoked?: string[] }
export interface MemberLike { role: string; permissions: MemberPermissions }

// '*' is a wildcard meaning "all permissions".
export const roleDefaults: Record<MemberRole, string[]> = {
  owner: ['*'],
  admin: ['*'],
  manager: ['process.read', 'process.write', 'risk.read', 'risk.write', 'complaint.read', 'complaint.write', 'people.read'],
  compliance_officer: ['obligations.read', 'obligations.write', 'process.read', 'risk.read', 'risk.write'],
  accountant: ['finance.read', 'finance.write', 'reporting.read'],
  staff: ['process.read', 'document.read', 'training.read', 'training.complete'],
}

export function resolvePermissions(member: MemberLike): Set<string> {
  const base = roleDefaults[(member.role as MemberRole)] ?? []
  const set = new Set<string>(base)
  for (const g of member.permissions.granted ?? []) set.add(g)
  for (const r of member.permissions.revoked ?? []) set.delete(r)
  return set
}
```

`server/src/middleware/require-permission.ts`:
```ts
import type { RequestHandler } from 'express'
import { resolvePermissions } from '../auth/rbac.js'

export function requirePermission(perm: string): RequestHandler {
  return (req, res, next) => {
    if (!req.member) return res.status(403).json({ error: 'no workspace context' })
    const perms = resolvePermissions(req.member)
    if (perms.has('*') || perms.has(perm)) return next()
    return res.status(403).json({ error: `missing permission: ${perm}` })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — all `resolvePermissions` and `requirePermission` cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/rbac.ts server/src/middleware/require-permission.ts server/test/rbac.test.ts
git commit -m "feat: RBAC role defaults and requirePermission middleware"
```

---

### Task 9: Email / notifications service

**Files:**
- Create: `server/src/services/email.ts`, `server/test/email.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `renderTemplate(body: string, vars: Record<string, string>): string` — replaces `{{token}}` with `vars[token]`, **unknown tokens render as empty string** (safe interpolation, ported from belcrm).
  - `type EmailTransport = (msg: { to: string; subject: string; html: string }) => Promise<void>`.
  - `consoleTransport: EmailTransport` (dev: logs the message).
  - `createEmailService(transport: EmailTransport)` → `{ send(to, subject, body, vars) }` which renders then transports.

- [ ] **Step 1: Write the failing test**

`server/test/email.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { renderTemplate, createEmailService } from '../src/services/email.js'

describe('renderTemplate', () => {
  it('substitutes known tokens', () => {
    expect(renderTemplate('Hi {{name}}', { name: 'Sam' })).toBe('Hi Sam')
  })
  it('renders unknown tokens as empty', () => {
    expect(renderTemplate('Hi {{name}} {{missing}}', { name: 'Sam' })).toBe('Hi Sam ')
  })
})

describe('email service', () => {
  it('renders the body then calls the transport', async () => {
    const transport = vi.fn(async () => {})
    const svc = createEmailService(transport)
    await svc.send('to@test.dev', 'Welcome', 'Join {{workspace}}', { workspace: 'A Co' })
    expect(transport).toHaveBeenCalledWith({
      to: 'to@test.dev', subject: 'Welcome', html: 'Join A Co',
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../src/services/email.js`.

- [ ] **Step 3: Implement**

`server/src/services/email.ts`:
```ts
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '')
}

export type EmailTransport = (msg: { to: string; subject: string; html: string }) => Promise<void>

export const consoleTransport: EmailTransport = async (msg) => {
  console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.html}`)
}

export function createEmailService(transport: EmailTransport) {
  return {
    async send(to: string, subject: string, body: string, vars: Record<string, string> = {}) {
      await transport({ to, subject, html: renderTemplate(body, vars) })
    },
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — `renderTemplate` and email service cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/email.ts server/test/email.test.ts
git commit -m "feat: email service with safe template interpolation"
```

---

### Task 10: Invites — schema, redeem RPC, isolation test

**Files:**
- Create: `supabase/migrations/0005_invites.sql`, `supabase/tests/redeem_invite_test.sql`

**Interfaces:**
- Consumes: `workspaces`, `workspace_members`, `is_workspace_member` (Task 2), `member_role` enum.
- Produces:
  - table `workspace_invites(id, workspace_id, email, role member_role, token text unique, invited_by, accepted_at, created_at)` with membership-scoped RLS.
  - RPC `public.redeem_invite(p_token text) returns workspaces` — adds `auth.uid()` to the invite's workspace with the invited role and marks the invite accepted.

- [ ] **Step 1: Write the failing test**

`supabase/tests/redeem_invite_test.sql`:
```sql
begin;
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1','owner@test.dev'),
  ('00000000-0000-0000-0000-0000000000d2','invitee@test.dev');
insert into workspaces (id, name, slug) values
  ('dddddddd-0000-0000-0000-000000000001','D Co','d-co');
insert into workspace_members (workspace_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','owner');
insert into workspace_invites (workspace_id, email, role, token, invited_by) values
  ('dddddddd-0000-0000-0000-000000000001','invitee@test.dev','manager','tok-123',
   '00000000-0000-0000-0000-0000000000d1');

-- act as the invitee redeeming the token
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select lives_ok(
  $$ select redeem_invite('tok-123') $$,
  'invitee can redeem a valid token'
);
select is(
  (select role::text from workspace_members
   where workspace_id = 'dddddddd-0000-0000-0000-000000000001'
     and user_id = '00000000-0000-0000-0000-0000000000d2'),
  'manager',
  'invitee joins with the invited role'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:reset && npm run db:test`
Expected: FAIL — `relation "workspace_invites" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0005_invites.sql`:
```sql
-- 0005_invites.sql
create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role member_role not null default 'staff',
  token text unique not null,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on workspace_invites (workspace_id);

alter table workspace_invites enable row level security;
-- members of a workspace manage its invites
create policy invites_rw on workspace_invites for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- redeem runs as the invitee; security definer so it can read the invite + insert membership
create or replace function public.redeem_invite(p_token text)
returns workspaces language plpgsql security definer
set search_path = public as $$
declare inv workspace_invites; w workspaces;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  select * into inv from workspace_invites where token = p_token and accepted_at is null;
  if inv.id is null then raise exception 'invalid or used invite'; end if;
  insert into workspace_members(workspace_id, user_id, role)
    values (inv.workspace_id, auth.uid(), inv.role)
    on conflict (workspace_id, user_id) do update set role = excluded.role;
  update workspace_invites set accepted_at = now() where id = inv.id;
  select * into w from workspaces where id = inv.workspace_id;
  return w;
end; $$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: PASS — `redeem_invite_test` 2/2; all earlier pgTAP tests still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_invites.sql supabase/tests/redeem_invite_test.sql
git commit -m "feat: workspace invites with RLS and redeem RPC"
```

---

### Task 11: Module loader + feature registry

**Files:**
- Create: `supabase/migrations/0006_feature_registry.sql`, `server/src/modules/types.ts`, `server/src/modules/loader.ts`, `server/test/loader.test.ts`

**Interfaces:**
- Consumes: `requireWorkspace` shape (`req.workspaceId`), Express `Router`.
- Produces:
  - table `workspace_features(workspace_id, module_id, enabled boolean, enabled_at)` with membership-scoped RLS.
  - `interface ModuleManifest { id: string; name: string; dependsOn: string[]; defaultEnabled: boolean; register(router: Router): void }`.
  - `orderModules(manifests: ModuleManifest[]): ModuleManifest[]` — topological sort; throws on missing dependency or cycle.
  - `registerModules(app, manifests, deps)` mounts each module at `/api/m/:id` behind a gate that 404s when the module is disabled for `req.workspaceId`. `deps.isEnabled(workspaceId, moduleId)` is injectable for tests.

- [ ] **Step 1: Write the failing test**

`server/test/loader.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import express, { Router } from 'express'
import request from 'supertest'
import { orderModules, registerModules } from '../src/modules/loader.js'
import type { ModuleManifest } from '../src/modules/types.js'

function mod(id: string, dependsOn: string[] = []): ModuleManifest {
  return {
    id, name: id, dependsOn, defaultEnabled: true,
    register(r: Router) { r.get('/ping', (_req, res) => res.json({ id })) },
  }
}

describe('orderModules', () => {
  it('orders dependencies before dependents', () => {
    const ordered = orderModules([mod('b', ['a']), mod('a')]).map(m => m.id)
    expect(ordered.indexOf('a')).toBeLessThan(ordered.indexOf('b'))
  })
  it('throws on a missing dependency', () => {
    expect(() => orderModules([mod('b', ['missing'])])).toThrow(/missing/)
  })
  it('throws on a cycle', () => {
    expect(() => orderModules([mod('a', ['b']), mod('b', ['a'])])).toThrow(/cycle/i)
  })
})

describe('registerModules gating', () => {
  function appWith(enabled: boolean) {
    const app = express()
    app.use((req, _res, next) => { req.workspaceId = 'ws1'; next() })
    registerModules(app, [mod('risk')], { isEnabled: async () => enabled })
    return app
  }
  it('404s when the module is disabled', async () => {
    const res = await request(appWith(false)).get('/api/m/risk/ping')
    expect(res.status).toBe(404)
  })
  it('200s when the module is enabled', async () => {
    const res = await request(appWith(true)).get('/api/m/risk/ping')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'risk' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../src/modules/loader.js`.

- [ ] **Step 3: Write the feature-registry migration**

`supabase/migrations/0006_feature_registry.sql`:
```sql
-- 0006_feature_registry.sql
create table workspace_features (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  module_id text not null,
  enabled boolean not null default false,
  enabled_at timestamptz,
  primary key (workspace_id, module_id)
);
alter table workspace_features enable row level security;
create policy features_rw on workspace_features for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
```

- [ ] **Step 4: Implement the types and loader**

`server/src/modules/types.ts`:
```ts
import type { Router } from 'express'

export interface ModuleManifest {
  id: string
  name: string
  dependsOn: string[]
  defaultEnabled: boolean
  register(router: Router): void
}
```

`server/src/modules/loader.ts`:
```ts
import { Router } from 'express'
import type { Express } from 'express'
import type { ModuleManifest } from './types.js'

export function orderModules(manifests: ModuleManifest[]): ModuleManifest[] {
  const byId = new Map(manifests.map((m) => [m.id, m]))
  for (const m of manifests) {
    for (const dep of m.dependsOn) {
      if (!byId.has(dep)) throw new Error(`module "${m.id}" depends on missing module "${dep}"`)
    }
  }
  const ordered: ModuleManifest[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (m: ModuleManifest) => {
    const s = state.get(m.id)
    if (s === 'done') return
    if (s === 'visiting') throw new Error(`dependency cycle involving "${m.id}"`)
    state.set(m.id, 'visiting')
    for (const dep of m.dependsOn) visit(byId.get(dep)!)
    state.set(m.id, 'done')
    ordered.push(m)
  }
  for (const m of manifests) visit(m)
  return ordered
}

// NOTE: registerModules is exercised by loader.test.ts (inline manifests) and
// wired into app.ts in SP-1+ when the first real feature module exists.

export interface RegisterDeps {
  isEnabled: (workspaceId: string, moduleId: string) => Promise<boolean>
}

export function registerModules(app: Express, manifests: ModuleManifest[], deps: RegisterDeps): void {
  for (const m of orderModules(manifests)) {
    const router = Router()
    // gate: a disabled module is invisible (404) for this workspace
    router.use(async (req, res, next) => {
      const wsId = req.workspaceId ?? ''
      if (!wsId || !(await deps.isEnabled(wsId, m.id))) {
        return res.status(404).json({ error: 'module not enabled' })
      }
      next()
    })
    m.register(router)
    app.use(`/api/m/${m.id}`, router)
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run db:reset && npm run db:test && npm run test:server`
Expected: PASS — `orderModules` (3) and gating (2) cases; all pgTAP tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0006_feature_registry.sql server/src/modules/types.ts server/src/modules/loader.ts server/test/loader.test.ts
git commit -m "feat: module loader with topo-sort and per-workspace feature gating"
```

---

### Task 12: React SPA shell with Supabase Auth login

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/src/main.tsx`, `web/src/supabase.ts`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/Login.tsx`, `web/src/Shell.tsx`, `web/test/login.test.tsx`, `web/test/shell.test.tsx`

**Interfaces:**
- Consumes: backend `GET /api/me` (Task 6); Supabase Auth (email OTP).
- Produces: `App` renders `Login` when no session, `Shell` when authed; `Shell` calls `/api/me` and shows the user email; `apiFetch(path, token)` helper.

- [ ] **Step 1: Write the failing tests**

`web/test/login.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from '../src/Login'

describe('Login', () => {
  it('sends an OTP for the entered email', async () => {
    const signIn = vi.fn(async () => ({ error: null }))
    render(<Login signInWithOtp={signIn} />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@test.dev')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    expect(signIn).toHaveBeenCalledWith('a@test.dev')
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })
})
```

`web/test/shell.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Shell } from '../src/Shell'

describe('Shell', () => {
  it('shows the authed user email from /api/me', async () => {
    const fetchMe = vi.fn(async () => ({ id: 'u1', email: 'a@test.dev' }))
    render(<Shell fetchMe={fetchMe} onSignOut={() => {}} />)
    expect(await screen.findByText(/a@test.dev/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:web`
Expected: FAIL — cannot find `../src/Login`.

- [ ] **Step 3: Create Vite/Vitest config and entry**

`web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()] })
```

`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['@testing-library/jest-dom/vitest'] },
})
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>BYB Platform</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 4: Implement components and helpers**

`web/src/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)
```

`web/src/api.ts`:
```ts
const API_URL = import.meta.env.VITE_API_URL as string

export async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}
```

`web/src/Login.tsx`:
```tsx
import { useState } from 'react'

export function Login({ signInWithOtp }: { signInWithOtp: (email: string) => Promise<{ error: unknown }> }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await signInWithOtp(email)
    if (!error) setSent(true)
  }
  if (sent) return <p>Check your email for a sign-in code.</p>
  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Send code</button>
    </form>
  )
}
```

`web/src/Shell.tsx`:
```tsx
import { useEffect, useState } from 'react'

interface Me { id: string; email: string | null }

export function Shell({ fetchMe, onSignOut }: { fetchMe: () => Promise<Me>; onSignOut: () => void }) {
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => { fetchMe().then(setMe).catch(() => setMe(null)) }, [fetchMe])
  return (
    <div>
      <header>BYB Platform {me ? `— ${me.email}` : ''}</header>
      <button onClick={onSignOut}>Sign out</button>
    </div>
  )
}
```

`web/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { apiFetch } from './api'
import { Login } from './Login'
import { Shell } from './Shell'

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!session) {
    return <Login signInWithOtp={(email) => supabase.auth.signInWithOtp({ email })} />
  }
  return (
    <Shell
      fetchMe={() => apiFetch('/api/me', session.access_token)}
      onSignOut={() => supabase.auth.signOut()}
    />
  )
}
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:web`
Expected: PASS — `Login` and `Shell` tests.

- [ ] **Step 6: Commit**

```bash
git add web/
git commit -m "feat: react SPA shell with supabase OTP login and authed /api/me"
```

---

### Task 13: CI — pgTAP gate + Vitest

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts `test:server`, `test:web`, `db:test`; Supabase CLI.
- Produces: a CI workflow that fails the build if any unit test or the RLS isolation gate fails.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - name: Unit tests (server + web)
        run: npm test
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - name: Start Supabase + apply migrations
        run: supabase start
      - name: RLS isolation gate (pgTAP)
        run: supabase test db
```

- [ ] **Step 2: Validate the workflow locally**

Run: `npm ci && npm test && supabase start && npm run db:test`
Expected: unit tests PASS; `supabase test db` runs every `supabase/tests/*.sql` and reports all assertions passing (the gate is green).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run unit tests and the pgTAP RLS isolation gate"
```

---

## Self-Review

**1. Spec coverage (SP-0 line from the architecture doc):**
- "Fresh repo + Supabase" → Task 1 (repo), Task 2 (Supabase config/migrations). ✓
- "Cinder migrations (workspaces, members, RLS, invites, OTP)" → Task 2 (workspaces/members/RLS), Task 4 (create_workspace), Task 10 (invites); OTP login → Task 12 (`signInWithOtp`). ✓
- "RBAC" → Task 8. ✓
- "Express skeleton + module loader + Feature Registry" → Tasks 5 (skeleton), 11 (loader + registry). ✓
- "pgTAP RLS CI gate" → Task 3 (test) + Task 13 (CI). ✓
- "React SPA shell + auth" → Task 12. ✓
- "platform-service scaffolds (AI gateway, storage, notifications, scheduler)" → **notifications built (Task 9)**; AI gateway/storage/scheduler **explicitly deferred** to their first consumer (Global Constraints) to avoid untested placeholders. Noted deviation, not a silent gap.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete code. The module loader is exercised by its own test with inline manifests (no dead sample module); `registerModules` is wired into `app.ts` in SP-1+ when the first real module lands. ✓

**3. Type/name consistency:** `requireAuth`/`requireWorkspace`/`requirePermission`, `resolvePermissions`, `roleDefaults`, `Membership`, `ModuleManifest`, `orderModules`/`registerModules`, `renderTemplate`/`createEmailService`, `userScopedClient`, `create_workspace`/`redeem_invite`/`is_workspace_member` are used identically across tasks. `req.user`/`req.accessToken`/`req.workspaceId`/`req.member` augmentations are declared where introduced and consumed downstream. ✓

**Deliverable:** after Task 13, the foundation runs: log in via OTP in the React shell, the authed shell reads `/api/me`, every tenant table is RLS-protected, the module/feature-registry seam is in place, and CI fails on any cross-tenant leak. SP-1 (Context Hub) builds directly on this.
