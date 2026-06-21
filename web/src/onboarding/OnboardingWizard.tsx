import { useState } from 'react'
import { onboardingApi } from './api'
import { OnboardingRail } from './OnboardingRail'
import { ProfileStep } from './steps/ProfileStep'
import { RulesStep } from './steps/RulesStep'
import { IndustryStep } from './steps/IndustryStep'
import { PeopleStep } from './steps/PeopleStep'
import { ReviewStep } from './steps/ReviewStep'
import type { OnboardingSnapshot, OnboardingStep, RuleInput } from './types'
import './onboarding.css'

interface OnboardingWizardProps {
  token: string
  workspaceId: string | null
  snapshot: OnboardingSnapshot | null
  onWorkspaceCreated: (id: string) => void
  onComplete: () => void
  /** Legacy single-instance injection (kept for backward compat with existing tests) */
  api?: ReturnType<typeof onboardingApi>
  /** Factory injection — preferred; overrides api if both provided */
  makeApi?: (workspaceId?: string) => ReturnType<typeof onboardingApi>
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function OnboardingWizard({
  token,
  workspaceId: initialWorkspaceId,
  snapshot,
  onWorkspaceCreated,
  onComplete,
  api: injectedApi,
  makeApi: injectedMakeApi,
}: OnboardingWizardProps) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId)
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(
    snapshot?.session?.current_step ?? 'profile',
  )
  const [completedSteps, setCompletedSteps] = useState<OnboardingStep[]>(
    snapshot?.session?.completed_steps ?? [],
  )
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  // Resolve raw factory: prefer injectedMakeApi, then wrap injectedApi, then real factory
  function resolveFactory(): (wsId?: string) => ReturnType<typeof onboardingApi> {
    if (injectedMakeApi) return injectedMakeApi
    if (injectedApi) return (_wsId?: string) => injectedApi
    return (wsId?: string) => onboardingApi(token, wsId)
  }

  const factory = resolveFactory()

  function handleWorkspaceCreated(id: string) {
    setWorkspaceId(id)
    onWorkspaceCreated(id)
  }

  function applySnapshot(snap: OnboardingSnapshot) {
    setCurrentStep(snap.session.current_step)
    setCompletedSteps(snap.session.completed_steps)
    if (snap.session.current_step === 'review' &&
        snap.session.completed_steps.length >= 4) {
      setTimeout(() => onComplete(), 0)
    }
  }

  function makeTrackedApi(wsId: string | null) {
    const base = factory(wsId ?? undefined)
    return {
      ...base,
      saveProfile: async (body: Parameters<typeof base.saveProfile>[0]) => {
        setSaveStatus('saving')
        try {
          const snap = await base.saveProfile(body)
          setSaveStatus('saved')
          return snap
        } catch (err) {
          setSaveStatus('error')
          throw err
        }
      },
      saveRules: async (body: Parameters<typeof base.saveRules>[0]) => {
        setSaveStatus('saving')
        try {
          const snap = await base.saveRules(body)
          setSaveStatus('saved')
          return snap
        } catch (err) {
          setSaveStatus('error')
          throw err
        }
      },
      saveIndustry: async (body: Parameters<typeof base.saveIndustry>[0]) => {
        setSaveStatus('saving')
        try {
          const snap = await base.saveIndustry(body)
          setSaveStatus('saved')
          return snap
        } catch (err) {
          setSaveStatus('error')
          throw err
        }
      },
      savePeople: async (body: Parameters<typeof base.savePeople>[0]) => {
        setSaveStatus('saving')
        try {
          const snap = await base.savePeople(body)
          setSaveStatus('saved')
          return snap
        } catch (err) {
          setSaveStatus('error')
          throw err
        }
      },
    }
  }

  const trackedApi = makeTrackedApi(workspaceId)

  // Profile-specific tracked factory: wraps saveProfile with status tracking
  // but uses the factory for per-wsId binding (fixes the null-workspace bug)
  function makeProfileTrackedFactory(wsId?: string) {
    const base = factory(wsId)
    return {
      ...base,
      saveProfile: async (body: Parameters<typeof base.saveProfile>[0]) => {
        setSaveStatus('saving')
        try {
          const snap = await base.saveProfile(body)
          setSaveStatus('saved')
          return snap
        } catch (err) {
          setSaveStatus('error')
          throw err
        }
      },
    }
  }

  function handleStepSave(snap: OnboardingSnapshot) {
    applySnapshot(snap)
  }

  const initialRules: RuleInput[] = (snapshot?.rules ?? []).map((r) => r as unknown as RuleInput)

  return (
    <div data-testid="onboarding-wizard" className="onboarding-layout">
      <OnboardingRail
        currentStep={currentStep}
        completedSteps={completedSteps}
        onSelect={setCurrentStep}
      />

      <main className="onboarding-main">
        <h1>Set up your workspace</h1>

        <div aria-live="polite" className="autosave-status">
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Error saving — please try again'}
        </div>

        {currentStep === 'profile' && (
          <ProfileStep
            token={token}
            workspaceId={workspaceId}
            makeApi={makeProfileTrackedFactory}
            onSave={handleStepSave}
            onWorkspaceCreated={handleWorkspaceCreated}
          />
        )}

        {currentStep === 'rules' && (
          <RulesStep
            token={token}
            workspaceId={workspaceId}
            initialRules={initialRules}
            api={trackedApi}
            onSave={handleStepSave}
          />
        )}

        {currentStep === 'industry' && (
          <IndustryStep
            token={token}
            workspaceId={workspaceId}
            api={trackedApi}
            onSave={handleStepSave}
          />
        )}

        {currentStep === 'people' && (
          <PeopleStep
            token={token}
            workspaceId={workspaceId}
            api={trackedApi}
            onSave={handleStepSave}
          />
        )}

        {currentStep === 'review' && snapshot && (
          <ReviewStep
            token={token}
            workspaceId={workspaceId}
            snapshot={snapshot}
            api={trackedApi}
            onComplete={onComplete}
          />
        )}

        {currentStep === 'review' && !snapshot && (
          <div>
            <h2>Review</h2>
            <p>Loading review data…</p>
          </div>
        )}
      </main>
    </div>
  )
}
