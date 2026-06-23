import { supabase } from '../supabase'

export async function enrollTotp() {
  return supabase.auth.mfa.enroll({ factorType: 'totp' })
}

export async function challengeAndVerify(factorId: string, code: string) {
  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError) return { data: null, error: challengeError }
  return supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code })
}

export async function listFactors() {
  return supabase.auth.mfa.listFactors()
}

export async function unenroll(factorId: string) {
  return supabase.auth.mfa.unenroll({ factorId })
}

export async function getAAL() {
  return supabase.auth.mfa.getAuthenticatorAssuranceLevel()
}
