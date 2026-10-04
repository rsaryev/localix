import { Check, Copy, History, MoreHorizontal, ShieldCheck, X } from 'lucide-react'

import { VAULT_ITEM_TYPE_DEFINITIONS } from '@localixai/api/client'
import type { SecretMeta, VaultItemSource, VaultVersionMeta } from '@localixai/api/client'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { SectionLabel } from '@localixai/kit/section-label'
import { VAULT_TYPE_PRESENTATION } from '../model/vaultTypePresentation'
import { vaultItemMenu } from './vaultItemMenu'

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)

const VAULT_SOURCE_LABEL: Record<VaultItemSource, string> = {
  user: 'Personal',
  provider: 'Provider',
  plugin: 'Plugin',
  system: 'System',
}

/** The one dot between two metadata segments. It was written out five times in this run. */
function Separator() {
  return (
    <span className="text-border" aria-hidden="true">
      ·
    </span>
  )
}

export function ItemMetadata({ item, detailed = false }: { item: SecretMeta; detailed?: boolean }) {
  return (
    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-text-soft">
      <span className="shrink-0">{VAULT_ITEM_TYPE_DEFINITIONS[item.type].label}</span>
      <Separator />
      <span className="shrink-0">{VAULT_SOURCE_LABEL[item.source]}</span>
      {detailed && (
        <>
          <Separator />
          <code className="min-w-0 truncate font-mono">{item.key}</code>
          {/* Version and timestamp are the least-consulted half of the run and the first to
              push a row to three lines in a side panel. `contents` keeps each segment inline
              with its separator when it is shown, and removes both together when it is not. */}
          <span className="hidden @xl:contents">
            <Separator />
            <span>v{item.version}</span>
            <Separator />
            <span>{formatTime(item.updatedAt)}</span>
          </span>
        </>
      )}
    </span>
  )
}

export function VaultItemDetails({
  item,
  copied,
  onCopy,
  onClose,
  onEdit,
  onRotate,
  onDelete,
  versions,
  loadingVersions,
}: {
  item: SecretMeta
  copied: string | null
  onCopy: (item: SecretMeta, template?: boolean) => void
  onClose: () => void
  onEdit: () => void
  onRotate: () => void
  onDelete: () => void
  versions: VaultVersionMeta[]
  loadingVersions: boolean
}) {
  const presentation = VAULT_TYPE_PRESENTATION[item.type]
  const Icon = presentation.Icon
  const managed = item.source === 'provider' || item.source === 'system'
  return (
    <div className="grid min-w-0 gap-4 @sm:gap-5">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 grid w-4 shrink-0 place-items-center">
          <Icon aria-hidden="true" className="size-4 text-text-soft" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="min-w-0 truncate font-heading text-sm font-medium">{item.label}</h2>
          <ItemMetadata item={item} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" aria-label="Item actions" tooltip="Item actions">
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <MenuEntries
                entries={vaultItemMenu(item, { copied, onCopy, onEdit, onRotate, onDelete })}
                family="dropdown"
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            size="sm"
            aria-label="Close item details"
            tooltip="Close details"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {item.description && <p className="text-xs/relaxed text-text-soft">{item.description}</p>}

      {item.reference && (
        <div className="grid gap-1.5">
          <SectionLabel as="span">Secret reference</SectionLabel>
          <div className="flex min-w-0 items-start gap-2 border-y border-border-faint py-1.5">
            {/* `break-all`, not `truncate`: the reference is the thing the user came here to
                read and paste, and a side panel is narrow enough that truncating it hid the
                identifying half of every alias. */}
            <code className="min-w-0 flex-1 py-1 font-mono text-xs break-all text-foreground">
              {item.reference}
            </code>
            <IconButton
              size="sm"
              aria-label="Copy secret reference"
              tooltip="Copy secret reference"
              onClick={() => onCopy(item)}
            >
              {copied === `${item.key}:handle` ? (
                <Check className="size-3.5 text-status-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </IconButton>
          </div>
        </div>
      )}

      <dl className="grid gap-3 text-xs">
        <Detail label="Alias" value={item.key} mono />
        <Detail label="Backend" value={item.backend} />
        <Detail label="Version" value={String(item.version)} />
        <Detail label="Created" value={formatTime(item.createdAt)} />
        <Detail label="Updated" value={formatTime(item.updatedAt)} />
      </dl>

      {item.tags.length > 0 && (
        <div className="flex min-w-0 items-baseline gap-2 text-2xs">
          <span className="shrink-0 text-text-faint">Tags</span>
          <span className="min-w-0 break-words text-text-soft">{item.tags.join(' · ')}</span>
        </div>
      )}

      <div className="grid gap-2 border-t border-border-soft pt-4">
        <div className="flex items-center gap-2">
          <History className="size-3.5 text-text-soft" />
          <h3 className="text-xs font-medium">Version history</h3>
        </div>
        {loadingVersions && versions.length === 0 ? (
          <ActivitySignal label="Loading history" className="text-xs text-text-faint" />
        ) : (
          <div className={DIVIDED_LIST}>
            {versions.slice(0, 5).map((version) => (
              <div key={version.version} className="flex min-w-0 items-center gap-2 py-2 text-xs">
                <span className="shrink-0 font-mono">v{version.version}</span>
                <span className="min-w-0 truncate capitalize text-text-soft">{version.reason}</span>
                <time className="ml-auto shrink-0 text-text-faint">
                  {formatTime(version.createdAt)}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-1.5 border-t border-border-faint pt-3 text-2xs/relaxed text-text-faint">
        <div className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-status-success/70" />
          <span>
            Agent access is metadata-only; values stay in trusted adapters and outside model
            context.
          </span>
        </div>
        {managed && <span>Value lifecycle is managed by the {item.source} connection.</span>}
        {!item.reference && (
          <span>
            This item has no public <code className="text-text-soft">secret:</code> reference.
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * One label/value pair.
 *
 * Stacked in a narrow panel and two-column from `@sm` up — a 5rem label column plus a
 * right-aligned value left roughly nothing for the value in a side panel, so the alias, the
 * one field people actually read here, was always the ellipsis.
 *
 * The value WRAPS rather than truncating, and mono values break inside the token: an alias
 * has no spaces to break at, so `break-words` alone would still have overflowed its column.
 */
function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 gap-x-3 gap-y-0.5 @sm:grid-cols-[minmax(4rem,5rem)_minmax(0,1fr)]">
      <dt className="min-w-0 truncate text-text-faint">{label}</dt>
      <dd className={cn('min-w-0 text-text-soft', mono ? 'font-mono break-all' : 'wrap-anywhere')}>
        {value}
      </dd>
    </div>
  )
}
