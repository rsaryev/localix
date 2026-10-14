import { ExternalLink, MonitorOff } from 'lucide-react'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { Button } from '@localixai/kit/button'
import { PaneStateOverlay } from '@localixai/kit/pane-state-overlay'
import { StateNotice } from '@localixai/kit/state-notice'

/**
 * The card shown in place of a site that refuses embedding (X-Frame-Options / a bot shield).
 * Nothing is mounted behind it, so the pane's own ground shows through: the notice keeps the
 * "No preview open" shape — a monitor glyph, a title, the actions. Offers Open in browser and,
 * when a probe-injecting proxy exists, the strip-proxy embedded view.
 */
export function PreviewBlockedOverlay({
  url,
  injectUrl,
  onEngage,
}: {
  url: string
  injectUrl?: string
  onEngage?: () => void
}) {
  // The host owns external navigation and its confirmation policy across all UI surfaces.
  const openInBrowser = () => platformCapabilities().external.open(url, true)
  return (
    <PaneStateOverlay material="plain">
      <StateNotice
        className="flex-none"
        icon={MonitorOff}
        title="This site can’t be embedded"
        actionsLabel="Preview actions"
        actions={
          <>
            <Button type="button" variant="mono" size="sm" onClick={openInBrowser}>
              <ExternalLink data-icon="inline-start" aria-hidden /> Open in browser
            </Button>
            {injectUrl && onEngage && (
              <Button type="button" variant="outline" size="sm" onClick={onEngage}>
                Try embedded view
              </Button>
            )}
          </>
        }
      />
    </PaneStateOverlay>
  )
}
