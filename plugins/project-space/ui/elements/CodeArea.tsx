import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { CODE_VIEWER_HIGHLIGHT } from '@localixai/kit/code-block'
import { isPrimaryModifier } from '@localixai/kit/keybindings'

/**
 * Editing code in place, coloured as it is typed.
 *
 * A transparent native textarea over a highlighted `<pre>` of the very same metrics (the
 * technique of react-simple-code-editor and CodePen's embeds): the textarea does the typing, the
 * caret, selection and IME; the layer beneath shows the colours through it. A real editor
 * (Monaco, the kit's `CodeEditor`) measures the pointer against its own layout and misplaces the
 * caret under the board's CSS zoom — a textarea is measured by the browser, at any zoom.
 *
 * Both layers sit in one grid cell, so the textarea grows with the text instead of scrolling on
 * its own and drifting out of line with the colours. It commits the way `InlineText` does: once,
 * on blur or ⌘/Ctrl+Enter; Escape leaves the text as it was. Tab indents by two spaces.
 */
const METRICS = 'font-mono text-2xs leading-[1.6] [tab-size:2] whitespace-pre'
const INDENT = '  '

export function CodeArea({
  value,
  highlight,
  onCommit,
  onDone,
  gutter = false,
  className,
  label = 'Edit the code',
}: {
  value: string
  /** The text as highlighted, escaped HTML. */
  highlight: (text: string) => string
  onCommit: (value: string) => void
  onDone: () => void
  gutter?: boolean
  className?: string
  label?: string
}) {
  const [draft, setDraft] = useState(value)
  const field = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  // A trailing newline in a textarea is a line the <pre> would not draw without one more.
  const html = useMemo(() => `${highlight(draft)}\n`, [draft, highlight])
  const lines = draft.split('\n').length

  useEffect(() => {
    const element = field.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit && draft !== value) onCommit(draft)
    onDone()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    } else if (event.key === 'Enter' && isPrimaryModifier(event)) {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.setRangeText(
        INDENT,
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
        'end',
      )
      setDraft(event.currentTarget.value)
    }
  }

  return (
    <div className={cn('nodrag nowheel flex min-h-full min-w-full', className)}>
      {gutter && (
        <div
          aria-hidden
          className={cn(METRICS, 'shrink-0 select-none pl-2 pr-3 text-right text-text-faint/60')}
          style={{ width: `${String(lines).length + 3}ch` }}
        >
          {Array.from({ length: lines }, (_, row) => (
            <div key={row}>{row + 1}</div>
          ))}
        </div>
      )}
      <div className="grid min-w-0 flex-1">
        <pre
          aria-hidden
          className={cn(
            METRICS,
            CODE_VIEWER_HIGHLIGHT,
            'pointer-events-none m-0 bg-transparent p-0 [grid-area:1/1]',
          )}
          style={{ fontVariantLigatures: 'none' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <textarea
          ref={field}
          value={draft}
          aria-label={label}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={onKeyDown}
          className={cn(
            METRICS,
            'm-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none [grid-area:1/1]',
          )}
          style={{
            fontVariantLigatures: 'none',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
            caretColor: 'var(--foreground)',
          }}
        />
      </div>
    </div>
  )
}
