import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@localixai/kit/spinner'
import type { AgentItem, ToolBackedItem } from '@localixai/agent/agents'
import { getMessageToolDetails } from '@/shared/api/tool-details-client'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { COLLAPSIBLE_MOTION } from '@localixai/kit/collapsible-motion'
import { ToolChainBody } from './ToolChainBody'
import type { Message } from '../../model/types'
import {
  isItemStreaming,
  hasItemError,
  itemActionVerb,
  chainSummary,
  chainDiffStats,
} from './itemHelpers'
import { ToolChainHeader, type ChainAggregate } from './ToolChainHeader'
import { DurationsContext } from './toolTimingStore'
import { useToolEventFocus } from './eventFocusTarget'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useToolCardsVersion } from '@/shared/contrib/toolCards'

interface ToolChainProps {
  /** One uninterrupted run of tool-backed items. */
  items: AgentItem[]
  activity?: readonly Message[]
  /** The response is still streaming; settled chains fold without discarding manual toggles. */
  isRunning?: boolean
  /**
   * True only for the trailing chain of the last message — the one that stays
   * expanded while the run progresses; earlier chains fold into a digest.
   */
  isLatest?: boolean
  /** Owning persisted row; required only when this snapshot deferred card details. */
  messageId?: string
  /** Message-level ids omitted from the session-open response. */
  deferredToolItemIds?: readonly string[]
}

