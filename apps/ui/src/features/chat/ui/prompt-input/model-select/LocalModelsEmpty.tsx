import { Download } from 'lucide-react'
import type { ModelKind } from '@localixai/agent/catalog'
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { inspector } from '@/shared/lib/inspectorBus'
import { navigateSettings } from '@/shared/lib/settingsNavBus'

/** Where local models are found and downloaded: Settings → Models → Local. */
export function openLocalModelsSettings(): void {
  // Open first, then navigate: the target is latched, so the panel applies it once mounted.
  inspector.openSettings()
  navigateSettings('models')
}

/**
 * The Local provider's list with nothing of the workload's kind downloaded: the picker lists
 * only what is on this computer, so the empty list says where models are got, and links there.
 */
export function LocalModelsEmpty({
  kind,
  onNavigate,
}: {
  kind: ModelKind
  /** Close the picker before Settings opens. */
  onNavigate?: () => void
}) {
  return (
    <EmptyHint className="flex-1 text-xs">
      {kind === 'embedding'
        ? 'No embedding models on this computer yet.'
        : 'No models on this computer yet.'}
      <span className="mt-3 block">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onNavigate?.()
            openLocalModelsSettings()
          }}
        >
          <Download aria-hidden="true" />
          Get models
        </Button>
      </span>
    </EmptyHint>
  )
}
