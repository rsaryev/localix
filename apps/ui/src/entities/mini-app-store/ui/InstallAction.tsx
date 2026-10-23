import { useState } from 'react'
import { MonitorUp, Trash2 } from 'lucide-react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { isBusy } from '../model/storeFilters'
import type { StoreActions } from '../model/storeActions'

export const DESKTOP_APP_HINT =
  'Also adds it as an app with its own window, Dock icon and place in Spotlight'

const percent = (job: NonNullable<MiniAppStoreEntryRecord['job']>) =>
  job.total ? Math.round(((job.received ?? 0) / job.total) * 100) : null

type Size = 'sm' | 'default'

/**
 * The one thing an app's state allows: how far its install is, Install (which, where a desktop app
 * can be made, turns into "Localix only" and "With desktop app" in place — Esc or a click elsewhere
 * brings it back), Update, Remove, or that it needs a newer Localix. An
 * unverified publisher's install asks "Install anyway?" first, whichever choice it was.
 */
export function InstallAction({
  entry,
  onInstall,
  onRemove,
  onInstallWithDesktop,
  size = 'sm',
  removeAs = 'icon',
}: {
  entry: MiniAppStoreEntryRecord
  /** Present only where a desktop app can be made for this app. */
  onInstallWithDesktop?: (opts: { acceptUnverified?: boolean }) => void
  size?: Size
  /** In a row the remove action is a quiet icon on hover; on a page it is a button. */
  removeAs?: 'icon' | 'button'
} & StoreActions) {
  const [confirming, setConfirming] = useState<null | 'localix' | 'desktop'>(null)
  // Install, where a desktop app can also be made, turns into the two ways to install, in place.
  const [choosing, setChoosing] = useState(false)
  const label = entry.displayName ?? entry.name
  const job = entry.job
  if (job && isBusy(entry)) {
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
  if (entry.incompatible)
    return <span className="text-2xs text-text-faint">Needs a newer Localix</span>
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
            if (choice === 'desktop') onInstallWithDesktop?.({ acceptUnverified: true })
            else onInstall(entry.name, { acceptUnverified: true })
          }}
        >
          Install
        </Button>
      </div>
    )
  if (entry.installed && !entry.update)
    return removeAs === 'button' ? (
      <Button size={size} variant="ghost" onClick={() => onRemove(entry.name)}>
        <Trash2 data-icon="inline-start" aria-hidden />
        Remove
      </Button>
    ) : (
      <IconButton
        size="sm"
        aria-label={`Remove ${label}`}
        className="opacity-0 group-hover/store-row:opacity-100 focus-visible:opacity-100"
        onClick={() => onRemove(entry.name)}
      >
        <Trash2 />
      </IconButton>
    )

  const trusted = entry.publisher.verified || Boolean(entry.installed)
  const install = () => (trusted ? onInstall(entry.name) : setConfirming('localix'))
  const installWithDesktop = () => (trusted ? onInstallWithDesktop?.({}) : setConfirming('desktop'))
  const variant = size === 'default' ? 'mono' : 'field'
  if (choosing)
    return (
      <div
        className="flex items-center gap-1"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setChoosing(false)
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setChoosing(false)
        }}
      >
        <Button
          ref={(button) => button?.focus()}
          size={size}
          variant="ghost"
          onClick={() => {
            setChoosing(false)
            install()
          }}
        >
          Localix only
        </Button>
        <Button
          size={size}
          variant={variant}
          title={DESKTOP_APP_HINT}
          onClick={() => {
            setChoosing(false)
            installWithDesktop()
          }}
        >
          <MonitorUp data-icon="inline-start" aria-hidden />
          With desktop app
        </Button>
      </div>
    )
  return (
    <Button
      size={size}
      variant={variant}
      onClick={() =>
        // A first install where a desktop app can be made asks which; an update never does.
        onInstallWithDesktop && !entry.installed ? setChoosing(true) : install()
      }
    >
      {entry.update ? 'Update' : job?.phase === 'failed' ? 'Try again' : 'Install'}
    </Button>
  )
}
