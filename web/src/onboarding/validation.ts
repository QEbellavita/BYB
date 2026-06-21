// Client-side validation helpers for the onboarding wizard.
// Kept minimal — Task 7/8 will expand these as step-specific forms are built.

import type { ProfileInput } from './types'

export function validateProfile(input: Partial<ProfileInput>): string[] {
  const errors: string[] = []
  if (!input.name || input.name.trim().length === 0) {
    errors.push('Name is required')
  }
  return errors
}

export function isProfileValid(input: Partial<ProfileInput>): boolean {
  return validateProfile(input).length === 0
}
