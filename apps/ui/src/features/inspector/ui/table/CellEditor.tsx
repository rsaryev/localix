import { useEffect, useRef, useState } from 'react'
import { Input } from '@localixai/kit/input'
import { matchesChord, withChordHint } from '@/shared/lib/keybindings'

/**
 * In-place cell editor. Enter or blur commits the typed text; Ctrl/Cmd+Enter or the ∅
 * button commits an explicit NULL; Esc cancels. A single-commit guard keeps blur from
 * double-firing after an explicit commit.
 */
export function CellEditor({
  initial,
  label,
  onCommit,
  onCancel,
  allowNull = true,
}: {
  initial: string
  label: string
  onCommit: (next: string | null) => void
  onCancel: () => void
  allowNull?: boolean
}) {
  const [text, setText] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const restoreFocus = () => {
    if (document.activeElement === inputRef.current)
      inputRef.current?.closest<HTMLElement>('[role="table"]')?.focus({ preventScroll: true })
  }
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const commit = (next: string | null) => {
    if (done.current) return
    done.current = true
    restoreFocus()
    onCommit(next)
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const nullShortcut = matchesChord(e, 'mod+enter')
            if (!nullShortcut && (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)) return
            e.preventDefault()
            commit(nullShortcut && allowNull ? null : text)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            done.current = true
            restoreFocus()
            onCancel()
          }
        }}
        onBlur={() => commit(text)}
        spellCheck={false}
        aria-label={`Edit ${label}`}
        // No fill override: Input already carries the `--input` veil, and `bg-surface-raised`
        // mixes from a darker ground than the header row, so the edit field read as a black slot.
        className="h-6 min-w-0 flex-1 rounded-sm border-control-border-focus px-1 py-0.5 text-xs"
      />
      {allowNull && (
        <button
          type="button"
          title={withChordHint('Set NULL', 'mod+enter')}
          onMouseDown={(e) => {
            e.preventDefault()
            commit(null)
          }}
          className="shrink-0 cursor-pointer rounded-sm px-1 text-2xs text-text-faint hover:text-foreground"
        >
          ∅
        </button>
      )}
    </div>
  )
}
