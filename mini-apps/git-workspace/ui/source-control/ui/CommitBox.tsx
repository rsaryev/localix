import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Spinner } from '@localixai/kit/spinner'
import { InlineCompletionGhost } from '@localixai/kit/inline-completion-ghost'
import {
  useMiniAppEditPredictionEnabled,
  useMiniAppTextInputCompletion,
} from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { Button } from '@localixai/kit/button'
import { useCommitRecall } from '../model/useCommitRecall'
import { CommitBoxFooter } from './CommitBoxFooter'

// Namespaced, matching what the mini app's backend registers. The bare `'commit'` this used to send
// reached no surface at all once the id space opened: core owns only un-namespaced ids.
const COMMIT_COMPLETION_SURFACE_ID = 'git-workspace.commit' as const

/**
 * Minimalist commit composer: an auto-growing message field (one line at rest,
 * expands to show a body) with inline completion and a **Commit** button. A
 * textarea — not an input — so multi-line messages keep their body. Commit is
 * enabled whenever there's a message; the parent stages everything first when
 * nothing is staged. ⌘/Ctrl+Enter commits.
 *
 * An **Amend** toggle rewrites the last commit instead of adding a new one: it
 * prefills the field with HEAD's message (recall) and, on commit, folds the
 * staged changes into that commit. A subject-length hint nudges toward the
 * 50/72 Conventional-Commits convention.
 *
 * ↑/↓ recall recent commit messages into the field (shell-style): ↑ at the
 * very start of the field cycles to older messages, ↓ walks back toward the live
 * draft. Editing the text exits recall so navigation never eats normal typing.
 */
