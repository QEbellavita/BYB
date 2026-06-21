import { apiFetch } from '../api'
import type {
  BootstrapResult,
  CreateWorkspaceResult,
  FinishResult,
  IndustryInput,
  OnboardingSnapshot,
  PersonInput,
  ProfileInput,
  RuleInput,
} from './types'

export function onboardingApi(token: string, workspaceId?: string) {
  return {
    bootstrap: () =>
      apiFetch<BootstrapResult>('/api/onboarding/bootstrap', token),

    createWorkspace: (name: string) =>
      apiFetch<CreateWorkspaceResult>('/api/m/onboarding/workspace', token, {
        method: 'POST',
        body: { name },
      }),

    load: () =>
      apiFetch<OnboardingSnapshot>('/api/m/onboarding/session', token, { workspaceId }),

    saveProfile: (body: ProfileInput) =>
      apiFetch<OnboardingSnapshot>('/api/m/onboarding/profile', token, {
        method: 'PUT',
        workspaceId,
        body,
      }),

    saveRules: (body: RuleInput[]) =>
      apiFetch<OnboardingSnapshot>('/api/m/onboarding/rules', token, {
        method: 'PUT',
        workspaceId,
        body,
      }),

    saveIndustry: (body: IndustryInput) =>
      apiFetch<OnboardingSnapshot>('/api/m/onboarding/industry', token, {
        method: 'PUT',
        workspaceId,
        body,
      }),

    savePeople: (body: PersonInput[]) =>
      apiFetch<OnboardingSnapshot>('/api/m/onboarding/people', token, {
        method: 'PUT',
        workspaceId,
        body,
      }),

    finish: () =>
      apiFetch<FinishResult>('/api/m/onboarding/finish', token, {
        method: 'POST',
        workspaceId,
      }),
  }
}
