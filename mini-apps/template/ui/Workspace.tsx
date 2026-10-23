import type { PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { SystemOverview } from './system/SystemOverview'

/**
 * The domain's root component. Its path and export name are fixed in every copy because the
 * frame's registration (`register.tsx`) imports it; what it renders is the copy's own.
 */
export function Workspace({
  active = true,
  publishMessageContext,
}: {
  active?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  return (
    // A dashboard scrolls on one axis. Anything wider than the pane (a table) owns its
    // own horizontal scroller, so the root never grows one of its own.
    <div className="@container h-full min-h-0 overflow-x-hidden overflow-y-auto">
      <SystemOverview active={active} publishMessageContext={publishMessageContext} />
    </div>
  )
}
