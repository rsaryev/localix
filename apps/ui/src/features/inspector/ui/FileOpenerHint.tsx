import { useState } from 'react'
import useSWR from 'swr'
import { opensFile, type ListingRef } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { useResourceGeneration } from '@/shared/api/resourceGeneration'
import { storeApi, type StoreClient } from '@/shared/api/store-client'
import { openStore } from '@/shared/lib/openStore'
import { hideFileKind, useHiddenFileKinds } from '../model/hiddenFileKinds'

/**
 * A file and an app in the Store that opens it, while nothing installed does: one line above the
 * file, "Documents opens this file", with Install. Over a binary Localix cannot show (a Word file,
 * a database) that is all; over a file the editor shows (a CSV), `inEditor` adds Keep in editor,
 * the other answer. An app that only also opens a kind (a reader that shows Markdown) declares it
 * ranked `None` and is not offered for it. It is the Store's answer for the file
 * (`/store/openers`, from what each mini app's `fileAssociations` declares), read again on every
 * Store poke, so an install that lands takes the line away. Nothing is said for a file no app
 * declares, or one an installed app already opens.
 *
 * Install installs what needs no yes (Localix's own); anything that must ask first opens its
 * Store page, where the person reads what it runs and says yes there. Hide is for the kind of
 * file, across launches (`hiddenFileKinds.ts`).
 */
const openPackageInStore = (ref: ListingRef) => openStore({ ref })

export function FileOpenerHint({
  path,
  client = storeApi,
  openPackage = openPackageInStore,
  inEditor = false,
}: {
  path: string
  client?: StoreClient
  openPackage?: (ref: ListingRef) => void
  /** The file is open in the code editor: staying there is an answer of its own. */
  inEditor?: boolean
}) {
  const generation = useResourceGeneration('store')
  const { data } = useSWR(['file-openers', path, generation], () => client.openers(path))
  const hidden = useHiddenFileKinds()
  const [busy, setBusy] = useState(false)
  const openers = data?.listings ?? []
  const best = openers[0]
  const kind = best?.opens?.find((one) => opensFile([one], path))
  if (!best || !kind || hidden.has(kind)) return null
  if (openers.some((listing) => listing.installs.length > 0)) return null

  const install = async () => {
    setBusy(true)
    try {
      const plan = await client.plan(best.ref, 'user')
      if (plan.needsConsent) openPackage(best.ref)
      else await client.install(best.ref, 'user', { plan: false })
    } catch {
      // The Store page says what went wrong, and offers it again.
      openPackage(best.ref)
    } finally {
      setBusy(false)
    }
  }
  const working = busy || Boolean(best.job)
  return (
    <WorkbenchNoticeBar
      role="status"
      title={`${best.displayName} opens this file`}
      description={best.summary}
      actionsLabel="File opener actions"
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={working}
            aria-label={`Install ${best.displayName}`}
            onClick={() => void install()}
          >
            {working ? 'Installing…' : `Install ${best.displayName}`}
          </Button>
          {inEditor && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="font-normal"
              onClick={() => hideFileKind(kind)}
            >
              Keep in editor
            </Button>
          )}
        </>
      }
      onDismiss={() => hideFileKind(kind)}
      dismissLabel={`Hide for .${kind} files`}
    />
  )
}
