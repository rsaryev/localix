import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Spinner } from '@localixai/kit/spinner'
import { IconButton } from '@localixai/kit/icon-button'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { refIcon, refDisplayLabel, type RefLabelSources } from '../refKindPresentation'
import {
  manifestAssetSummary,
  manifestAssets,
  type ManifestAsset,
} from '../../model/composerContextManifest'
import type { ContextRefChip } from '../../model/useContextRefs'
import type { BindingBackedContextRef } from '../../model/sendRefs'
import { linkFromRef } from '../../model/contextLinks'
import { linkDragProps } from '../linkDrag'

/** Registry-driven glyph — the SAME map the sent-message pills use. */
function chipIcon(ref: ContextRefChip['ref']) {
  const Icon = refIcon(ref)
  return <Icon className="size-3" />
}

export function contextRefSourceLabel(chip: Pick<ContextRefChip, 'auto' | 'pinned'>): string {
  if (chip.auto) return 'Automatic · open tab'
  if (chip.pinned) return 'Explicit'
  return 'Mention in message'
}

function sizeLabel(chars: number): string {
  if (chars >= 1000) return `${(chars / 1000).toFixed(chars >= 10_000 ? 0 : 1)}k`
  return String(chars)
}

/**
 * One link in the composer's context manifest: what it is, where it came from, how big it is,
 * and — the part this row used to omit — the evidence hanging off it.
 *
 * A preview pick attaches a screenshot as a nested asset of its binding. The row reported only
 * the text size ("537 chars"), so the picture existed but could not be seen until the message
 * had been sent. Its thumbnail now stands where the kind glyph would, and opens full size.
 */
export function ContextManifestRefRow({
  chip,
  index,
  labelSources,
  onRemove,
  onViewAsset,
}: {
  chip: ContextRefChip
  index: number
  labelSources: RefLabelSources
  onRemove: (key: string) => void
  onViewAsset: (asset: ManifestAsset) => void
}) {
  const { ref, expansion, pending, auto } = chip
  const failed = expansion ? !expansion.ok : false
  // The composer's chat (ChatSurface provides it): the file opens in that chat's workspace, and a
  // row outside any chat has nowhere to open it.
  const sessionId = useWorkItemSessionId()
  const openable = ref.kind === 'file' && ref.path && sessionId ? ref.path : null
  const label = refDisplayLabel(ref, labelSources)
  const assets = manifestAssets((ref as BindingBackedContextRef).messageBinding?.assets)
  const assetSummary = manifestAssetSummary(assets)
  const cover = assets.find((asset) => asset.imageUrl)
  // What the row can SHOW rather than summarize: the words that were written about the target,
  // and the pictures taken of it. A row that only counted characters made a person send a
  // comment they could no longer read.
  const detail = ref.content?.trim()
  const expandable = Boolean(detail || assets.length > 0)
  const [open, setOpen] = useState(false)

  return (
    <div role="listitem" className="min-w-0 px-2 py-1.5">
      {/* The row is the link: drag it out onto a board, a tab, another composer. */}
      <div
        className="flex min-w-0 cursor-grab items-center gap-2 active:cursor-grabbing"
        {...linkDragProps(() => linkFromRef(ref))}
      >
        <span className="w-4 shrink-0 text-right text-2xs tabular-nums text-text-faint">
          {index + 1}
        </span>
        {cover ? (
          <button
            type="button"
            onClick={() => onViewAsset(cover)}
            title={`View ${cover.name}`}
            aria-label={`View ${cover.name}`}
            className="shrink-0 overflow-hidden rounded-sm outline-none focus-ring"
          >
            <img src={cover.imageUrl} alt="" className="size-6 object-cover" />
          </button>
        ) : (
          <span className="shrink-0 text-text-soft">{chipIcon(ref)}</span>
        )}
        <div className="min-w-0 flex-1">
          {openable ? (
            <button
              type="button"
              onClick={() => {
                if (sessionId)
                  inspector.openFile({ sessionId, path: openable, line: ref.startLine })
              }}
              title={`Open ${openable}`}
              className="block max-w-full truncate text-left text-xs font-medium outline-none hover:underline focus-ring"
            >
              {label}
            </button>
          ) : (
            <div className="truncate text-xs font-medium" title={ref.raw}>
              {label}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-2xs text-text-soft">
            <span>{contextRefSourceLabel(chip)}</span>
            {pending ? (
              <Spinner className="size-3" />
            ) : expansion?.ok ? (
              <span>· {sizeLabel(expansion.chars)} chars</span>
            ) : failed ? (
              <span className="text-status-error">· {expansion?.error ?? 'Unavailable'}</span>
            ) : null}
            {assetSummary && <span>· {assetSummary}</span>}
          </div>
        </div>
        {expandable && (
          <IconButton
            size="sm"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? `Hide details of ${label}` : `Show details of ${label}`}
            className="shrink-0 text-text-soft opacity-65 hover:opacity-100"
          >
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </IconButton>
        )}
        <IconButton
          size="sm"
          onClick={() => onRemove(ref.key)}
          className="shrink-0 text-text-soft opacity-65 hover:opacity-100"
          aria-label={
            auto
              ? `Unlink automatic context ${label}`
              : `Exclude context ${label} from this message`
          }
        >
          <X />
        </IconButton>
      </div>
      {open && (
        <div className="mt-1.5 space-y-1.5 pl-6">
          {detail && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover px-2 py-1.5 text-2xs leading-snug text-text-soft scrollbar-thin">
              {detail}
            </pre>
          )}
          {assets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {assets.map((asset) =>
                asset.imageUrl ? (
                  <button
                    key={asset.key}
                    type="button"
                    onClick={() => onViewAsset(asset)}
                    title={`View ${asset.name}`}
                    className="overflow-hidden rounded-md border border-border-soft outline-none focus-ring"
                  >
                    <img src={asset.imageUrl} alt={asset.name} className="h-20 w-auto max-w-full" />
                  </button>
                ) : (
                  <span key={asset.key} className="text-2xs text-text-faint">
                    {asset.name}
                    {asset.size ? ` · ${asset.size}` : ''}
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
