import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'
import { useFocusEntry } from '@localixai/mini-app-sdk/ui/focus'
import { isTypingTarget } from '@/shared/lib/keybindings/typingTarget'
import { useCountdownMs } from '@/shared/hooks/useCountdown'

interface HitlInteractionFrameProps {
  title: string
  showHeading?: boolean
  detail?: string
  progress?: string
  children: ReactNode
  footer: ReactNode
  onDismiss: () => void
  dismissLabel?: string
  dismissDisabled?: boolean
  /**
   * When silence becomes a refusal, as epoch ms — rendered as a countdown in the footer.
   *
   * Here rather than in each view because it is the same fact about every card: five
   * minutes, then denied, nothing changed (`hitl/decision-deadline.ts`). It used to be a
   * per-kind affair — `ask` showed a countdown to an auto-ANSWER, `configure` carried a
   * deadline it never drew, and two kinds had none at all — so what happens if you walk away
   * was something a user had to learn one card at a time.
   */
  expiresAt?: number
  /**
   * The PRIMARY (affirmative) action, invoked when the user presses Enter —
   * approve a confirm, or advance/submit a stepped ask/quiz. Omitted by rich
   * forms that own a text field (e.g. the media card) where a bare Enter must
   * not submit. Enter is preventDefault'd only when this fires.
   */
  onSubmit?: () => void
  /** Enter/Escape shortcuts belong only to this active frame's DOM subtree. */
  keyboardActive?: boolean
  /** Shared with views that own extra global shortcuts (ask/quiz number keys). */
  rootRef?: RefObject<HTMLDivElement | null>
  /**
   * Tailwind max-height class for the bounded column. Rich forms (e.g. the media
   * card with prompt + model + params + references) pass a taller cap so their
   * lower sections aren't hidden below the scroll fold. Defaults to the compact
   * cap used by confirm/ask/quiz.
   */
  maxHeightClass?: string
  /**
   * Which shell the frame is sitting in.
   *
   * `inline` is the warm chat surface: the frame IS the card, so it carries the compact
   * transcript padding. `dialog` is the cross-session inbox modal, where the frame is the
   * BODY of a real dialog — it then adopts the modal regions' own measure (`px-4`, the
   * `border-border/60` chrome seam) and a taller fold, so the request reads as one surface
   * with the dialog header above it instead of a chat card pasted inside a modal.
   *
   * Deliberately a mode on the one frame rather than a second frame component: every HITL
   * view renders through this file, and a parallel "modal" frame would have to re-derive the
   * keyboard ownership, the scroll boundary and the pinned footer that live here.
   */
  chrome?: HitlFrameChrome
  /** What happens at the deadline; worded on the card. Defaults to `deny`. */
  expiryOutcome?: HitlExpiryOutcome
}

export type HitlFrameChrome = 'inline' | 'dialog' | 'compact'

/** What silence does: a permission is denied; a question lets the agent continue without it. */
export type HitlExpiryOutcome = 'deny' | 'continue'

/**
 * The unanswered outcome, said plainly and identically everywhere.
 *
 * "Denied" is the whole promise: an expired card writes no rule, stores no secret and starts
 * no agent. The one card that used to guess — `ask` picked its recommended option — is what
 * made that sentence worth printing.
 */
function DeadlineNote({ expiresAt, outcome }: { expiresAt: number; outcome: HitlExpiryOutcome }) {
  // `remaining` already carries its preposition ("in 4m 12s", or "now" once elapsed); writing
  // another "in" before it rendered "in in 4m 12s" on every card. Two words, not a clause:
  // "No answer in 4m 12s — denied" was wide enough to push Approve onto a second line in the
  // inbox dialog, and the shorter form states the same outcome.
  const remaining = useCountdownMs(expiresAt, { whenElapsed: 'now' })
  return (
    <span
      title={
        outcome === 'continue'
          ? 'With no answer, the agent continues without it'
          : 'With no answer, the request is denied'
      }
      className="mr-auto shrink-0 tabular-nums text-2xs text-text-faint"
    >
      {outcome === 'continue' ? (
        <>Continues without your answer {remaining}</>
      ) : (
        <>Auto-deny {remaining}</>
      )}
    </span>
  )
}

/** Padding + seam per shell. The only thing `chrome` decides. */
const FRAME_CHROME = {
  compact: { root: 'px-3 py-2.5', footer: 'mt-2 border-t border-border-soft pt-2' },
  inline: {
    root: 'px-3 pt-2.5 pb-3',
    footer: 'mt-3 border-t border-border-soft pt-2.5',
  },
  dialog: {
    root: 'px-4 pt-3.5 pb-3.5',
    footer: 'mt-3.5 border-t border-border-soft pt-3',
  },
} as const satisfies Record<HitlFrameChrome, { root: string; footer: string }>

