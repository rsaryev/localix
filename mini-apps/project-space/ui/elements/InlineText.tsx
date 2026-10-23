import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { Textarea } from '@localixai/kit/textarea'
import { continueList, toggleMark, type TextEdit } from '../../shared/content/rich-edit'

/**
 * The format keys, as the marks they type (`shared/content/rich-text.ts`). A key is the primary
 * modifier plus the letter, with Shift where the plain letter belongs to the field already.
 */
export const FORMAT_KEYS: readonly { key: string; shift: boolean; token: string; does: string }[] =
  [
    { key: 'b', shift: false, token: '**', does: 'Bold' },
    { key: 'i', shift: false, token: '*', does: 'Italic' },
    { key: 'u', shift: false, token: '++', does: 'Underline' },
    { key: 'x', shift: true, token: '~~', does: 'Strikethrough' },
    { key: 'h', shift: true, token: '==', does: 'Highlight' },
    { key: 'e', shift: false, token: '`', does: 'Code' },
  ]

/**
 * Editing an element's plain text in place — notes, text, shapes, frame titles, link titles. Code
 * and Mermaid are edited in `CodeArea`, which highlights as it is typed.
 *
 * It commits once, when the editing ends (blur, or ⌘/Ctrl+Enter), so a note typed letter by
 * letter is one undo step and one write, not one per key. Escape leaves it unchanged. `nodrag`
 * and `nowheel` keep a text selection or a scroll inside it from moving the board under it.
 *
 * With `formatting`, the format keys wrap the selection in marks and Enter at the end of a list
 * item starts the next one. The edit is typed into the field as text (`insertText`), so the
 * field's own undo takes it back like any keystroke.
 */
export function InlineText({
  value,
  onCommit,
  onDone,
  className,
  style,
  placeholder,
  submitOnEnter = false,
  formatting = false,
}: {
  value: string
  onCommit: (value: string) => void
  onDone: () => void
  className?: string
  style?: CSSProperties
  placeholder?: string
  submitOnEnter?: boolean
  /** Format keys and list continuation: for text whose marks the element draws. */
  formatting?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const field = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const element = field.current
    if (!element) return
    element.focus()
    element.select()
  }, [])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit && draft !== value) onCommit(draft)
    onDone()
  }

  const apply = (edit: TextEdit) => {
    const element = field.current
    if (!element) return
    // Replace only what changed, so the field's undo restores exactly this edit.
    const before = element.value
    let head = 0
    while (head < before.length && before[head] === edit.value[head]) head++
    let tail = 0
    while (
      tail < before.length - head &&
      tail < edit.value.length - head &&
      before[before.length - 1 - tail] === edit.value[edit.value.length - 1 - tail]
    )
      tail++
    element.setSelectionRange(head, before.length - tail)
    const typed =
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, edit.value.slice(head, edit.value.length - tail))
    if (!typed || element.value !== edit.value) {
      element.value = edit.value
      setDraft(edit.value)
    }
    element.setSelectionRange(edit.start, edit.end)
  }

  const format = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!formatting) return false
    const element = event.currentTarget
    const { selectionStart: start, selectionEnd: end, value: text } = element
    if (isPrimaryModifier(event) && !event.altKey) {
      const key = FORMAT_KEYS.find(
        (entry) => entry.key === event.key.toLowerCase() && entry.shift === event.shiftKey,
      )
      if (!key) return false
      apply(toggleMark(text, start, end, key.token))
      return true
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && start === end) {
      const next = continueList(text, start)
      if (!next) return false
      apply(next)
      return true
    }
    return false
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (format(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    } else if (
      event.key === 'Enter' &&
      (isPrimaryModifier(event) || (submitOnEnter && !event.shiftKey && !event.altKey))
    ) {
      event.preventDefault()
      finish(true)
    }
    event.stopPropagation()
  }

  return (
    <Textarea
      ref={field}
      value={draft}
      placeholder={placeholder}
      aria-label="Edit the text"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={onKeyDown}
      style={style}
      className={cn(
        'nodrag nowheel h-full max-h-none min-h-0 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0',
        className,
      )}
    />
  )
}
