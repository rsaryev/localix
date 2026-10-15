import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { reduceMentionMenu, resourceParentPartial } from '@localixai/api/context-refs'
import type { AtRefToken } from './atRefAccept'
import type { AtRefSuggestion } from './atRefSuggestions'

interface AtRefKeyboardInput {
  isOpen: boolean
  suggestions: AtRefSuggestion[]
  activeIndex: number
  setActiveIndex: Dispatch<SetStateAction<number>>
  accept: (suggestion: AtRefSuggestion, action?: 'default' | 'link') => void
  tokenSignature: string | null
  dismissedAt: string | null
  setDismissedAt: Dispatch<SetStateAction<string | null>>
  token: AtRefToken | null
  prompt: string
  setPrompt: (value: string) => void
}

/** The `@`-picker's keyboard: Escape dismisses, arrows move/back/link, Tab/Enter accept.
 *  Returns true when the key was consumed. */
export function useAtRefKeyboard({
  isOpen,
  suggestions,
  activeIndex,
  setActiveIndex,
  accept,
  tokenSignature,
  dismissedAt,
  setDismissedAt,
  token,
  prompt,
  setPrompt,
}: AtRefKeyboardInput): (e: React.KeyboardEvent) => boolean {
  return useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen) return false
      // Escape always closes the menu, even with no hits.
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissedAt(
          reduceMentionMenu(
            { signature: tokenSignature, index: activeIndex, dismissedSignature: dismissedAt },
            { type: 'dismiss' },
          ).dismissedSignature,
        )
        return true
      }
      // Back remains available even when the current resource container is empty
      // or its fetch failed, so navigation can never strand the picker.
      if (e.key === 'ArrowLeft' && token?.mode === 'resource' && token.partial) {
        e.preventDefault()
        const before = prompt.slice(0, token.start)
        const after = prompt.slice(token.end)
        setPrompt(`${before}@resource:${resourceParentPartial(token.partial)}${after}`)
        return true
      }
      if (suggestions.length === 0) return false
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(
          (i) =>
            reduceMentionMenu(
              { signature: tokenSignature, index: i, dismissedSignature: dismissedAt },
              { type: 'move', delta: 1, rowCount: suggestions.length },
            ).index,
        )
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(
          (i) =>
            reduceMentionMenu(
              { signature: tokenSignature, index: i, dismissedSignature: dismissedAt },
              { type: 'move', delta: -1, rowCount: suggestions.length },
            ).index,
        )
        return true
      }
      // `→` on a drillable node LINKS the container itself (instead of drilling into
      // it with Enter). Only intercepted for container rows; on a leaf/flat row it
      // falls through so the arrow key moves the caret normally.
      if (e.key === 'ArrowRight') {
        const pick = suggestions[activeIndex] ?? suggestions[0]
        // `→` LINKS the highlighted row (a container instead of drilling; an action
        // row runs it). Only intercepted for drillable/action rows; on a leaf/flat
        // row it falls through so the arrow moves the caret normally.
        if (pick?.isDir || pick?.isAction) {
          e.preventDefault()
          accept(pick, pick.navigationOnly ? 'default' : 'link')
          return true
        }
        return false
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        const pick = suggestions[activeIndex] ?? suggestions[0]
        if (pick) {
          e.preventDefault()
          accept(pick)
          return true
        }
      }
      return false
    },
    [
      isOpen,
      suggestions,
      activeIndex,
      accept,
      tokenSignature,
      dismissedAt,
      token,
      prompt,
      setPrompt,
      setActiveIndex,
      setDismissedAt,
    ],
  )
}
