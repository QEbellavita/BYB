export interface AppConfig {
  port: number
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey: string
  email: {
    provider: 'console' | 'resend'
    resendApiKey?: string
    from?: string
    timeoutMs: number
  }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function loadEmailConfig(): AppConfig['email'] {
  const provider = process.env.EMAIL_PROVIDER ?? 'console'
  if (provider !== 'console' && provider !== 'resend') {
    throw new Error(`Invalid EMAIL_PROVIDER: "${provider}" (expected "console" or "resend")`)
  }
  const timeoutMs = Number(process.env.EMAIL_TIMEOUT_MS ?? 10000)
  if (Number.isNaN(timeoutMs)) {
    throw new Error('Invalid EMAIL_TIMEOUT_MS: must be a number')
  }
  if (provider === 'resend') {
    const resendApiKey = required('RESEND_API_KEY')
    const from = required('EMAIL_FROM')
    return { provider, resendApiKey, from, timeoutMs }
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[email] EMAIL_PROVIDER is "console" in production — invite emails will NOT be delivered; set EMAIL_PROVIDER=resend')
  }
  return { provider: 'console', timeoutMs }
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3001),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseAnonKey: required('SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    email: loadEmailConfig(),
  }
}
