import express from 'express'
import { corsMiddleware } from './middleware/cors.js'
import { healthRouter } from './routes/health.js'
import { meRouter } from './routes/me.js'
import type { AppConfig } from './config.js'
import { anonClient, userScopedClient, serviceClient } from './supabase.js'
import { requireAuth } from './middleware/require-auth.js'
import { supabaseMembershipLookup } from './middleware/require-workspace.js'
import { supabaseHubStore, supabaseEventStore, supabaseLinkStore } from './context/supabase-store.js'
import { supabaseOnboardingCompletionStore, setOnboardingStore } from './context/index.js'
import { ContextHub } from './context/index.js'
import { createRegistry } from './context/events.js'
import { createOnboardingService } from './modules/onboarding/service.js'
import { supabaseOnboardingStore } from './modules/onboarding/supabase-store.js'
import { createOnboardingManifest } from './modules/onboarding/manifest.js'
import { bootstrapRouter } from './modules/onboarding/routes.js'
import { supabaseRiskStore } from './modules/risk/supabase-store.js'
import { createRiskService } from './modules/risk/service.js'
import { createRiskManifest } from './modules/risk/manifest.js'
import { supabaseComplaintsStore } from './modules/complaints/supabase-store.js'
import { createComplaintsService } from './modules/complaints/service.js'
import { createComplaintsManifest } from './modules/complaints/manifest.js'
import { supabaseImprovementsStore } from './modules/improvements/supabase-store.js'
import { createImprovementService } from './modules/improvements/service.js'
import { createImprovementsManifest } from './modules/improvements/manifest.js'
import { registerImprovementSubscriber } from './modules/improvements/subscriber.js'
import { links } from './context/links.js'
import { makePublish } from './events/publish.js'
import { registerModules } from './modules/loader.js'
import { consoleTransport, createEmailService } from './services/email.js'
import type { BootstrapWorkspace } from './modules/onboarding/routes.js'

