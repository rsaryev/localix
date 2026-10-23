/**
 * ContextRefChips — the composer's chip row for STRUCTURED (pinned) links: refs
 * minted by the @-menu, drag/drop, or the composerBus. A hand-typed @-token is
 * NOT chipped — its one representation is the inline highlight pill in the text
 * (chipping it too duplicated every applied link). Each chip is removable
 * (× drops the pinned ref). Also hosts the budget warning / block status and the
 * 20-link-cap hint — those cover typed tokens too, so they render even when no
 * context summary does. Labels still come from the same ref presentation registry
 * used by sent-message metadata.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Cpu, Link2, Plus, TriangleAlert, X } from 'lucide-react'
import { useRefLabelSources } from '../refKindPresentation'
import type { ContextRefChip, UseContextRefsResult } from '../../model/useContextRefs'
import { attachmentManifestRows, type ManifestAsset } from '../../model/composerContextManifest'
import { ImageLightbox } from '@/shared/ui/image-lightbox'
import { ContextManifestRefRow } from './ContextManifestRefRow'
import { ContextManifestUploads } from './ContextManifestUploads'
import type { PendingAttachment } from '@/shared/lib/attachment-policy'
import type { ExpansionBudget } from '@localixai/api/context-refs'
import type { MessageContextBinding } from '@/shared/api/contracts'
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@localixai/kit/popover'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Chip } from '@localixai/kit/chip'
import { ComposerChip } from '@localixai/kit/composer-chip'

/** Stable empty default: a fresh literal would re-run the manifest memo on every render. */
const NO_ATTACHMENTS: readonly PendingAttachment[] = []
const NO_SYSTEM_BINDINGS: readonly MessageContextBinding[] = []

interface ContextRefChipsProps {
  chips: ContextRefChip[]
  budget: ExpansionBudget
  budgetMessage: string | null
  /** Refs beyond the 20-per-message wire cap (they won't be sent). */
  droppedCount?: number
  /** Staged uploads — media, files, a voice note. Part of the manifest, not a separate one. */
  attachments?: readonly PendingAttachment[]
  /** Durable system events use the same manifest and binding channel as all other context. */
  systemBindings?: readonly MessageContextBinding[]
  enabledSystemBindingIds?: ReadonlySet<string>
  onSystemBindingEnabledChange?: (bindingId: string, enabled: boolean) => void
  onRemove: (key: string) => void
  onRemoveAttachment?: (id: string) => void
  onClearAll: () => void
}

export interface SystemContextControls {
  bindings: readonly MessageContextBinding[]
  enabledIds: ReadonlySet<string>
  setEnabled: (bindingId: string, enabled: boolean) => void
}

export function ComposerContextManifest({
  contextRefs,
  attachments,
  systemContext,
  onRemoveAttachment,
}: {
  contextRefs: UseContextRefsResult
  attachments: readonly PendingAttachment[]
  systemContext?: SystemContextControls
  onRemoveAttachment?: (id: string) => void
}) {
  return (
    <ContextRefChips
      chips={contextRefs.chips}
      budget={contextRefs.budget}
      budgetMessage={contextRefs.budgetMessage}
      droppedCount={contextRefs.droppedCount}
      attachments={attachments}
      systemBindings={systemContext?.bindings}
      enabledSystemBindingIds={systemContext?.enabledIds}
      onSystemBindingEnabledChange={systemContext?.setEnabled}
      onRemove={contextRefs.removeRef}
      onRemoveAttachment={onRemoveAttachment}
      onClearAll={contextRefs.clearAllRefs}
    />
  )
}

export { contextRefSourceLabel } from './ContextManifestRefRow'

export function ContextStatusNotice({
  tone = 'warning',
  title,
  children,
}: {
  tone?: 'warning' | 'error'
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1 px-1 py-0.5 text-xs leading-snug text-text-soft"
    >
      <TriangleAlert
        className={cn(
          'size-3 shrink-0',
          tone === 'error' ? 'text-status-error' : 'text-status-warning',
        )}
      />
      <span>{children}</span>
    </span>
  )
}

