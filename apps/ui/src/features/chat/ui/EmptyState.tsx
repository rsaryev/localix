import { BirdStage } from '@/shared/ui/BirdStage'
import { useBirdStill } from './useBirdStill'

interface EmptyStateProps {
  /**
   * Whether a provider connection exists. When false (e.g. onboarding skipped),
   * a pointer to the model menu is surfaced. Defaults to true so surfaces without
   * connection context (the editor-grid empty workspace) stay clean.
   */
  hasConnection?: boolean
}

export function EmptyState({ hasConnection = true }: EmptyStateProps) {
  const still = useBirdStill()

  return (
    <div className="flex flex-1 select-none flex-col items-center justify-center px-4 py-8">
      <BirdStage still={still} cycles={Infinity} lineCount={10} />

      {!hasConnection && (
        /* No connection — point to the model menu, where providers are connected. */
        <p className="mt-5 text-sm text-text-faint">Pick a provider from the model menu below.</p>
      )}
    </div>
  )
}
