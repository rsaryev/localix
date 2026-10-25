import { Archive } from 'lucide-react'
import type { Listing, ListingDetail } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { useStoreScope } from '../model/storeContext'

/**
 * WHAT THE PROVIDER WANTS THIS PAGE TO SAY NOW, with the one thing to do about it: a skill unused
 * for long and archived soon unless pinned. The action runs as the item's own action, so the page
 * names no provider; the `store` poke the write raises reads the page again.
 */
export function PackageNotice({
  listing,
  notice,
}: {
  listing: Listing
  notice: NonNullable<ListingDetail['notice']>
}) {
  const store = useStoreScope()
  const { action } = notice
  const scope = listing.installs[0]?.scope ?? 'user'
  return (
    <WorkbenchNoticeBar
      role="status"
      tone="warning"
      icon={<Archive className="size-3.5" />}
      title={notice.text}
      actions={
        action && (
          <Button
            size="sm"
            variant="secondary"
            title={action.help}
            onClick={() =>
              store.run(
                store.client.runAction(
                  listing.ref,
                  scope,
                  action.id,
                  scope === 'project' ? store.project?.id : undefined,
                ),
              )
            }
          >
            {action.label}
          </Button>
        )
      }
    />
  )
}
