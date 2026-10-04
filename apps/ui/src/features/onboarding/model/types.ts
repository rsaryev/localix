import type { FC } from 'react'

/** Props every onboarding step receives from the wizard shell. */
export interface OnboardingStepProps {
  /** Advance to the next step (or finish the wizard if this is the last step). */
  onComplete: () => void
  /** Skip the rest of onboarding entirely (marks it done — re-openable later). */
  onSkip: () => void
  /**
   * Jump to any ALREADY-VISITED step by id (a no-op for a never-seen step, so a
   * step can't teleport the user forward past setup it hasn't done). Used by the
   * final activation summary to send an unwired user back to Provider.
   */
  onJumpTo: (stepId: string) => void
}

/** One registered onboarding step. Add steps to ONBOARDING_STEPS — the shell is agnostic. */
export interface OnboardingStep {
  id: string
  /** Short label shown in the rail step list and under the mobile progress dots. */
  title: string
  /** One-line description shown beside the title in the left rail. */
  description: string
  /** Opt into a wider content column (for list/grid-heavy steps like Provider). */
  wide?: boolean
  Component: FC<OnboardingStepProps>
}