export function HitlInteractionFrame({
  title,
  showHeading = true,
  detail,
  progress,
  children,
  footer,
  onDismiss,
  dismissLabel = 'Dismiss interaction',
  dismissDisabled = false,
  expiresAt,
  onSubmit,
  keyboardActive = true,
  rootRef,
  maxHeightClass,
  chrome = 'inline',
  expiryOutcome = 'deny',
}: HitlInteractionFrameProps) {
  // A modal owns the viewport it opens over, so the fold sits lower there than in a chat card
  // sharing the transcript with everything above it.
  const boundedHeight =
    maxHeightClass ??
    (chrome === 'compact'
      ? 'max-h-80'
      : chrome === 'dialog'
        ? 'max-h-[min(60vh,30rem)]'
        : 'max-h-[min(38vh,22rem)]')
  // Enter = primary action, Escape = dismiss. Centralized here so every view
  // (confirm/ask/quiz/media) inherits identical keyboard answering, and so there
  // is ONE listener per mounted frame to reason about. Latest handlers read via
  // refs; only replacing the resolved root ref needs to rebind the listener.
  const localRootRef = useRef<HTMLDivElement>(null)
  const resolvedRootRef = rootRef ?? localRootRef
  const submitRef = useRef(onSubmit)
  const instanceId = useId()
  const dismissRef = useRef(onDismiss)
  const dismissDisabledRef = useRef(dismissDisabled)
  const keyboardActiveRef = useRef(keyboardActive)
  useEffect(() => {
    submitRef.current = onSubmit
    dismissRef.current = onDismiss
    dismissDisabledRef.current = dismissDisabled
    keyboardActiveRef.current = keyboardActive
  })
  // Enter resolves and Escape dismisses — but only while this frame owns the keyboard. Being on the
  // focus stack is what makes that true: when the cross-session inbox dialog opens it claims the
  // top, this handler stops being offered the key, and a frame rendered BEHIND the modal can no
  // longer resolve a request the user cannot see. That used to be a `querySelector` for an open
  // dialog, which only worked for the one overlay somebody remembered to look for.
  useFocusEntry({
    // Per instance: two frames can be on screen at once; DOM focus selects the recipient.
    id: `hitl-frame:${instanceId}`,
    kind: 'surface',
    active: keyboardActive,
    scope: () => resolvedRootRef.current,
    onKeyDown: (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      if (event.key === 'Enter' && isTypingTarget(document.activeElement)) return
      if (!keyboardActiveRef.current) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!dismissDisabledRef.current) dismissRef.current()
        return true
      }
      if (!submitRef.current) return
      event.preventDefault()
      submitRef.current()
      return true
    },
  })

  return (
    // Bounded flex column: header + footer are pinned (shrink-0); only the body
    // scrolls. This guarantees the action buttons stay on-screen no matter how
    // large the content is (e.g. a multi-hundred-line bash script in a confirm).
    <div
      ref={resolvedRootRef}
      role="group"
      aria-label={title}
      data-slot="hitl-frame"
      data-chrome={chrome}
      className={cn('flex flex-col', boundedHeight, FRAME_CHROME[chrome].root)}
    >
      {showHeading && (
        <div className="flex shrink-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-xs font-medium leading-tight text-text-strong">
                {title}
              </span>
              {progress && (
                <span className="shrink-0 font-mono text-2xs leading-none text-text-faint">
                  {progress}
                </span>
              )}
            </div>
            {/* Two lines, not one: the detail is usually WHY the card exists (a rule's own
              words), and a single truncated line cut that reason off mid-sentence. */}
            {detail && (
              <div
                title={detail}
                className="mt-0.5 line-clamp-2 min-w-0 wrap-anywhere tabular-nums text-2xs leading-snug text-text-faint"
              >
                {detail}
              </div>
            )}
          </div>
          <IconButton
            size="md"
            className="-mt-0.5 -mr-1 shrink-0"
            onClick={onDismiss}
            aria-label={dismissLabel}
            disabled={dismissDisabled}
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
      )}

      {/* The ONE scroll owner, and it scrolls on ONE axis. `overflow-y-auto` alone does not
          say that: per CSS, a non-`visible` value on one axis computes the other to `auto`,
          so any child that could not wrap turned this into a horizontally scrolling pane.
          The children below were fixed to wrap (`min-w-0` on every flex/grid child, an
          explicit break strategy on every identifier and label), so `overflow-x-clip` here
          is a BACKSTOP against a future unbreakable string, not the thing holding the layout
          together — nothing currently reaches it. */}

      <div
        className={cn(
          'min-h-0 w-full min-w-0 flex-1 overflow-x-clip overflow-y-auto scrollbar-thin overscroll-contain pr-0.5',
          showHeading ? 'mt-3' : '',
        )}
      >
        {children}
      </div>

      <div
        role="group"
        aria-label="Request actions"
        className={cn(
          'flex shrink-0 flex-wrap items-center justify-end gap-1.5',
          FRAME_CHROME[chrome].footer,
        )}
      >
        {/* What happens if nobody touches this, on the left — the choices are on the right.
            Stated once, in the same words, on every kind of card. */}
        {!showHeading && progress && (
          <span className="font-mono text-2xs text-text-faint">{progress}</span>
        )}
        {expiresAt !== undefined && <DeadlineNote expiresAt={expiresAt} outcome={expiryOutcome} />}
        {/* Keep the actions together beside the deadline, but let larger ask footers wrap
            within the card on narrow screens instead of overflowing its edge. */}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {footer}
        </div>
      </div>
    </div>
  )
}