export function CommitBox({
  sessionId,
  repoRoot,
  contextKey,
  stagedCount,
  headMessage,
  recentMessages,
  refreshContext,
  onCommit,
  onAmend,
}: {
  sessionId: string
  /** Active multi-root repository; the server validates and resolves it. */
  repoRoot?: string
  /** Cheap client-side invalidation key; rich diff context stays server-side. */
  contextKey: string
  stagedCount: number
  /** HEAD's commit message (for amend prefill); null on an unborn branch — hides the toggle. */
  headMessage: string | null
  /** Recent commit messages (newest first) for ↑/↓ recall. */
  recentMessages: string[]
  /** Re-read status/changeVersion before this field becomes completion-eligible. */
  refreshContext?: () => Promise<void>
  /** Resolves true only when the operation succeeded and the draft may be cleared. */
  onCommit: (message: string) => Promise<boolean>
  /** Resolves true only when the operation succeeded and the draft may be cleared. */
  onAmend: (message: string) => Promise<boolean>
}) {
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [amendOn, setAmendOn] = useState(false)
  const [focused, setFocused] = useState(false)
  const [contextReady, setContextReady] = useState(true)
  const [caretAtEnd, setCaretAtEnd] = useState(true)
  // The message we auto-filled when Amend was toggled on — so toggling off can
  // clear it iff the user hasn't since edited it.
  const prefilledRef = useRef<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const contextRefreshRef = useRef(0)
  const history = useCommitRecall(recentMessages, message, setMessage, ref)
  const { caretRef, edit: editMessage } = history

  const completionEnabled = useMiniAppEditPredictionEnabled()
  const completion = useMiniAppTextInputCompletion({
    surface: COMMIT_COMPLETION_SURFACE_ID,
    sessionId,
    value: message,
    setValue: (next) => {
      caretRef.current = next.length
      editMessage(next)
    },
    payload: { draft: message, ...(repoRoot ? { repoRoot } : {}) },
    contextKey,
    enabled: completionEnabled,
    active: !committing && contextReady && !message.includes('\n') && message.length < 72,
    focused,
    caretAtEnd,
  })

  const reportCaret = () => {
    const element = ref.current
    if (!element) return
    setCaretAtEnd(
      element.selectionStart === element.selectionEnd &&
        element.selectionEnd === element.value.length,
    )
  }

  const canAmend = headMessage !== null
  // Effective amend intent — auto-off when nothing is amendable (unborn branch),
  // derived so no effect needs to reconcile the toggle with `canAmend`.
  const amend = amendOn && canAmend

  const toggleAmend = (next: boolean) => {
    setAmendOn(next)
    history.reset()
    if (next) {
      // Recall HEAD's message when the field is empty, so amend starts from it.
      if (!message.trim() && headMessage) {
        prefilledRef.current = headMessage
        setMessage(headMessage)
      }
    } else if (prefilledRef.current !== null && message === prefilledRef.current) {
      // User toggled off without editing the recalled message — clear it.
      setMessage('')
      prefilledRef.current = null
    }
  }

  // Auto-grow to fit the message (capped) + apply any pending recall caret.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    if (caretRef.current !== null) {
      const pos = caretRef.current
      caretRef.current = null
      el.setSelectionRange(pos, pos)
    }
    // `caretRef` is a ref (stable); listed because the linter cannot see through the hook.
  }, [message, caretRef])

  const canSubmit = message.trim().length > 0 && !committing
  const submit = async () => {
    if (!canSubmit) return
    setCommitting(true)
    try {
      const succeeded = await (amend ? onAmend(message.trim()) : onCommit(message.trim()))
      if (!succeeded) return
      setMessage('')
      history.reset()
      prefilledRef.current = null
      setAmendOn(false)
    } finally {
      setCommitting(false)
    }
  }

  // Subject-line length hint (Conventional Commits: ≤50 ideal, ≤72 hard limit).
  const subjectLen = message.split('\n', 1)[0]?.length ?? 0

  return (
    // Pinned to the BOTTOM of the panel (composer-style, like the chat input), so
    // the border sits on top and the changes/log panes scroll above it.
    <div className="shrink-0 border-t border-border px-2.5 py-2">
      {/* The `--input` veil like every other field shell, not `bg-surface-raised`: raised mixes
          from a darker ground than the panel, so the commit box read as a black bar at its foot. */}
      <div className="flex items-center gap-1.5 rounded-lg border border-control-border bg-input/20 py-1 pl-2.5 pr-1.5 transition-colors focus-within:border-control-border-focus dark:bg-input/30">
        <div className="relative min-w-0 flex-1">
          {completion.suggestion && (
            <div
              ref={mirrorRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap break-words text-xs leading-5 text-transparent"
            >
              {message}
              <InlineCompletionGhost>{completion.suggestion}</InlineCompletionGhost>
            </div>
          )}
          <textarea
            aria-label={amend ? 'Amend commit message' : 'Commit message'}
            disabled={committing}
            onCompositionStart={completion.handleCompositionStart}
            onCompositionEnd={completion.handleCompositionEnd}
            ref={ref}
            rows={1}
            value={message}
            onChange={(event) => {
              editMessage(event.target.value)
              setCaretAtEnd(
                event.target.selectionStart === event.target.selectionEnd &&
                  event.target.selectionEnd === event.target.value.length,
              )
            }}
            onFocus={() => {
              setFocused(true)
              reportCaret()
              if (refreshContext) {
                const request = ++contextRefreshRef.current
                setContextReady(false)
                void refreshContext().finally(() => {
                  if (request === contextRefreshRef.current) setContextReady(true)
                })
              }
            }}
            onBlur={() => {
              contextRefreshRef.current++
              setFocused(false)
            }}
            onSelect={reportCaret}
            onClick={reportCaret}
            onKeyUp={reportCaret}
            onScroll={(event) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (completion.handleKeyDown(event)) return
              // Commit chord (⌘/Ctrl+Enter); plain Enter inserts a message body line.
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void submit()
                return
              }
              // ↑/↓ recall recent commit messages (only from the field edge, and
              // never with a modifier — leave word/line-jump chords untouched).
              if (
                (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey
              ) {
                if (history.navigate(event.key === 'ArrowUp' ? 'older' : 'newer'))
                  event.preventDefault()
              }
            }}
            placeholder={
              completion.suggestion
                ? ''
                : amend
                  ? 'Amend the last commit…'
                  : 'Commit message (Conventional Commits)…'
            }
            className="relative block max-h-40 w-full resize-none bg-transparent text-xs leading-5 text-text-strong placeholder:text-text-faint focus:outline-none scrollbar-thin"
          />
        </div>
        <Button
          variant="mono"
          size="sm"
          onClick={() => void submit()}
          disabled={!canSubmit}
          title={
            amend
              ? 'Rewrite the last commit with these changes (⌘/Ctrl+Enter)'
              : stagedCount > 0
                ? `Commit ${stagedCount} staged file${stagedCount === 1 ? '' : 's'} (⌘/Ctrl+Enter)`
                : 'Stage all changes and commit (⌘/Ctrl+Enter)'
          }
          // Solid mono fill (the app's "do it" action style), not `bg-accent`: under glass
          // `accent` is a 6% foreground VEIL, so the panel's one primary action — Commit —
          // rendered as near-white text on almost nothing.
        >
          {committing ? <Spinner className="size-3" /> : <Check className="size-3" />}
          {amend ? 'Amend' : 'Commit'}
        </Button>
      </div>

      <CommitBoxFooter
        canAmend={canAmend}
        amend={amend}
        committing={committing}
        subjectLen={subjectLen}
        onToggleAmend={() => toggleAmend(!amend)}
      />
    </div>
  )
}
