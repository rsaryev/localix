import { BadgeCheck, Check } from 'lucide-react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { Button } from '@localixai/kit/button'
import { Chip } from '@localixai/kit/chip'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { CATEGORY_LABELS } from '../model/categories'

/** What a card's action area shows for an app's state: one action, or where it is. */
function Action({
  entry,
  onInstall,
}: {
  entry: MiniAppStoreEntryRecord
  onInstall: (name: string) => void
}) {
  const label = entry.displayName ?? entry.name
  const phase = entry.job?.phase
  if (phase === 'queued' || phase === 'installing')
    return (
      <div className="flex w-full items-center gap-2 text-xs text-text-soft">
        <ProgressBar
          value={phase === 'queued' ? 8 : 60}
          className="h-1 flex-1"
          fillClassName="bg-foreground/60"
          aria-label={`Installing ${label}`}
        />
        <span>{phase === 'queued' ? 'Waiting' : 'Installing'}</span>
      </div>
    )
  if (entry.installed && !entry.update)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-text-soft">
        <Check className="size-3.5 text-status-success" aria-hidden />
        Installed
      </span>
    )
  return (
    <Button
      size="sm"
      variant={entry.update ? 'outline' : 'mono'}
      onClick={() => onInstall(entry.name)}
    >
      {entry.update ? 'Update' : phase === 'failed' ? 'Try again' : 'Install'}
    </Button>
  )
}

/**
 * One app in the store: its mark, name, publisher (and whether Localix vouches for them), category,
 * what it does, and the one action its state allows.
 */
export function MiniAppStoreCard({
  entry,
  onInstall,
}: {
  entry: MiniAppStoreEntryRecord
  onInstall: (name: string) => void
}) {
  const label = entry.displayName ?? entry.name
  return (
    <li
      data-mini-app={entry.name}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex min-w-0 items-start gap-3">
        <MonogramAvatar identity={entry.name} label={label} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
          <p className="flex min-w-0 items-center gap-1 text-xs text-text-soft">
            <span className="truncate">{entry.publisher.name}</span>
            {entry.publisher.verified ? (
              <BadgeCheck
                className="size-3.5 shrink-0 text-status-info"
                role="img"
                aria-label="Verified publisher"
              />
            ) : (
              <Chip tone="warning" size="dense">
                Unverified
              </Chip>
            )}
          </p>
        </div>
        {entry.category && (
          <Chip tone="neutral">{CATEGORY_LABELS[entry.category] ?? entry.category}</Chip>
        )}
      </div>
      <p
        className="line-clamp-2 min-h-8 text-xs leading-4 text-text-soft"
        title={entry.description}
      >
        {entry.description}
      </p>
      {entry.job?.phase === 'failed' && entry.job.error && (
        <p className="text-xs text-status-error">{entry.job.error}</p>
      )}
      <div className="mt-auto flex min-h-6 items-center justify-between gap-2">
        <span className="text-2xs text-text-faint">
          {entry.update && entry.installed?.version
            ? `${entry.installed.version} → ${entry.version ?? ''}`
            : entry.version
              ? `v${entry.version}`
              : ''}
        </span>
        <Action entry={entry} onInstall={onInstall} />
      </div>
    </li>
  )
}