export function areToolChainPropsEqual(prev: ToolChainProps, next: ToolChainProps): boolean {
  // Message reduction preserves unchanged item identities, while MessageCard creates
  // a fresh run array per render. Compare the immutable elements, not the wrapper array.
  if (
    prev.isLatest !== next.isLatest ||
    prev.isRunning !== next.isRunning ||
    (prev.activity?.length ?? 0) !== (next.activity?.length ?? 0) ||
    prev.messageId !== next.messageId ||
    prev.items.length !== next.items.length ||
    prev.deferredToolItemIds?.length !== next.deferredToolItemIds?.length
  ) {
    return false
  }
  return (
    prev.items.every((item, index) => item === next.items[index]) &&
    (prev.activity ?? []).every((message, index) => message === next.activity?.[index]) &&
    (prev.deferredToolItemIds ?? []).every(
      (itemId, index) => itemId === next.deferredToolItemIds?.[index],
    )
  )
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/**
 * A visual cluster for one uninterrupted run of tool items. A lone item renders
 * bare; a run of 2+ gets a bordered "track" that reads as one action group, with
 * a live aggregate header ("Reading 1 file, running 15 commands… · 3/16") that
 * folds into a digest ("Read 3 files, ran 15 commands · +120 −41 · 12.4s") when
 * work ends or a newer chain starts. Routine lifecycle details share its disclosure.
 */
const detailRequests = new Map<string, Promise<ToolBackedItem[]>>()

function loadMessageToolDetails(sessionId: string, messageId: string): Promise<ToolBackedItem[]> {
  const key = `${sessionId}\0${messageId}`
  const cached = detailRequests.get(key)
  if (cached) return cached
  const request = getMessageToolDetails(sessionId, messageId).then((details) => details.items)
  detailRequests.set(key, request)
  // Deduplicate only concurrent consumers (chat + Snapshot). Resolved megabyte
  // payloads belong to their mounted chains, not an unbounded process cache.
  void request.then(
    () => {
      if (detailRequests.get(key) === request) detailRequests.delete(key)
    },
    () => {
      // A failed request is retryable; never poison every chain for this message.
      detailRequests.delete(key)
    },
  )
  return request
}

function ToolChainComponent({
  items,
  activity = [],
  isRunning,
  isLatest = false,
  messageId,
  deferredToolItemIds,
}: ToolChainProps) {
  // THIS transcript's session (several chat surfaces can be mounted at once). Outside one there
  // is none, and deferred details are not fetched — never fetched from the chat on screen.
  const detailSessionId = useWorkItemSessionId()
  const durations = useContext(DurationsContext)
  const containsEventTarget = useToolEventFocus(items) !== null
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const [everExpanded, setEverExpanded] = useState(items.length === 1 && activity.length === 0)
  const [resolved, setResolved] = useState<{
    key: string
    items: ToolBackedItem[]
  } | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  // Cluster aggregates in ONE memoized pass. When the chain changes, its header would
  // otherwise walk `items` five times (find + 2× filter + reduce + summary/stats).
  const deferredIds = useMemo(() => new Set(deferredToolItemIds ?? []), [deferredToolItemIds])
  const hasDeferredDetails = items.some((item) => deferredIds.has(item.id))
  const detailKey =
    hasDeferredDetails && detailSessionId && messageId ? `${detailSessionId}\0${messageId}` : null
  const resolvedItems = resolved?.key === detailKey ? resolved.items : null
  const displayedItems = useMemo(() => {
    if (!resolvedItems) return items
    const byId = new Map(resolvedItems.map((item) => [item.id, item]))
    return items.map((item) => byId.get(item.id) ?? item)
  }, [items, resolvedItems])
  const isCluster = items.length > 1 || activity.length > 0
  const isLive = Boolean(
    isRunning ||
    items.some(isItemStreaming) ||
    activity.some((message) => message.systemNotice?.activity?.state === 'running'),
  )
  const expanded = isCluster ? containsEventTarget || (userOpen ?? (isLatest && isLive)) : true

  useEffect(() => {
    if (!expanded || !detailKey || !detailSessionId || !messageId || resolvedItems) return
    let current = true
    setDetailError(null)
    void loadMessageToolDetails(detailSessionId, messageId).then(
      (details) => {
        if (current) setResolved({ key: detailKey, items: details })
      },
      (error: unknown) => {
        // The reason used to be discarded for a boolean, which left "Could not load tool details"
        // as the whole story — and nothing at all once the transcript scrolled away. It is kept,
        // but as the DETAIL: a transport complaint is not the sentence a reader wants first.
        if (current) setDetailError(errorMessage(error, ''))
      },
    )
    return () => {
      current = false
    }
  }, [detailKey, detailSessionId, expanded, messageId, resolvedItems, retry])

  const retryDetails = useCallback(() => setRetry((value) => value + 1), [])
  const detailProblem = useProblemReport(
    detailError
      ? {
          subject: { label: 'Tool details' },
          problems: [
            {
              message: 'The details of these tool calls could not be loaded.',
              // No hint: the group's body is the details, so `blocked` already says what is
              // missing, and Retry is on the line. "The steps themselves are unaffected" also read
              // as a promise the surface contradicts — the step rows are not drawn either.
              detail: detailError || undefined,
            },
          ],
          consequence: 'blocked',
        }
      : null,
    {
      scope: 'transcript',
      sourceVisible: true,
      actions: [{ id: 'retry', label: 'Retry', run: retryDetails }],
    },
  )

  // Summaries and folding read tool presentation, and a plugin's rows register after the
  // transcript has painted — without this the chain would keep "Tool" until the run changed.
  const toolCardsVersion = useToolCardsVersion()

  const aggregate = useMemo((): ChainAggregate | null => {
    if (displayedItems.length <= 1 && !activity.length) return null
    const streamingItem = displayedItems.find(isItemStreaming)
    let errorCount = 0
    let doneCount = 0
    let totalMs = 0
    for (const it of displayedItems) {
      if (hasItemError(it)) errorCount++
      if (!isItemStreaming(it)) doneCount++
      if (durations) totalMs += durations.get(it.id) ?? 0
    }
    // Aggregate digest — "Reading 1 file, running 15 commands…" while live,
    // "Read 3 files, ran 15 commands" once done; falls back to the old forms.
    const title = isLive
      ? (chainSummary(displayedItems, true) ??
        (streamingItem ? capitalize(`${itemActionVerb(streamingItem)}…`) : 'Working…'))
      : (chainSummary(displayedItems, false) ??
        (displayedItems.length ? `${displayedItems.length} steps` : 'System activity'))
    return {
      isLive,
      errorCount,
      doneCount,
      totalMs,
      title,
      diffStats: chainDiffStats(displayedItems),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version stands in for the registry
  }, [displayedItems, durations, toolCardsVersion, activity, isLive])

  if (!items.length && !activity.length) return null

  // Keep mounted details and manual toggles across lifecycle updates. The response's
  // isRunning flag keeps the latest chain open between calls, until the response ends.
  if (expanded && !everExpanded) setEverExpanded(true)

  // ONE element tree for a lone call and a cluster: the header slot is empty for one item and
  // the body wrappers stay in place. A second call used to swap the bare `<div>` for the
  // cluster's `button + div`, which remounted every card already shown — their open state,
  // stopwatch and lazy bodies reset as the chain grew. Now the second call only adds a header.
  const header = aggregate ? (
    <ToolChainHeader
      aggregate={aggregate}
      expanded={expanded}
      count={items.length || activity.length}
      onToggle={() => setUserOpen(!expanded)}
    />
  ) : null

  return (
    <div className={isCluster ? 'my-1 w-full border-l border-border-soft pl-1' : 'w-full'}>
      {header}
      <div
        aria-hidden={isCluster ? !expanded : undefined}
        inert={isCluster ? !expanded : undefined}
        className={
          isCluster
            ? [
                `grid ${COLLAPSIBLE_MOTION.body}`,
                expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              ].join(' ')
            : undefined
        }
      >
        <div className={isCluster ? 'min-h-0 overflow-hidden' : undefined}>
          <div className={isCluster ? 'px-1 pb-0.5' : undefined}>
            {everExpanded ? (
              isCluster && hasDeferredDetails && !resolvedItems ? (
                <div className="flex min-h-8 items-center gap-2 px-2 text-xs text-text-faint">
                  {detailProblem ? (
                    <ProblemLine {...detailProblem} />
                  ) : (
                    <>
                      <Spinner size="xs" />
                      <span>Loading tool details…</span>
                    </>
                  )}
                </div>
              ) : (
                <ToolChainBody items={displayedItems} activity={activity} />
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export const ToolChain = memo(ToolChainComponent, areToolChainPropsEqual)
ToolChain.displayName = 'ToolChain'
