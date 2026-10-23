import { useId, useMemo, type ComponentProps } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Stable DOM relationship ids for any tab implementation built on these primitives. */
export function useTabPanelIds(scope = 'tabs') {
  const reactId = useId()
  return useMemo(() => {
    const prefix = `${reactId}-${encodeURIComponent(scope)}`
    return {
      tabId: (id: string) => `${prefix}-tab-${encodeURIComponent(id)}`,
      panelId: (id: string) => `${prefix}-panel-${encodeURIComponent(id)}`,
      item: (id: string) => ({
        tabId: `${prefix}-tab-${encodeURIComponent(id)}`,
        panelId: `${prefix}-panel-${encodeURIComponent(id)}`,
      }),
    }
  }, [reactId, scope])
}

export type TabPanelProps = Omit<ComponentProps<'div'>, 'id' | 'aria-labelledby' | 'hidden'> & {
  /** DOM id referenced by the owning tab's `aria-controls`. */
  id: string
  /** DOM id of the owning tab. */
  'aria-labelledby': string
  /** Inactive panels stay mounted for editor/view-state preservation but leave the a11y tree. */
  active: boolean
}

/**
 * Accessible, keep-alive panel paired with a `TabBar` or `TabStrip` item.
 *
 * Keeping the wrapper mounted preserves editor cursors, scroll positions and live
 * plugin state; the native `hidden` attribute removes inactive content from both
 * layout and the accessibility tree without inventing a second state mechanism.
 */
export function TabPanel({ active, className, ...props }: TabPanelProps) {
  return (
    <div
      data-slot="tab-panel"
      role="tabpanel"
      hidden={!active}
      className={cn('min-h-0 min-w-0', !active && 'hidden', className)}
      {...props}
    />
  )
}