export function ContextRefChips({
  chips,
  budget,
  budgetMessage,
  droppedCount = 0,
  attachments = NO_ATTACHMENTS,
  systemBindings = NO_SYSTEM_BINDINGS,
  enabledSystemBindingIds,
  onSystemBindingEnabledChange,
  onRemove,
  onRemoveAttachment,
  onClearAll,
}: ContextRefChipsProps) {
  // Typed tokens keep their inline highlight in the textarea, but the summary
  // deliberately includes them: this surface answers the different question
  // "what context will this send actually carry?"
  const [open, setOpen] = useState(false)
  const labelSources = useRefLabelSources(chips.map((chip) => chip.ref))
  // Uploads belong to the same manifest: the count on the chip is the number of things this
  // message carries, not the number of links in it.
  const uploads = useMemo(() => attachmentManifestRows(attachments), [attachments])
  // Full-size look at one piece of evidence, from the row that carries it.
  const [zoom, setZoom] = useState<ManifestAsset | null>(null)
  const attachedTotal = chips.length + uploads.length
  const enabledSystemBindings = systemBindings.filter(
    (binding) => enabledSystemBindingIds?.has(binding.id) ?? true,
  )
  const total = attachedTotal + enabledSystemBindings.length
  const availableTotal = attachedTotal + systemBindings.length
  /**
   * The emptying actions live INSIDE this popup — "Clear all" in its header, and the remove
   * button on its last row. Unmounting on empty therefore tore the open popup out with the
   * row: no exit animation, and keyboard focus dropped to `document.body`, because Radix
   * cannot return it to a trigger that no longer exists.
   *
   * So the row outlives its own popup by one step: it stays mounted while open, the effect
   * closes the popup once there is nothing left to show, and only the render after that
   * removes the row. The popup closes BEFORE the last row disappears, in that order.
   */
  const empty = availableTotal === 0 && droppedCount === 0 && !budgetMessage
  useEffect(() => {
    if (empty && open) setOpen(false)
  }, [empty, open])
  if (empty && !open) return null

  return (
    <>
      {availableTotal > 0 && (
        <>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <ComposerChip
                aria-label={`Review ${total} included context ${total === 1 ? 'item' : 'items'}`}
                className="max-w-full"
              >
                <Link2 className="size-3 shrink-0" />
                <span className="font-medium">Context</span>
                <Chip tone="accent" size="dense">
                  {total}
                </Chip>
                <ChevronDown className="size-3 shrink-0" />
              </ComposerChip>
            </PopoverTrigger>
            <PopoverContent
              layout="structured"
              align="start"
              side="top"
              className="max-h-[min(22rem,60vh)] w-[min(26rem,calc(100vw-1.5rem))]"
            >
              <PopoverHeader
                actionsLabel="Context actions"
                actions={
                  attachedTotal > 0 ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={onClearAll}
                      className="text-text-soft"
                    >
                      Clear attached
                    </Button>
                  ) : null
                }
              >
                <PopoverTitle>Context</PopoverTitle>
                <PopoverDescription>
                  Included with the next message, in the order shown
                </PopoverDescription>
              </PopoverHeader>
              <PopoverBody
                role="list"
                aria-label="Context"
                className="divide-y divide-border-faint p-0"
              >
                {chips.map((chip, index) => (
                  <ContextManifestRefRow
                    key={chip.ref.key}
                    chip={chip}
                    index={index}
                    labelSources={labelSources}
                    onRemove={onRemove}
                    onViewAsset={setZoom}
                  />
                ))}
                <ContextManifestUploads
                  rows={uploads}
                  startIndex={chips.length}
                  onRemove={onRemoveAttachment}
                />
                {systemBindings.map((binding, index) => {
                  const checked = enabledSystemBindingIds?.has(binding.id) ?? true
                  return (
                    <div
                      key={binding.id}
                      role="listitem"
                      className="flex min-w-0 items-center gap-2 px-2 py-1.5 max-sm:px-1.5"
                    >
                      <span className="w-4 shrink-0 text-right text-2xs tabular-nums text-text-faint">
                        {attachedTotal + index + 1}
                      </span>
                      <Cpu className="size-3 shrink-0 text-text-soft" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium" title={binding.target.label}>
                          {binding.target.label}
                        </div>
                        <div className="text-2xs text-text-soft">
                          System event · {checked ? 'Included' : 'Excluded'}
                        </div>
                      </div>
                      <IconButton
                        size="sm"
                        onClick={() => onSystemBindingEnabledChange?.(binding.id, !checked)}
                        aria-label={`${checked ? 'Exclude' : 'Include'} system context ${binding.target.label}`}
                        className="shrink-0 text-text-soft opacity-65 hover:opacity-100"
                      >
                        {checked ? <X /> : <Plus />}
                      </IconButton>
                    </div>
                  )
                })}
              </PopoverBody>
            </PopoverContent>
          </Popover>
        </>
      )}
      {droppedCount > 0 && (
        <ContextStatusNotice title="A message carries at most 20 references — remove some links or send in two messages.">
          +{droppedCount} over the 20-link limit — extra links won't be sent
        </ContextStatusNotice>
      )}
      {budgetMessage && (
        <ContextStatusNotice tone={budget === 'block' ? 'error' : 'warning'}>
          {budgetMessage}
        </ContextStatusNotice>
      )}
      <ImageLightbox
        image={zoom?.imageUrl ? { src: zoom.imageUrl, name: zoom.name } : null}
        onClose={() => setZoom(null)}
      />
    </>
  )
}
