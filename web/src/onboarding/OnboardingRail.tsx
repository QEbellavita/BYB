import type { OnboardingStep } from './types'

const STEP_ORDER: OnboardingStep[] = ['profile', 'rules', 'industry', 'people', 'review']
const STEP_LABELS: Record<OnboardingStep, string> = {
  profile: 'Profile',
  rules: 'Rules',
  industry: 'Industry',
  people: 'People',
  review: 'Review',
}

interface OnboardingRailProps {
  currentStep: OnboardingStep
  completedSteps: OnboardingStep[]
  onSelect: (step: OnboardingStep) => void
}

export function OnboardingRail({ currentStep, completedSteps, onSelect }: OnboardingRailProps) {
  return (
    <div className="onboarding-rail">
      <nav aria-label="Onboarding progress">
        {STEP_ORDER.map((step, idx) => {
          const isActive = step === currentStep
          const isCompleted = completedSteps.includes(step)
          // A step is enabled if it's already completed, it's the current step,
          // or all preceding required steps are completed.
          const precedingSteps = STEP_ORDER.slice(0, idx)
          const allPrecedingComplete = precedingSteps.every((s) => completedSteps.includes(s))
          const isEnabled = isCompleted || isActive || allPrecedingComplete

          const classes = [
            isActive ? 'active' : '',
            isCompleted && !isActive ? 'completed' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <button
              key={step}
              className={classes || undefined}
              disabled={!isEnabled}
              onClick={() => isEnabled && onSelect(step)}
              aria-current={isActive ? 'step' : undefined}
            >
              {STEP_LABELS[step]}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
