/**
 * seed-admin.ts — create (or refresh) a local admin tester account.
 *
 * Idempotent. Creates a confirmed auth user, a workspace with that user as
 * `owner` (owner has all permissions), and a *completed* onboarding session so
 * the web app loads straight to the ready state — no OTP email, no wizard.
 *
 * Run from the repo root:  npm run seed:admin
 * Override the defaults:    ADMIN_EMAIL=me@test.dev ADMIN_PASSWORD=... npm run seed:admin
 *
 * Requires local Supabase running (`supabase start`) and SUPABASE_* env vars
 * (loaded via --env-file=../.env in the npm script).
 */
import { loadConfig } from '../src/config.js'
import { anonClient, serviceClient, userScopedClient } from '../src/supabase.js'

const EMAIL = (process.env.ADMIN_EMAIL ?? 'admin@bytg.test').toLowerCase()
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin-tester-123456'
const WORKSPACE_NAME = process.env.ADMIN_WORKSPACE ?? 'Admin Tester Co'
const WORKSPACE_SLUG = process.env.ADMIN_WORKSPACE_SLUG ?? 'admin-tester'

async function main() {
  const config = loadConfig()
  const admin = serviceClient(config)

  // 1. Ensure the auth user exists, is confirmed, and has the known password.
  let userId: string | undefined
  {
    // createUser is the simplest idempotency check: if it already exists we
    // fall through to fetch + update the password.
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) {
      // Already registered — look it up and reset the password so the known
      // credentials always work.
      const { data: list, error: listErr } = await admin.auth.admin.listUsers()
      if (listErr) throw new Error(`listUsers failed: ${listErr.message}`)
      const existing = list.users.find((u) => u.email?.toLowerCase() === EMAIL)
      if (!existing) throw new Error(`createUser failed and user not found: ${error.message}`)
      userId = existing.id
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password: PASSWORD,
        email_confirm: true,
      })
      if (updErr) throw new Error(`updateUser failed: ${updErr.message}`)
      console.log(`• Reusing existing user ${EMAIL} (${userId})`)
    } else {
      userId = data.user?.id
      console.log(`• Created user ${EMAIL} (${userId})`)
    }
  }
  if (!userId) throw new Error('could not resolve admin user id')

  // 2. Sign in to get a JWT, then create a workspace under RLS (the creator is
  //    auto-assigned the `owner` role by the create_workspace RPC).
  const { data: signIn, error: signErr } = await anonClient(config).auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  })
  if (signErr || !signIn.session) throw new Error(`sign-in failed: ${signErr?.message}`)
  const token = signIn.session.access_token
  const db = userScopedClient(config, token)

  // Reuse an existing workspace for this user if one is already seeded.
  const { data: members } = await db
    .from('workspace_members')
    .select('workspace_id, role, workspaces(id, name)')
    .eq('role', 'owner')
  let workspaceId = (members ?? [])
    .map((m) => (m.workspaces as { id: string; name: string } | null))
    .find((w) => w?.name === WORKSPACE_NAME)?.id

  if (!workspaceId) {
    const slug = `${WORKSPACE_SLUG}-${userId.slice(0, 8)}`
    const { data: ws, error: wErr } = await db.rpc('create_workspace', {
      p_name: WORKSPACE_NAME,
      p_slug: slug,
    })
    if (wErr) throw new Error(`create_workspace failed: ${wErr.message}`)
    workspaceId = (ws as { id: string }).id
    console.log(`• Created workspace "${WORKSPACE_NAME}" (${workspaceId})`)
  } else {
    console.log(`• Reusing workspace "${WORKSPACE_NAME}" (${workspaceId})`)
  }

  // 3. Mark onboarding completed (service role bypasses RLS + RPC validations)
  //    so the app skips the wizard and loads the ready state directly.
  const { error: sessErr } = await admin
    .from('onboarding_sessions')
    .upsert(
      {
        workspace_id: workspaceId,
        status: 'completed',
        current_step: 'review',
        completed_steps: ['profile', 'rules', 'industry', 'people'],
        started_by: userId,
        completed_by: userId,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    )
  if (sessErr) throw new Error(`onboarding session upsert failed: ${sessErr.message}`)
  console.log('• Onboarding marked completed')

  console.log('\n✅ Admin tester ready. Sign in at the web app with:')
  console.log(`   email:    ${EMAIL}`)
  console.log(`   password: ${PASSWORD}`)
  console.log('   (or click "Sign in as admin tester" on the dev login screen)\n')
}

main().catch((err) => {
  console.error('\n❌ seed-admin failed:', err.message)
  process.exit(1)
})
