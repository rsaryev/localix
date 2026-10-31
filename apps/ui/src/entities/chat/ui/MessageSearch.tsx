import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, X, Search } from 'lucide-react'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'
import { CMD } from '@/shared/lib/keybindings'
import { registerActionHandler } from '@/shared/lib/actions'
import { IconButton } from '@localixai/kit/icon-button'
import {
  buildMessageSearchIndex,
  matchingIndexedIds,
  type SearchableMessage,
} from '../model/messageSearch'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { MESSAGE_SEARCH_OVERLAY_ID } from './MessageSearch.surface'
import { focusOnMount } from '@/shared/lib/focusOnMount'
import { FindWidgetCount, FindWidgetInput, FindWidgetSurface } from '@localixai/kit/find-widget'

interface MessageSearchProps {
  messages: SearchableMessage[]
  /** Active chat — switching it resets search (a query never crosses chats). */
  sessionId: string | null
}

/**
 * In-conversation find. Self-contained: opens on ⌘/Ctrl+F (unless a code editor
 * has focus — it owns that shortcut), computes matching message ids from the
 * `messages` it's handed, and publishes the active match to `messageSearchStore`
 * so the message list scrolls to it and that card rings. Esc / ✕ closes. The
 * only wiring it needs is being rendered inside the chat surface.
 */
export function MessageSearch({ messages, sessionId }: MessageSearchProps) {
  const open = useMessageSearchStore((s) => s.open)
  const setOpen = useMessageSearchStore((s) => s.setOpen)
  const setActiveId = useMessageSearchStore((s) => s.setActiveId)
  const takePending = useMessageSearchStore((s) => s.takePending)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // The field mounts when the find bar opens, and takes the caret as it does.
  const attachInput = useCallback((element: HTMLInputElement | null) => {
    inputRef.current = element
    focusOnMount(element)
  }, [])
  const requestedQuery = useRef<string | null>(null)

  useEffect(
    () =>
      subscribeUiOverlay(MESSAGE_SEARCH_OVERLAY_ID, (params) => {
        const query = typeof params.query === 'string' ? params.query : ''
        requestedQuery.current = query
        if (open) {
          setQuery(query)
          requestedQuery.current = null
        }
        setOpen(true)
      }),
    [open, setOpen],
  )

  // Only the focused ChatSurface mounts this owner. Initialize from a
  // cross-conversation pending query on EVERY mount: warm surfaces are stable
  // per session now, so waiting for this component's `sessionId` to change
  // would never consume a query when a hidden chat becomes focused.
  useEffect(() => {
    const pending = sessionId ? takePending(sessionId) : null
    if (pending) {
      // The external navigation bus changed chat scope; seed this focused
      // owner's local field and open the shared presentation state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery(pending)
      setOpen(true)
    } else {
      setOpen(false)
      setQuery('')
    }
    return () => setOpen(false)
  }, [sessionId, setOpen, takePending])

  // Two-part remedy for a find bar over a long transcript, delaying both the
  // query trigger and the refresh:
  //  1. lowercase every message body ONCE per message list, not once per
  //     keystroke — a keystroke now costs one `includes` per message;
  //  2. run the scan against a DEFERRED query, so a fast typist's keystrokes
  //     paint the input immediately and the scan runs on the settled value.
  // Everything derived from the scan (matches, count, active match) reads the
  // same deferred query, so the count can never disagree with the result set.
  const searchIndex = useMemo(() => buildMessageSearchIndex(messages), [messages])
  const scanQuery = useDeferredValue(query)
  const matches = useMemo(
    () => matchingIndexedIds(searchIndex, scanQuery),
    [searchIndex, scanQuery],
  )

  // Reset position when the query changes (render-time adjust, per React's
  // derived-state guidance); clamp so a shrinking set is safe.
  const [lastQuery, setLastQuery] = useState(scanQuery)
  if (lastQuery !== scanQuery) {
    setLastQuery(scanQuery)
    setIndex(0)
  }
  const active = matches.length ? matches[Math.min(index, matches.length - 1)] : null

  // Publish the active match (scroll + ring); clear it whenever search is closed.
  useEffect(() => {
    setActiveId(open ? (active ?? null) : null)
  }, [open, active, setActiveId])
  // On OPEN, seed the query from the current text selection (standard find-bar
  // affordance: select a term in a message, ⌘F, and it's searched immediately),
  // then select the input so a fresh type replaces it. Covers both the keyboard
  // shortcut and the header button.
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current) {
      const requested = requestedQuery.current
      requestedQuery.current = null
      const sel = requested ?? window.getSelection()?.toString().trim() ?? ''
      // Read the browser selection exactly once at the open transition; it is
      // intentionally copied into editable local input state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sel && sel.length <= 100 && !sel.includes('\n')) setQuery(sel)
      else if (requested !== null) setQuery('')
      requestAnimationFrame(() => inputRef.current?.select())
    }
    wasOpen.current = open
  }, [open])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [setOpen])
  const step = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const n = matches.length
        if (n === 0) return 0
        return (i + delta + n) % n
      })
    },
    [matches.length],
  )

  // "Find in conversation" opens (focus-aware: leave the code editor's own find
  // alone). The chord is registry-resolved so it honors user rebinds.
  useEffect(
    () =>
      registerActionHandler({
        commandId: CMD.findInChat,
        // Monaco owns its own find widget, so the chord belongs to the editor while it has focus.
        enabled: () =>
          !(document.activeElement as HTMLElement | null)?.closest(
            '.localix-monaco-editor, .monaco-editor',
          ),
        run: () => setOpen(true), // the open-effect seeds from selection + selects the input
      }),
    [setOpen],
  )

  if (!open) return null

  return (
    <FindWidgetSurface aria-label="Find in conversation">
      <Search className="ml-1 size-3.5 shrink-0 text-text-faint" />
      <FindWidgetInput
        ref={attachInput}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
        aria-label="Find in conversation"
        placeholder="Find in conversation"
        className="w-44 text-text-strong"
      />
      <FindWidgetCount query={scanQuery} count={matches.length} index={index} />
      <IconButton
        size="sm"
        disabled={matches.length === 0}
        onClick={() => step(-1)}
        tooltip="Previous (⇧⏎)"
        aria-label="Previous match"
        className="hover:text-text-soft disabled:opacity-30"
      >
        <ChevronUp className="size-3.5" />
      </IconButton>
      <IconButton
        size="sm"
        disabled={matches.length === 0}
        onClick={() => step(1)}
        tooltip="Next (⏎)"
        aria-label="Next match"
        className="hover:text-text-soft disabled:opacity-30"
      >
        <ChevronDown className="size-3.5" />
      </IconButton>
      <IconButton
        size="sm"
        onClick={close}
        tooltip="Close (Esc)"
        aria-label="Close search"
        className="hover:text-text-soft"
      >
        <X className="size-3.5" />
      </IconButton>
    </FindWidgetSurface>
  )
}
