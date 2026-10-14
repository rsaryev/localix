import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore, type ChatStore } from '../../model/store'
import { loadPromptHistory } from '../../model/persistence'
import { type HistoryNav, IDLE_NAV, stepOlder, stepNewer } from './promptHistoryNav'
import { buildPromptRecallList } from './promptRecallList'

const EMPTY: string[] = []
const EMPTY_MESSAGES: ChatStore['sessions'][number]['messages'] = []

export function selectPromptHistoryMessages(
  state: Pick<ChatStore, 'sessions'>,
  sessionId: string | null,
) {
  return (
    state.sessions
      .find((session) => session.id === sessionId)
      ?.messages.filter((message) => message.role === 'user') ?? EMPTY_MESSAGES
  )
}

/**
 * Shell-style prompt-history recall for the composer. Sources the current
 * session's previously-sent user prompts (most recent) merged with the GLOBAL,
 * cross-session history (localStorage), de-duped, ordered oldest→newest, and
 * walks them with ArrowUp/ArrowDown.
 *
 * `recallPrev` stashes the live draft on first step so ArrowDown past the newest
 * entry restores exactly what was being typed. Navigation index lives in a ref
 * (no re-render); call `reset()` whenever the text changes for any reason other
 * than a recall (i.e. the user typed) so the next ArrowUp starts fresh.
 */
export function usePromptHistory(sessionId: string | null) {
  // Assistant deltas replace the session's messages array but cannot change recall history.
  // Shallow selection keeps the user-message projection stable across those deltas.
  const messages = useChatStore(
    useShallow((state) => selectPromptHistoryMessages(state, sessionId)),
  )
  const prompts = useMemo(() => {
    // Pure merge of this session's prompts + the global cross-session history
    // (tested in promptRecallList). `messages` is the memo dep — re-reads the
    // global store on every send/switch; EMPTY keeps an empty result stable.
    const list = buildPromptRecallList(messages ?? [], loadPromptHistory())
    return list.length ? list : EMPTY
  }, [messages])

  // Navigation cursor lives in a ref (no re-render); the stepping math is the pure
  // stepOlder/stepNewer (tested in promptHistoryNav.test).
  const navRef = useRef<HistoryNav>(IDLE_NAV)

  const recallPrev = useCallback(
    (current: string): string | null => {
      const step = stepOlder(prompts, navRef.current, current)
      navRef.current = step.nav
      return step.value
    },
    [prompts],
  )

  const recallNext = useCallback((): string | null => {
    const step = stepNewer(prompts, navRef.current)
    navRef.current = step.nav
    return step.value
  }, [prompts])

  const reset = useCallback(() => {
    navRef.current = IDLE_NAV
  }, [])
  const isNavigating = useCallback(() => navRef.current.index !== -1, [])

  // Stable identity — only changes when the recall callbacks do (i.e. when the
  // prompt list changes), so consumers' effects don't run every render.
  return useMemo(
    () => ({ recallPrev, recallNext, reset, isNavigating }),
    [recallPrev, recallNext, reset, isNavigating],
  )
}

/**
 * Wires shell-style ArrowUp/Down prompt-history recall onto the composer
 * textarea. Owns the history hook, resets navigation when the text changes for
 * any reason other than a recall, and returns a keydown handler that recalls
 * older/newer prompts (returning `true` when it consumed the event).
 *
 * `menusOpen` lets the caller yield the arrow keys to any open autocomplete menu
 * (slash / slash-arg / @-ref) that owns navigation while visible.
 */
export function useHistoryKeyDown(
  sessionId: string | null,
  prompt: string,
  setPrompt: (text: string) => void,
  menusOpen: boolean,
) {
  const history = usePromptHistory(sessionId)
  const lastRecalledRef = useRef<string | null>(null)
  useEffect(() => {
    if (prompt !== lastRecalledRef.current) history.reset()
  }, [prompt, history])

  return useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (menusOpen) return false // menus own the arrows
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false
      const ta = e.currentTarget
      if (ta.selectionStart !== ta.selectionEnd) return false // an active selection — leave arrows alone
      const apply = (text: string) => {
        lastRecalledRef.current = text
        setPrompt(text)
        // Caret to end once React has committed the new value.
        requestAnimationFrame(() => {
          const end = ta.value.length
          ta.setSelectionRange(end, end)
        })
      }
      if (e.key === 'ArrowUp') {
        // Only from the first line, so cursor nav within a multi-line draft (or a
        // recalled multi-line entry) still works — you reach the top, then recall.
        const onFirstLine = ta.value.slice(0, ta.selectionStart).indexOf('\n') === -1
        if (!onFirstLine) return false
        const recalled = history.recallPrev(ta.value)
        if (recalled == null) return false
        e.preventDefault()
        apply(recalled)
        return true
      }
      // ArrowDown — only while navigating, and only from the last line.
      if (!history.isNavigating()) return false
      const onLastLine = ta.value.slice(ta.selectionEnd).indexOf('\n') === -1
      if (!onLastLine) return false
      e.preventDefault()
      apply(history.recallNext() ?? '')
      return true
    },
    [menusOpen, history, setPrompt],
  )
}
