import { ChevronRight, CheckCircle2, Wrench, CircleAlert, Minus, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Spinner } from '@localixai/kit/spinner'
import type { ToolActionDescriptor } from '@localixai/agent/agents'
import {
  createMessageBindingDraft,
  messageBindingToken,
  setMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { formatDuration } from '@localixai/mini-app-sdk/ui/utilities'
import { useToolDuration } from './toolTimingStore'
import { useToolCallDragRef } from './toolCallDragContext'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { useToolGate, gateLabel } from './toolGateContext'
import { autoOpenTransition } from './autoOpen'
import { RegisteredToolActions } from './toolActionsContext'
import { MetadataTooltip, Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { COLLAPSIBLE_MOTION } from '@localixai/kit/collapsible-motion'

export interface ToolLineProps {
  /** Custom icon component. Defaults to a wrench. */
  icon?: React.ComponentType<{ className?: string }>
  /** Primary label — tool name or question text. */
  title: string
  /** Richer title detail (for example a full path or command) shown by managed hover. */
  titleDetails?: string
  /** Secondary line — status, answer, or description. */
  subtitle?: string
  /** Compact pill/badge shown on the right of the header. */
  badge?: ReactNode
  /** Agnostic action slot (e.g. "Open in panel") rendered at the header's right, outside the toggle. */
  headerActions?: ReactNode
  /** Optional optimistic state hook; execution and authorization stay in the shared action path. */
  onRegisteredActionStart?: (action: ToolActionDescriptor) => void
  isLoading?: boolean
  hasError?: boolean
  /**
   * Persisted execution duration (ms) from the message timing. When provided,
   * it is shown instead of the ephemeral stopwatch so per-tool time survives reload.
   */
  durationMs?: number
  /** Dismissed/aborted state — shown muted, not as an error. */
  isDismissed?: boolean
  children?: ReactNode
  /**
   * Follow-mode expansion: the card opens while this is true and SETTLES CLOSED
   * when it falls back to false (e.g. open while a command streams, folded once
   * it finishes). Edge-triggered, and a manual user toggle wins over later
   * signal edges. This is the ONLY auto-expansion mechanism — an init-only
   * `defaultOpen` seed was removed because cards mounted mid-run froze in
   * whatever state they mounted with (never re-collapsed / never opened).
   */
  autoOpen?: boolean
  onClick?: () => void
}

export function ToolLine({
  icon: Icon,
  title,
  titleDetails,
  subtitle,
  badge,
  headerActions,
  onRegisteredActionStart,
  isLoading = false,
  hasError = false,
  durationMs,
  isDismissed = false,
  children,
  autoOpen,
  onClick,
}: ToolLineProps) {
  const [open, setOpen] = useState(autoOpen === true)
  // Follow the autoOpen signal's EDGES (see autoOpenTransition): open on rise,
  // settle closed on fall — unless the user toggled manually (their intent wins).
  const userToggledRef = useRef(false)
  const prevAutoOpenRef = useRef(autoOpen)
  useEffect(() => {
    const decided = autoOpenTransition(prevAutoOpenRef.current, autoOpen, userToggledRef.current)
    prevAutoOpenRef.current = autoOpen
    if (decided !== null) setOpen(decided)
  }, [autoOpen])
  // Lazy body: collapsed bodies are NOT mounted until first opened. In a long
  // dialog the hidden tool outputs (bash logs, JSON dumps) otherwise dominate
  // the DOM and make every style recalc page-wide slow. After the first open
  // the body stays mounted so the collapse animation still plays.
  const [everOpened, setEverOpened] = useState(autoOpen === true)
  if (open && !everOpened) setEverOpened(true)
  const [showDone, setShowDone] = useState(false)
  const [duration, setDuration] = useState<string>()
  const startRef = useRef<number | null>(null)
  const wasLoadingRef = useRef(false)

  // Track loading start time; flash "done" for 1.5 s after completion.
  useEffect(() => {
    if (isLoading) {
      startRef.current = Date.now()
      wasLoadingRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowDone(false)
      return
    }
    if (wasLoadingRef.current) {
      wasLoadingRef.current = false
      if (startRef.current && !hasError) {
        const elapsed = Date.now() - startRef.current
        if (elapsed > 200) setDuration(formatDuration(elapsed))
        setShowDone(true)
        const t = setTimeout(() => setShowDone(false), 1500)
        return () => clearTimeout(t)
      }
    }
    return undefined
  }, [isLoading, hasError])

  // Prefer the persisted duration (survives reload) over the live stopwatch.
  // Falls back to the context-provided value when no explicit prop is passed.
  const contextDuration = useToolDuration()
  const persistedMs = durationMs ?? contextDuration
  const displayDuration =
    persistedMs !== undefined && persistedMs > 0 ? formatDuration(persistedMs) : duration

  const canToggle = Boolean(children)
  const canClick = canToggle || Boolean(onClick)

  // Tool-call cards are agent-linkable: dragging the header into the composer
  // inserts a `@call:<toolCallId>` context-ref (the call's input/result digest).
  // The identity rides context from ItemView, so every card gets this for free.
  const callDragRef = useToolCallDragRef()
  // The conversation the call lives in rides with the drag: `@call:` alone names a call "in
  // this session", and a link dropped anywhere else (a board) must still find — and open — it.
  const callSessionId = useWorkItemSessionId()

  // Permission-gate provenance (rides context from ItemView, like the drag ref):
  // a shield glyph that explains on hover WHY a gated call ran without a confirm
  // (user approval, session-wide grant, an explicit allow rule).
  const gate = useToolGate()

  // The full label shows in a managed hover only when the text actually
  // overflows, rather than in a native `title`. Tool transcripts can contain hundreds of historical rows,
  // so measure only when hover/focus requests the detail instead of attaching a
  // ResizeObserver to every row for its entire lifetime.
  const titleTextRef = useRef<HTMLSpanElement>(null)
  const subtitleTextRef = useRef<HTMLSpanElement>(null)
  const textHoveredRef = useRef(false)
  const keyboardFocusedRef = useRef(false)
  const [detailTooltip, setDetailTooltip] = useState<{
    title?: string
    subtitle?: string
  } | null>(null)

  const isOverflowing = (element: HTMLElement | null) =>
    Boolean(
      element &&
      (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight),
    )

  const revealDetailTooltip = () => {
    const showTitle =
      Boolean(titleDetails && titleDetails !== title) || isOverflowing(titleTextRef.current)
    const showSubtitle = Boolean(subtitle && isOverflowing(subtitleTextRef.current))

    if (!showTitle && !showSubtitle) {
      setDetailTooltip(null)
      return
    }

    setDetailTooltip({
      title: showTitle ? (titleDetails ?? title) : undefined,
      subtitle: showSubtitle ? subtitle : undefined,
    })
  }

  const closeDetailTooltip = () => setDetailTooltip(null)

  const handleDetailOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeDetailTooltip()
      return
    }
    // The whole primary row is the Radix trigger so keyboard focus gets the
    // correct aria-describedby relationship. Pointer hover is intentionally
    // limited to the text column: badges and lifecycle metadata explain
    // themselves and must not summon a competing full-title surface.
    if (textHoveredRef.current || keyboardFocusedRef.current) revealDetailTooltip()
  }

  const iconContent = (() => {
    if (isLoading) return <Spinner size="xs" />
    if (showDone) return <CheckCircle2 className="size-[0.68rem] text-status-success" />
    if (hasError) return <CircleAlert className="size-[0.68rem] text-status-error" />
    if (isDismissed) return <Minus className="size-[0.68rem] text-text-faint" />
    if (Icon) return <Icon className="size-[0.68rem]" />
    return <Wrench className="size-[0.68rem]" />
  })()

  const iconColor = hasError
    ? 'text-status-error'
    : isDismissed
      ? 'text-text-faint'
      : showDone
        ? 'text-status-success'
        : isLoading
          ? 'text-text-soft'
          : 'text-text-faint'

  const titleColor = hasError
    ? 'text-status-error'
    : isDismissed
      ? 'text-text-faint'
      : 'text-text-soft'

  const toggle = () => {
    if (onClick) {
      onClick()
      return
    }
    if (canToggle) {
      userToggledRef.current = true
      setOpen((v) => !v)
    }
  }

  const primaryContent = (
    <>
      <span
        className={[
          'flex size-4 shrink-0 items-center justify-center transition-colors duration-(--dur-base)',
          iconColor,
        ].join(' ')}
      >
        {iconContent}
      </span>
      <span
        className="min-w-0 flex-1"
        onPointerEnter={() => {
          textHoveredRef.current = true
        }}
        onPointerLeave={() => {
          textHoveredRef.current = false
          if (!keyboardFocusedRef.current) closeDetailTooltip()
        }}
      >
        <span
          ref={titleTextRef}
          data-slot="tool-line-title"
          className={[
            'block truncate text-xs font-medium leading-tight transition-colors duration-(--dur-base)',
            titleColor,
          ].join(' ')}
        >
          {title}
        </span>
        {subtitle && (
          <span
            ref={subtitleTextRef}
            data-slot="tool-line-subtitle"
            className="mt-[0.1rem] block truncate text-2xs leading-tight text-text-faint"
          >
            {subtitle}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {badge}
        {gate && (
          <MetadataTooltip label={gateLabel(gate)}>
            <span aria-label={gateLabel(gate)} className="flex items-center text-text-faint">
              <ShieldCheck className="size-[0.66rem]" />
            </span>
          </MetadataTooltip>
        )}
        {displayDuration && !isLoading && (
          <span className="text-2xs tabular-nums text-text-faint">{displayDuration}</span>
        )}
        {canToggle && (
          <ChevronRight
            className={[
              `size-[0.66rem] text-text-faint ${COLLAPSIBLE_MOTION.chevron}`,
              open ? 'rotate-90' : '',
            ].join(' ')}
          />
        )}
      </span>
    </>
  )

  const primaryClassName =
    'flex min-w-[min(12rem,100%)] flex-1 items-center gap-1.5 px-1.5 py-[0.28rem] text-left outline-none focus-ring'
  const dragProps = callDragRef
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent<HTMLElement>) => {
          const draft = createMessageBindingDraft('call', callDragRef.toolCallId, title)
          const binding = callSessionId
            ? {
                ...draft,
                target: {
                  ...draft.target,
                  attributes: { ...draft.target.attributes, sessionId: callSessionId },
                },
              }
            : draft
          setMessageBindingDrag(e.dataTransfer, binding, {
            previewLabel: title || callDragRef.name,
          })
          e.dataTransfer.setData('text/plain', messageBindingToken(binding))
          e.dataTransfer.effectAllowed = 'copy'
        },
      }
    : {}

  const primaryTrigger = canClick ? (
    <button
      type="button"
      aria-expanded={canToggle ? open : undefined}
      onClick={toggle}
      onFocus={() => {
        keyboardFocusedRef.current = true
        revealDetailTooltip()
      }}
      onBlur={() => {
        keyboardFocusedRef.current = false
        if (!textHoveredRef.current) closeDetailTooltip()
      }}
      className={primaryClassName}
      {...dragProps}
    >
      {primaryContent}
    </button>
  ) : (
    <div className={primaryClassName} {...dragProps}>
      {primaryContent}
    </div>
  )

  return (
    <div className="w-full">
      <div
        className={[
          `flex min-h-[var(--chrome-control-md)] w-full flex-wrap items-center rounded-lg ${COLLAPSIBLE_MOTION.header}`,
          canClick ? 'cursor-pointer hover:bg-surface-hover' : 'cursor-default',
          open ? 'bg-surface-hover/45' : '',
        ].join(' ')}
      >
        <Tooltip open={detailTooltip !== null} onOpenChange={handleDetailOpenChange}>
          <TooltipTrigger asChild>{primaryTrigger}</TooltipTrigger>
          {detailTooltip && (
            <TooltipContent
              side="top"
              align="start"
              className="max-w-[min(36rem,calc(100vw-2rem))] flex-col items-start whitespace-pre-wrap break-words"
            >
              {detailTooltip.title && <span>{detailTooltip.title}</span>}
              {detailTooltip.subtitle && (
                <span className="text-text-faint">{detailTooltip.subtitle}</span>
              )}
            </TooltipContent>
          )}
        </Tooltip>
        <span
          data-tool-action-cluster
          role="group"
          aria-label={`${title} actions`}
          className="ml-auto flex shrink-0 items-center gap-1 px-1.5 py-1 empty:hidden"
        >
          {headerActions}
          <RegisteredToolActions onInvoke={onRegisteredActionStart} />
        </span>
      </div>

      {/* Collapsible body — mounted on first open only */}
      {children && everOpened && (
        <div
          className={[
            `grid overflow-hidden ${COLLAPSIBLE_MOTION.body}`,
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          ].join(' ')}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="ml-[0.45rem] border-l border-control-border/60 pl-3 pb-1">
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
