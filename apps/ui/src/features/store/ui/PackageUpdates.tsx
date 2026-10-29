import { useId, useState } from 'react'
import type { Listing } from '@localixai/store'
import { Switch } from '@localixai/kit/switch'
import { useStoreScope } from '../model/storeContext'

/**
 * How an installed package takes its updates (`docs/extending/mini-app-publishing.md`, "Signing"):
 * from a signed catalog on its own, with a switch to stop that; from an unsigned one only when the
 * person chooses Update; from a catalog whose signature changed, not at all.
 */
export function PackageUpdates({ listing }: { listing: Listing }) {
  const store = useStoreScope()
  const captionId = useId()
  // The press shows at once; the listing takes over once it agrees, and the press is undone if
  // the write is refused.
  const [pressed, setPressed] = useState<boolean | null>(null)
  if (pressed !== null && listing.autoUpdate === pressed) setPressed(null)
  const installed = listing.installs.length > 0

  if (listing.signature === 'mismatch')
    return (
      <p className="max-w-md text-sm text-text-soft">
        Its catalog’s signature changed, so nothing is installed or updated from it. If the
        publisher moved to a new key, remove the catalog in Sources and add it again.
      </p>
    )
  if (!installed) return null
  if (listing.autoUpdate === undefined)
    return listing.signature === 'unsigned' ? (
      <p className="max-w-md text-sm text-text-soft">
        Its catalog is not signed, so it updates only when you choose Update.
      </p>
    ) : null

  const switchTo = (on: boolean) => {
    const write = store.client.setAutoUpdate(listing.ref, on)
    setPressed(on)
    write.catch(() => setPressed(null))
    store.run(write)
  }
  return (
    <div className="flex max-w-md items-center justify-between gap-4 text-sm">
      <span id={captionId} className="flex flex-col gap-0.5">
        <span className="text-foreground">Update automatically</span>
        <span className="text-xs text-text-soft">
          Its catalog is signed: newer versions install on their own.
        </span>
      </span>
      <Switch
        size="sm"
        checked={pressed ?? listing.autoUpdate}
        aria-label={`Update automatically ${listing.displayName}`}
        aria-describedby={captionId}
        onChange={(event) => switchTo(event.target.checked)}
      />
    </div>
  )
}
