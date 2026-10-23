import { useId } from 'react'
import { BadgeCheck } from 'lucide-react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import type { StoreActions } from '../model/storeActions'
import { InstallAction } from './InstallAction'
import { MiniAppIcon } from './MiniAppIcon'
import { TagButton } from './TagButton'

const ROW_TAGS = 3

export interface MiniAppStoreRowProps extends StoreActions {
  entry: MiniAppStoreEntryRecord
  onOpen: (name: string) => void
  onTag: (tag: string) => void
  onInstallWithDesktop?: (opts: { acceptUnverified?: boolean }) => void
  /** Why the desktop app chosen with the install was not made. */
  desktopProblem?: string
}

/** Verified mark, or who publishes it when Localix does not vouch for them. */
export function PublisherMark({ entry }: { entry: MiniAppStoreEntryRecord }) {
  return entry.publisher.verified ? (
    <BadgeCheck
      className="size-3.5 shrink-0 text-text-faint"
      role="img"
      aria-label="Verified publisher"
    />
  ) : (
    <span className="shrink-0 text-2xs font-normal text-status-warning">
      Unverified · {entry.publisher.name}
    </span>
  )
}

/**
 * One app in the store: its icon, name, publisher, what it does, up to three tags and the one
 * action its state allows. The whole row opens the app's page; the tags and the action are
 * their own controls above it.
 */
export function MiniAppStoreRow({
  entry,
  onOpen,
  onTag,
  onInstallWithDesktop,
  desktopProblem,
  ...actions
}: MiniAppStoreRowProps) {
  const label = entry.displayName ?? entry.name
  const descriptionId = useId()
  const failed = entry.job?.phase === 'failed' ? entry.job.error : undefined
  const note =
    failed ??
    (desktopProblem ? `Installed, but the desktop app was not made: ${desktopProblem}` : undefined)
  const tags = (entry.tags ?? []).slice(0, ROW_TAGS)
  return (
    <li
      data-mini-app={entry.name}
      className="group/store-row relative flex min-h-16 items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover"
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={descriptionId}
        className="absolute inset-0 rounded-md focus-ring"
        onClick={() => onOpen(entry.name)}
      />
      <MiniAppIcon name={entry.name} label={label} icon={entry.icon} size={40} />
      <div className="pointer-events-none min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
          <span className="truncate">{label}</span>
          <PublisherMark entry={entry} />
          {entry.update && entry.installed?.version && (
            <span className="shrink-0 text-2xs font-normal text-text-faint tabular-nums">
              {entry.installed.version} → {entry.version}
            </span>
          )}
        </p>
        <p
          id={descriptionId}
          className={
            note ? 'truncate text-xs text-status-error' : 'truncate text-xs text-text-soft'
          }
          title={note ?? entry.description}
        >
          {note ?? entry.description}
        </p>
        {tags.length > 0 && (
          <div className="pointer-events-auto relative mt-1 flex w-fit flex-wrap gap-1">
            {tags.map((tag) => (
              <TagButton key={tag} tag={tag} onTag={onTag} />
            ))}
          </div>
        )}
      </div>
      <div className="relative shrink-0">
        <InstallAction entry={entry} onInstallWithDesktop={onInstallWithDesktop} {...actions} />
      </div>
    </li>
  )
}
