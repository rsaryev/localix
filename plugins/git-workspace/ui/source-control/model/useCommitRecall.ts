import { useRef, useState, type RefObject } from 'react'

/**
 * ↑/↓ recall of recent commit messages into the commit field (shell-style).
 *
 * ↑ at the very START of the field cycles to older messages, ↓ at its END walks back toward the
 * live draft, which is set aside when recall starts and restored at the bottom. Any manual edit
 * drops out of recall, so navigation never eats normal typing or caret movement inside a body.
 * `caretRef` holds the caret a recalled value should land at once it renders; the field applies
 * it after layout.
 */
export function useCommitRecall(
  recentMessages: readonly string[],
  message: string,
  setMessage: (text: string) => void,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
) {
  // Index into `recentMessages`; -1 = the live draft.
  const [histIndex, setHistIndex] = useState(-1)
  const draftRef = useRef('')
  const caretRef = useRef<number | null>(null)

  const edit = (text: string) => {
    if (histIndex !== -1) setHistIndex(-1)
    setMessage(text)
  }

  const recall = (text: string, caret: number) => {
    caretRef.current = caret
    setMessage(text)
  }

  /** Returns true when the key was consumed by recall. */
  const navigate = (dir: 'older' | 'newer'): boolean => {
    if (recentMessages.length === 0) return false
    const el = fieldRef.current
    if (dir === 'older') {
      if (el && el.selectionStart !== 0) return false
      if (histIndex === -1) draftRef.current = message
      const next = Math.min(histIndex + 1, recentMessages.length - 1)
      if (next === histIndex) return true // already at the oldest — swallow
      setHistIndex(next)
      recall(recentMessages[next] ?? '', 0)
      return true
    }
    if (histIndex === -1) return false
    if (el && el.selectionStart !== el.value.length) return false
    const next = histIndex - 1
    setHistIndex(next)
    if (next < 0) {
      recall(draftRef.current, draftRef.current.length)
    } else {
      const text = recentMessages[next] ?? ''
      recall(text, text.length)
    }
    return true
  }

  return { edit, navigate, reset: () => setHistIndex(-1), caretRef }
}
