import { ArrowRight } from 'lucide-react'
import { useTheme } from '@/shared/theme/useTheme'
import { BirdStage } from '@/shared/ui/BirdStage'
import { StepHeader } from '../StepHeader'
import { StepActions } from '../wizard/StepActions'
import type { OnboardingStepProps } from '../../model/types'

/**
 * First step — a warm, centered welcome hero before any setup. Pure intro: no
 * inputs, one primary action that advances to the next step.
 */
export function WelcomeStep({ onComplete }: OnboardingStepProps) {
  const { resolvedTheme } = useTheme()

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <BirdStage
        resolvedTheme={resolvedTheme}
        stageClassName="size-40"
        birdClassName="size-20"
        spread={250}
      />
      <StepHeader
        title="Welcome to Localix"
        subtitle="Connect one provider, choose a model, and start your first session."
      />
      <StepActions className="mt-1" onClick={onComplete}>
        Get started <ArrowRight className="size-4" />
      </StepActions>
    </div>
  )
}
