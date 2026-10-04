import type { ReactNode } from 'react'
import { ArrowLeft, Info, X } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { CatalogModel } from '@localixai/agent/catalog'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { ModelDetailPanel } from './ModelDetailPanel'

interface ModelDetailsSidePanelProps {
  /**
   * `column`: the right-hand column of a wide drawer (lg and up).
   * `view`: the same panel in place of the model list on a narrower one, where there is no
   * room for a fourth column but the model's settings must still be reachable.
   */
  variant?: 'column' | 'view'
  showDetails: boolean
  detailModel: CatalogModel | null
  detailProviderDoc: string | undefined
  /** Per-model settings (the reasoning level), shown as the panel's first section. */
  settings?: ReactNode
  onClose: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

/**
 * The model's details and settings. Props in, callbacks out.
 *
 * Settings live here and nowhere else — not as a popover on the row. That popover covered
 * other rows (which then highlighted under it, and could be picked by mistake), and it made
 * this hover-driven panel lose its hover and collapse under the pointer. A panel the user can
 * keep open is the place a growing set of per-model settings can live.
 */
export function ModelDetailsSidePanel({
  variant = 'column',
  showDetails,
  detailModel,
  detailProviderDoc,
  settings,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: ModelDetailsSidePanelProps) {
  const column = variant === 'column'
  return (
    <div
      data-slot="model-details"
      data-variant={variant}
      className={cn(
        'flex flex-col overflow-hidden',
        column
          ? cn(
              'shrink-0 transition-[width,opacity] duration-(--dur-base) max-lg:hidden',
              // The border belongs to the OPEN state. With `box-sizing: border-box`, a
              // collapsed `w-0` panel that keeps a 1px border still occupies 1px of the row.
              showDetails
                ? 'w-64 border-l border-border-soft opacity-100 xl:w-70'
                : 'pointer-events-none w-0 opacity-0',
            )
          : 'min-h-0 flex-1 lg:hidden',
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {showDetails && (
        <>
          <PanelHeader
            tone="content"
            title="Model details"
            actions={
              column ? (
                <IconButton
                  size="sm"
                  aria-label="Close model details"
                  onClick={onClose}
                  tooltip="Close model details"
                >
                  <X />
                </IconButton>
              ) : (
                <Button variant="ghost" size="sm" onClick={onClose}>
                  <ArrowLeft data-icon="inline-start" />
                  Models
                </Button>
              )
            }
          />
          {detailModel ? (
            <ModelDetailPanel
              model={detailModel}
              providerDoc={detailProviderDoc}
              settings={settings}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-3 text-center">
              <Info className="size-5 text-text-faint" />
              <span className="text-2xs text-text-faint">Hover a model to see details</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
