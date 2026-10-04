import { useMemo, useState } from 'react'
import { ChevronRight, CircleAlert, Compass } from 'lucide-react'
import { PulsingDot } from '@localixai/kit/pulsing-dot'
import type { ToolBackedItem } from '@localixai/agent/agents'
import {
  isItemStreaming,
  hasItemError,
  itemStackLabel,
  chainSummary,
  chainDiffStats,
} from '../itemHelpers'
import { DiffStat } from '../ToolIO'
import { ItemView } from '../ItemView'
import { COLLAPSIBLE_MOTION } from '@localixai/kit/collapsible-motion'
import { toolDisplayLabel, toolMeta } from './meta'
import { useToolEventFocus } from '../eventFocusTarget'

interface StackedItemGroupProps {
  items: ToolBackedItem[]
}

/**
 * Collapses a run of consecutive foldable tool calls into a single summary
 * row — e.g. 6 `read` calls become one line "Read 6 files · config.ts, store.ts +4",
 * and a mixed read-only run (reads + searches + lookups, see cards/stacking.ts)
 * reads "Explored 5 locations · store.ts, useShallow +3".
 * Click to expand the full individual cards; click again to recollapse. This is
 * the primary de-clutter mechanism for repetitive data ops.
 *
 * It opens only when asked (a click, or an event that points into it). It used to
 * force itself open while any member streamed, so each new call of the run opened
 * the whole group and each finish shut it — the transcript jumped once per call,
 * by a block that grew with the run. The live state rides the summary row instead
 * (the live verb, the pulsing dot); a failed call leaves the group (see stacking.ts).
 */
export function StackedItemGroup({ items }: StackedItemGroupProps) {
  const containsEventTarget = useToolEventFocus(items) !== null
  const meta = toolMeta(items[0].name)
  // A read-only group may mix tool names — the per-tool icon would lie there,
  // so mixed runs get the neutral exploration glyph instead.
  const mixed = items.some((it) => it.name !== items[0].name)
  const Icon = mixed ? Compass : meta.icon

  // All `items`-derived summary state in ONE memoized pass — this group
  // re-renders on every streaming update, and previously rebuilt the label
  // array + walked items four extra times each render.
  const { anyStreaming, errorCount, previewText, summary, diffStats } = useMemo(() => {
    const live = items.find(isItemStreaming)
    const streaming = Boolean(live)
    // A compact "a, b +N" preview of the item labels — or, while a member runs, THAT member:
    // the collapsed row is where the live call shows, so it names what is happening now.
    const labels = items.map(itemStackLabel)
    const previewCount = Math.min(2, labels.length)
    const preview = labels.slice(0, previewCount).join(', ')
    const overflow = labels.length - previewCount
    return {
      anyStreaming: streaming,
      errorCount: items.filter(hasItemError).length,
      previewText: live ? itemStackLabel(live) : overflow > 0 ? `${preview} +${overflow}` : preview,
      // "Edited 3 files" (files, not calls — see chainSummary), "Read 6 files", …
      // A mixed read-only run gets one verb instead of a kind-by-kind list.
      summary: mixed
        ? `${streaming ? 'Exploring' : 'Explored'} ${items.length} locations${streaming ? '…' : ''}`
        : (chainSummary(items, streaming) ??
          `${toolDisplayLabel(items[0].name)} ${items.length} ${meta.noun}`),
      diffStats: chainDiffStats(items),
    }
  }, [items, meta, mixed])

  const [open, setOpen] = useState(false)
  const expanded = open || containsEventTarget
  // Lazy body: don't mount the individual cards until first expanded (see ToolLine).
  const [everExpanded, setEverExpanded] = useState(expanded)
  if (expanded && !everExpanded) setEverExpanded(true)

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className={[
          `group/stack flex w-full min-h-[var(--chrome-control-md)] items-center gap-1.5 rounded-lg px-1.5 py-[0.28rem] text-left outline-none focus-ring ${COLLAPSIBLE_MOTION.header} cursor-pointer hover:bg-surface-hover`,
          expanded ? 'bg-surface-hover/45' : '',
        ].join(' ')}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-text-faint">
          <Icon className="size-[0.68rem]" />
        </span>

        <span className="min-w-0 flex-1 truncate">
          <span className="text-xs font-medium text-text-soft">{summary}</span>
          {previewText && <span className="ml-1.5 text-2xs text-text-faint">· {previewText}</span>}
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <DiffStat additions={diffStats.additions} deletions={diffStats.deletions} />
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-2xs font-medium text-status-error">
              <CircleAlert className="size-3" aria-hidden="true" />
              {errorCount} failed
            </span>
          )}
          {anyStreaming && <PulsingDot className="text-text-soft" />}
          <ChevronRight
            className={[
              `size-[0.66rem] text-text-faint ${COLLAPSIBLE_MOTION.chevron}`,
              expanded ? 'rotate-90' : '',
            ].join(' ')}
          />
        </span>
      </button>

      <div
        className={[
          `grid overflow-hidden ${COLLAPSIBLE_MOTION.body}`,
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        ].join(' ')}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-[0.45rem] border-l border-control-border/60 pl-2">
            {everExpanded && items.map((it) => <ItemView key={it.id} item={it} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
