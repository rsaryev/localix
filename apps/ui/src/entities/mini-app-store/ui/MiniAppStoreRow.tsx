import { useState } from 'react'
import { BadgeCheck, Trash2 } from 'lucide-react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'

export interface StoreActions {
  onInstall: (name: string, opts?: { acceptUnverified?: boolean }) => void
  onRemove: (name: string) => void
}

const percent = (job: NonNullable<MiniAppStoreEntryRecord['job']>) =>
  job.total ? Math.round(((job.received ?? 0) / job.total) * 100) : null

/** The right side of a row: where an install is, or the one thing the app's state allows. */
function RowAction({
  entry,
  onInstall,
  onRemove,
}: { entry: MiniAppStoreEntryRecord } & StoreActions) {
  const [confirming, setConfirming] = useState(false)
  const label = entry.displayName ?? entry.name
  const job = entry.job
  if (job && ['queued', 'downloading', 'installing'].includes(job.phase)) {
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
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="field"
          aria-label="Install anyway"
          onClick={() => {
            setConfirming(false)
            onInstall(entry.name, { acceptUnverified: true })
          }}
        >
          Install
        </Button>
      </div>
    )
  if (entry.installed && !entry.update)
    return (
      <IconButton
        size="sm"
        aria-label={`Remove ${label}`}
        className="opacity-0 group-hover/store-row:opacity-100 focus-visible:opacity-100"
        onClick={() => onRemove(entry.name)}
      >
        <Trash2 />
      </IconButton>
    )
  return (
    <Button
      size="sm"
      variant="field"
      onClick={() =>
        entry.publisher.verified || entry.installed ? onInstall(entry.name) : setConfirming(true)
      }
    >
      {entry.update ? 'Update' : job?.phase === 'failed' ? 'Try again' : 'Install'}
    </Button>
  )
}

/**
 * One app in the store, one line tall: its mark and name, what it does, who publishes it when
 * Localix does not vouch for them, and the action its state allows.
 */
export function MiniAppStoreRow({
  entry,
  ...actions
}: { entry: MiniAppStoreEntryRecord } & StoreActions) {
  const label = entry.displayName ?? entry.name
  const failed = entry.job?.phase === 'failed' ? entry.job.error : undefined
  return (
    <li
      data-mini-app={entry.name}
      className="group/store-row flex min-h-14 items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover"
    >
      <MonogramAvatar identity={entry.name} label={label} size={32} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
          <span className="truncate">{label}</span>
          {entry.publisher.verified ? (
            <BadgeCheck
              className="size-3.5 shrink-0 text-text-faint"
              role="img"
              aria-label="Verified publisher"
            />
          ) : (
            <span className="shrink-0 text-2xs font-normal text-status-warning">
              Unverified · {entry.publisher.name}
            </span>
          )}
          {entry.update && entry.installed?.version && (
            <span className="shrink-0 text-2xs font-normal text-text-faint tabular-nums">
              {entry.installed.version} → {entry.version}
            </span>
          )}
        </p>
        <p
          className={
            failed ? 'truncate text-xs text-status-error' : 'truncate text-xs text-text-soft'
          }
          title={failed ?? entry.description}
        >
          {failed ?? entry.description}
        </p>
      </div>
      <RowAction entry={entry} {...actions} />
    </li>
  )
}
