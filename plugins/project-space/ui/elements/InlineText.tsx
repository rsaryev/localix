import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { Textarea } from '@localixai/kit/textarea'

/**
 * Editing an element's plain text in place — notes, text, shapes, frame titles, link titles. Code
 * and Mermaid are edited in `CodeArea`, which highlights as it is typed.
 *
 * It commits once, when the editing ends (blur, or ⌘/Ctrl+Enter), so a note typed letter by
 * letter is one undo step and one write, not one per key. Escape leaves it unchanged. `nodrag`
 * and `nowheel` keep a text selection or a scroll inside it from moving the board under it.
 */
export function InlineText({
  value,
  onCommit,
  onDone,
  className,
  placeholder,
  submitOnEnter = false,
}: {
  value: string
  onCommit: (value: string) => void
  onDone: () => void
  className?: string
  placeholder?: string
  submitOnEnter?: boolean
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
      className={cn(
        'nodrag nowheel h-full max-h-none min-h-0 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0',
        className,
      )}
    />
  )
}
