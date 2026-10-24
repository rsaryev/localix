import { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { hasUpdate, type Listing, type StoreJob } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import { isBusy } from '../model/filters'
import { inSentence, KIND_LABELS } from '../model/presentation'

/** An install extra this listing can have, and what choosing it does (`consent` as for Install). */
export interface ExtraChoice {
  extra: StoreInstallExtra
  choose: (consent: boolean) => void
}

/** What the Store can do to a listing; `consent` is the person's yes to an unverified publisher. */
export interface ListingActions {
  onInstall: (listing: Listing, consent: boolean) => void
  onUpdate: (listing: Listing) => void
  onRemove: (listing: Listing) => void
}

const percent = (job: StoreJob) =>
  job.total ? Math.round(((job.received ?? 0) / job.total) * 100) : null

type Size = 'sm' | 'default'

const NO_EXTRAS: readonly ExtraChoice[] = []

/**
 * What a listing's state allows: how far its job is; Install, beside it each install extra it
 * can have, such as Install as app (named icons side by side on a card, labelled buttons on its
 * page); Update; Remove; or why it cannot be installed. An unverified publisher's install asks
 * "Install anyway?" first, whichever choice it was, and only that yes is sent as consent.
 */
export function InstallAction({
  listing,
  onInstall,
  onUpdate,
  onRemove,
  extras = NO_EXTRAS,
  size = 'sm',
  removeAs = 'icon',
  whole = false,
}: {
  listing: Listing
  /** The install extras this listing can have here. */
  extras?: readonly ExtraChoice[]
  size?: Size
  /** On a card the remove action is a quiet icon on hover; on a page it is a button. */
  removeAs?: 'icon' | 'button'
  /**
   * Acting from one of its components rather than the package itself: the install names the
   * package it installs whole, and an install already here is said, not removed from there.
   */
  whole?: boolean
} & ListingActions) {
  // Which choice waits for "Install anyway?": the plain install, or an extra by its id.
  const [confirming, setConfirming] = useState<null | 'store' | { extra: string }>(null)
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
            if (choice === 'store') onInstall(listing, true)
            else extras.find(({ extra }) => extra.id === choice.extra)?.choose(true)
          }}
        >
          Install
        </Button>
      </div>
    )
  if (installed && !update && whole)
    return <span className="px-2 text-2xs text-text-faint">Installed</span>
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
  const pick = ({ extra, choose }: ExtraChoice) =>
    trusted ? choose(false) : setConfirming({ extra: extra.id })
  // An update, or a retry, is one action: an extra is for a first install.
  const offered = installed ? [] : extras
  if (update || job?.phase === 'failed' || size === 'default')
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button
          size={size}
          variant={size === 'default' ? 'mono' : 'field'}
          onClick={update ? () => onUpdate(listing) : install}
        >
          {update ? 'Update' : job?.phase === 'failed' ? 'Try again' : 'Install'}
        </Button>
        {!update &&
          offered.map((choice) => (
            <Button
              key={choice.extra.id}
              size={size}
              variant="ghost"
              title={choice.extra.hint}
              onClick={() => pick(choice)}
            >
              <choice.extra.icon data-icon="inline-start" aria-hidden />
              {choice.extra.label}
            </Button>
          ))}
      </div>
    )
  if (whole)
    return (
      <Button
        size={size}
        variant="field"
        aria-label={`Install the ${inSentence(KIND_LABELS[listing.ref.kind].one)} ${label}`}
        onClick={install}
      >
        Install {label}
      </Button>
    )
  // On a card: quiet icons side by side, each named.
  return (
    <div className="flex items-center gap-0.5">
      <IconButton size="sm" aria-label={`Install ${label}`} tooltip="Install" onClick={install}>
        <Download />
      </IconButton>
      {offered.map((choice) => (
        <IconButton
          key={choice.extra.id}
          size="sm"
          aria-label={`${choice.extra.label}: ${label}`}
          tooltip={`${choice.extra.label} — ${choice.extra.hint.toLowerCase()}`}
          onClick={() => pick(choice)}
        >
          <choice.extra.icon />
        </IconButton>
      ))}
    </div>
  )
}