export function createApp(config?: AppConfig): express.Express {
  const app = express()
  app.use(corsMiddleware(process.env.CORS_ORIGIN))
  app.use(express.json())
  app.use(healthRouter)
  if (config) {
    app.use(meRouter(config))

    // ---- Supabase clients ----
    const anon = anonClient(config)
    const service = serviceClient(config)

    // ---- Auth deps (shared) ----
    const authDeps = {
      getUser: async (token: string) => {
        const { data, error } = await anon.auth.getUser(token)
        if (error || !data.user) return null
        return { id: data.user.id, email: data.user.email ?? null }
      },
    }

    // ---- Workspace membership deps ----
    const workspaceDeps = {
      getMembership: supabaseMembershipLookup(config),
    }

    // ---- Completion store (service-role — calls the secure RPC) ----
    const completionStore = supabaseOnboardingCompletionStore(service)
    setOnboardingStore(completionStore)

    // ---- Email service ----
    const emailService = createEmailService(consoleTransport)

    // ---- Bootstrap route — GET /api/onboarding/bootstrap ----
    // Queries the user's visible workspaces + onboarding status via their JWT-scoped client
    const bRouter = bootstrapRouter({
      auth: authDeps,
      getUserWorkspaces: async (accessToken): Promise<BootstrapWorkspace[]> => {
        const db = userScopedClient(config, accessToken)
        // Query workspace_members to get workspaces the user belongs to
        const { data: members, error: mErr } = await db
          .from('workspace_members')
          .select('workspace_id, role, workspaces(id, name)')
        if (mErr) throw new Error(`bootstrap members: ${mErr.message}`)
        if (!members) return []

        const results: BootstrapWorkspace[] = []
        for (const m of members as Record<string, unknown>[]) {
          const ws = m.workspaces as Record<string, unknown> | null
          if (!ws) continue
          const workspaceId = ws.id as string
          // Check onboarding status
          const { data: session } = await db
            .from('onboarding_sessions')
            .select('status')
            .eq('workspace_id', workspaceId)
            .maybeSingle()
          let onboardingStatus: BootstrapWorkspace['onboardingStatus'] = 'not_started'
          if (session) {
            const st = (session as Record<string, unknown>).status as string
            onboardingStatus = st === 'completed' ? 'completed' : 'in_progress'
          }
          results.push({
            id: workspaceId,
            name: ws.name as string,
            role: m.role as string,
            onboardingStatus,
          })
        }
        return results
      },
    })
    app.use(bRouter)

    // ---- Feature registry isEnabled ----
    // Uses service client to check workspace_features (admins manage these, service bypasses RLS)
    const isEnabled = async (workspaceId: string, moduleId: string, _accessToken: string): Promise<boolean | null> => {
      const { data, error } = await service
        .from('workspace_features')
        .select('enabled')
        .eq('workspace_id', workspaceId)
        .eq('module_id', moduleId)
        .maybeSingle()
      if (error) return false
      // null = no row found; let the gate fall back to manifest.defaultEnabled
      return data ? (data as Record<string, unknown>).enabled === true : null
    }

    // ---- Onboarding: shared stores ----
    // onboardingStore uses service-role: session reads/writes are not tenant-data rows but
    // orchestration state; RLS on hub rows is enforced via the per-request hubStore below.
    const onboardingStore = supabaseOnboardingStore(service)

    // ---- Per-request onboarding service factory ----
    // hubStore is user-scoped per request so Postgres RLS enforces tenant isolation on Hub writes
    // (saveProfile/saveRules/saveIndustry/savePeople). onboardingStore stays service-role (see above).
    const makeOnboardingService = (token: string) =>
      createOnboardingService({
        hub: ContextHub,
        hubStore: supabaseHubStore(userScopedClient(config, token)),
        onboardingStore,
        completionStore, // service-role: calls the SECURITY DEFINER complete_onboarding RPC
        sendInvite: async (invite) => {
          await emailService.send(
            invite.email,
            'You have been invited to a workspace',
            'You have been invited to join workspace {{workspaceId}}. Your invite token is {{token}}.',
            { workspaceId: invite.workspaceId, token: invite.token }
          )
        },
      })

    // ---- Workspace creation helper ----
    const createWorkspaceAction = async (accessToken: string, name: string) => {
      // Call create_workspace via user JWT-scoped client (RLS enforces auth, function is security definer)
      const db = userScopedClient(config, accessToken)
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const { data, error } = await db.rpc('create_workspace', { p_name: name, p_slug: slug })
      if (error) throw new Error(`create_workspace: ${error.message}`)
      const ws = data as Record<string, unknown>
      const workspaceId = ws.id as string
      // Insert workspace_features for the onboarding module
      await service
        .from('workspace_features')
        .insert({ workspace_id: workspaceId, module_id: 'onboarding', enabled: true, enabled_at: new Date().toISOString() })
      return { workspaceId }
    }

    // ---- Event infrastructure ----
    const registry = createRegistry()
    const eventStore = supabaseEventStore(service)
    const publish = makePublish(service, eventStore, registry)
    // Note: registerImprovementSubscriber called after stores are built below

    // ---- Risk module ----
    // Per-request factory: each request gets a userScopedClient so Postgres RLS enforces tenant isolation.
    // publish stays service-role (it owns the outbox/dispatch).
    const makeRiskService = (token: string) =>
      createRiskService({
        store: supabaseRiskStore(userScopedClient(config, token)),
        publish,
        links,
        linkStore: supabaseLinkStore(userScopedClient(config, token)),
      })
    // Service-role riskStore for the improvement subscriber (background event handler, not user-initiated).
    const riskStore = supabaseRiskStore(service)

    // ---- Complaints module ----
    // Per-request factory: store and linkStore use userScopedClient so Postgres RLS enforces
    // tenant isolation. publish stays service-role (owns the outbox/dispatch).
    const makeComplaintsService = (token: string) =>
      createComplaintsService({
        store: supabaseComplaintsStore(userScopedClient(config, token)),
        publish,
        links,
        linkStore: supabaseLinkStore(userScopedClient(config, token)),
      })
    // service-role complaintsStore for the improvement subscriber (background event handler, not user-initiated)
    const complaintsStore = supabaseComplaintsStore(service)

    // ---- Improvements module ----
    // Per-request factory: store uses userScopedClient so Postgres RLS enforces tenant isolation.
    const makeImprovementsService = (token: string) =>
      createImprovementService({ store: supabaseImprovementsStore(userScopedClient(config, token)) })
    // service-role improvementsStore for the subscriber (background event handler, not user-initiated)
    const improvementsStore = supabaseImprovementsStore(service)

    // ---- Wire improvement subscriber (after all stores are built) ----
    registerImprovementSubscriber(
      registry,
      { riskStore, complaintStore: complaintsStore, improvementStore: improvementsStore },
      () => new Date(),
    )

    // ---- Register modules ----
    const manifest = createOnboardingManifest({
      makeService: makeOnboardingService,
      auth: authDeps,
      workspace: workspaceDeps,
      onboardingStore,
      createWorkspace: createWorkspaceAction,
    })

    const riskManifest = createRiskManifest({
      makeService: makeRiskService,
      auth: authDeps,
      workspace: workspaceDeps,
    })

    const complaintsManifest = createComplaintsManifest({
      makeService: makeComplaintsService,
      auth: authDeps,
      workspace: workspaceDeps,
    })

    const improvementsManifest = createImprovementsManifest({
      makeService: makeImprovementsService,
      auth: authDeps,
      workspace: workspaceDeps,
    })

    registerModules(app, [manifest, riskManifest, complaintsManifest, improvementsManifest], { isEnabled })
  }
  return app
}
