import { createClient } from '@supabase/supabase-js'

// Fall back to harmless placeholders when env vars aren't set (e.g. design
// preview without a local Supabase). The client constructs fine; only live
// auth calls fail, which the app already handles gracefully.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'http://127.0.0.1:54331'
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'public-anon-placeholder'

export const supabase = createClient(url, anon)
