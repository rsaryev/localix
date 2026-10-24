import { useState } from 'react'
import { Download, MonitorDown, Trash2 } from 'lucide-react'
import { hasUpdate, type Listing, type StoreJob } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { isBusy } from '../model/filters'

export const APP_HINT =
  'Also adds it as an app with its own window, Dock icon and place in Spotlight'

/** What the Store can do to a listing; `consent` is the person's yes to an unverified publisher. */
export interface ListingActions {
  onInstall: (listing: Listing, consent: boolean) => void
  onUpdate: (listing: Listing) => void
  onRemove: (listing: Listing) => void
}

const percent = (job: StoreJob) =>
  job.total ? Math.round(((job.received ?? 0) / job.total) * 100) : null

type Size = 'sm' | 'default'

/**
 * What a listing's state allows: how far its job is; Install, beside it Install as app where an
 * app of its own can be made (two named icons on a card, two buttons on its page); Update;
 * Remove; or why it cannot be installed. An unverified publisher's install asks "Install anyway?"
 * first, whichever choice it was, and only that yes is sent as consent.
 */
export function InstallAction({
  listing,
  onInstall,
  onUpdate,
  onRemove,
  onInstallAsApp,
  size = 'sm',
  removeAs = 'icon',
}: {
  listing: Listing
  /** Present only where an app of its own can be made for this listing. */
  onInstallAsApp?: (consent: boolean) => void
  size?: Size
  /** On a card the remove action is a quiet icon on hover; on a page it is a button. */
  removeAs?: 'icon' | 'button'
} & ListingActions) {
  const [confirming, setConfirming] = useState<null | 'store' | 'app'>(null)
  const label = listing.displayName
  const job = listing.job
  const installed = listing.installs.length > 0
  const update = hasUpdate(listing)
  if (job && isBusy(listing)) {
    const pct = job.phase === 'downloading' ? percent(job) : null
    return (
      <div className="flex w-32 items-center gap-2 text-2xs text-text-faint tabular-nums">
        <ProgressBar
          value={pct ?? (job.phase === 'queued' ? 4 : 92)}
          className="h-1 flex-1"
          fillClassName="bg-foreground/50"
          aria-label={`Installing ${label}`}
        />
        <span className="w-14 text-right">
          {job.phase === 'queued' ? 'Waiting' : pct !== null ? `${pct}%` : 'Installing'}
        </span>
      </div>
    )
  }
  if (listing.incompatible)
    return <span className="text-2xs text-text-faint">{listing.incompatible}</span>
  if (confirming)
    return (
      <div className="flex items-center gap-1">
        <span className="mr-1 text-2xs text-text-soft">Install anyway?</span>
        <Button size={size} variant="ghost" onClick={() => setConfirming(null)}>
          Cancel
        </Button>
        <Button
          size={size}
          variant="field"
          aria-label="Install anyway"
          onClick={() => {
            const choice = confirming
            setConfirming(null)
            if (choice === 'app') onInstallAsApp?.(true)
            else onInstall(listing, true)
          }}
        >
          Install
        </Button>
      </div>
    )
  if (installed && !update)
    return removeAs === 'button' ? (
      <Button size={size} variant="ghost" onClick={() => onRemove(listing)}>
        <Trash2 data-icon="inline-start" aria-hidden />
        Remove
      </Button>
    ) : (
      <IconButton
        size="sm"
        aria-label={`Remove ${label}`}
        className="opacity-0 group-hover/item-card:opacity-100 focus-visible:opacity-100"
        onClick={() => onRemove(listing)}
      >
        <Trash2 />
      </IconButton>
    )

  const trusted = listing.publisher.verified || installed
  const install = () => (trusted ? onInstall(listing, false) : setConfirming('store'))
  const installAsApp = () => (trusted ? onInstallAsApp?.(false) : setConfirming('app'))
  // An update, or a retry, is one action: the app of its own is for a first install.
  const offersApp = Boolean(onInstallAsApp) && !installed
  if (update || job?.phase === 'failed' || size === 'default')
    return (
      <div className="flex items-center gap-1">
        <Button
          size={size}
          variant={size === 'default' ? 'mono' : 'field'}
          onClick={update ? () => onUpdate(listing) : install}
        >
          {update ? 'Update' : job?.phase === 'failed' ? 'Try again' : 'Install'}
        </Button>
        {offersApp && !update && (
          <Button size={size} variant="ghost" title={APP_HINT} onClick={installAsApp}>
            <MonitorDown data-icon="inline-start" aria-hidden />
            Install as app
          </Button>
        )}
      </div>
    )
  // On a card: two quiet icons, each named, side by side.
  return (
    <div className="flex items-center gap-0.5">
      <IconButton size="sm" aria-label={`Install ${label}`} tooltip="Install" onClick={install}>
        <Download />
      </IconButton>
      {offersApp && (
        <IconButton
          size="sm"
          aria-label={`Install ${label} as an app`}
          tooltip={`Install as app — ${APP_HINT.toLowerCase()}`}
          onClick={installAsApp}
        >
          <MonitorDown />
        </IconButton>
      )}
    </div>
  )
}
