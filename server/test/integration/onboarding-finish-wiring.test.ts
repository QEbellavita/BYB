import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { loadConfig } from '../../src/config.js'
import { anonClient, serviceClient } from '../../src/supabase.js'
import { createApp } from '../../src/app.js'

const config = loadConfig()
const app = createApp(config)
const ts = Date.now()
const email = `onb-http-${ts}@test.dev`
const password = 'Test-pass-123456'
let token: string
let userId: string
let workspaceId: string

beforeAll(async () => {
  const admin = serviceClient(config)
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  const { data, error: sErr } = await anonClient(config).auth.signInWithPassword({ email, password })
  if (sErr || !data.session) throw new Error(`sign-in: ${sErr?.message}`)
  token = data.session.access_token
  userId = data.session.user.id
})

afterAll(async () => {
  const admin = serviceClient(config)
  if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
  if (userId) await admin.auth.admin.deleteUser(userId)
})

describe('Onboarding finish — real app wiring (regression for C1)', () => {
  it('completes the full wizard through HTTP routes and finish returns 200', async () => {
    // 1. Create workspace (gate-exempt, auth only)
    const wsRes = await request(app)
      .post('/api/m/onboarding/workspace')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `HTTP Co ${ts}` })
    expect(wsRes.status).toBe(201)
    workspaceId = wsRes.body.workspaceId
    const h = { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId }

    // 2. Steps (bodies mirror onboarding.test.ts payloads)
    expect((await request(app).put('/api/m/onboarding/profile').set(h)
      .send({ name: 'HTTP Corp', jurisdiction: 'AU', size: 'small', description: 'integration wiring test co' })).status).toBe(200)
    expect((await request(app).put('/api/m/onboarding/rules').set(h)
      .send([
        { ruleType: 'business_rule', area: 'Finance', statement: 'Invoices signed off by a manager', operator: null, value: null, consequence: 'rejected', appliesTo: ['manager'] },
        { ruleType: 'must_do', area: 'HR', statement: 'Staff complete onboarding training', operator: null, value: null, consequence: 'revoked', appliesTo: ['staff'] },
      ])).status).toBe(200)
    expect((await request(app).put('/api/m/onboarding/industry').set(h)
      .send({ anzsicCode: '7000', obligations: [{ name: 'Fair Work', description: 'comply' }] })).status).toBe(200)
    expect((await request(app).put('/api/m/onboarding/people').set(h)
      .send([{ personName: 'Bob', title: 'Ops Mgr', email: `bob-${ts}@http-corp.test`, responsibilities: ['ops'], role: 'manager', accessScope: { modules: ['operations'] }, invite: true }])).status).toBe(200)

    // 3. Finish — THIS is the regression. Pre-fix: 500 "must be authenticated". Post-fix: 200.
    const finishRes = await request(app).post('/api/m/onboarding/finish').set(h).send({})
    expect(finishRes.status).toBe(200)
    expect(finishRes.body.workspaceId).toBe(workspaceId)

    // 4. Confirm session completed (service client, bypasses RLS for assertion only)
    const admin = serviceClient(config)
    const { data: sessions } = await admin.from('onboarding_sessions').select('status').eq('workspace_id', workspaceId)
    expect(sessions?.[0]?.status).toBe('completed')
  }, 15000)
})
