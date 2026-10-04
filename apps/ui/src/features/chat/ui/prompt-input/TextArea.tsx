import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

// Max auto-grow height in px — keep in sync with the `max-h-44` cap on the
// textarea className below (44 × 0.25rem = 11rem = 176px).
const MAX_HEIGHT = 176

/**
 * Text the measuring mirror renders for a given draft.
 *
 * `white-space: pre-wrap` drops a single trailing newline (and an empty string
 * has no line box at all), while a textarea's own scrollHeight counts both — so
 * the mirror needs one trailing space to land on the same height.
 */
export function autogrowMirrorText(value: string): string {
  return value === '' || value.endsWith('\n') ? `${value} ` : value
}

/** The height to write, or null when nothing should be written. */
export function autogrowHeight(contentHeight: number, lastHeight: number): number | null {
  // A composer inside a hidden pane measures 0 — not a real height, and writing
  // it would stick until the next edit. The width observer re-runs on reveal.
  if (!(contentHeight > 0)) return null
  const next = Math.min(contentHeight, MAX_HEIGHT)
  return next === lastHeight ? null : next
}

interface TextAreaProps {
  value: string
  onChange: (v: string) => void
  onFocus: () => void
  onBlur: () => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
  onSubmit: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean | void
  placeholder: string
  disabled: boolean
  prefix?: ReactNode
  /** Optional transparent mirror layer drawn behind the text (e.g. mention pills).
   *  Receives the current value; must mirror the textarea's typography exactly. */
  highlight?: (value: string) => ReactNode
  /** Fired when the caret moves (select/keyup/click/focus) — `atEnd` is true when
   *  the caret (collapsed) sits at the very end of the text (drives composer ghost
   *  text); `offset` + `text` report WHERE in WHICH value it sits, so consumers can
   *  detect a stale offset after a programmatic value change (caret-aware @-menu). */
  onCaretChange?: (atEnd: boolean, offset: number, text: string) => void
  /** Active completion list owned by this textbox; focus remains in the composer
   *  while Arrow keys move the virtual option. */
  completion?: { open: boolean; menuId: string; activeOptionId?: string }
}

export function TextArea({
  value,
  onChange,
  onFocus,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  onSubmit,
  onKeyDown,
  placeholder,
  disabled,
  prefix,
  highlight,
  onCaretChange,
  completion,
}: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const lastHeightRef = useRef(-1)

  const reportCaret = useCallback(() => {
    if (!onCaretChange) return
    const el = ref.current
    if (!el) return
    const atEnd = el.selectionStart === el.selectionEnd && el.selectionEnd === el.value.length
    onCaretChange(atEnd, el.selectionEnd ?? el.value.length, el.value)
  }, [onCaretChange])

  // Keep the highlight mirror scroll-aligned with the textarea.
  const syncScroll = useCallback(() => {
    const el = ref.current
    const mirror = mirrorRef.current
    if (el && mirror) mirror.scrollTop = el.scrollTop
  }, [])

  // Autogrow measures the MIRROR, never the live textarea. Writing
  // `height: auto` on the textarea and reading its scrollHeight back is a
  // forced synchronous reflow on every keystroke (write → invalidate → full
  // recalc → read → write again). The mirror carries the same width and
  // typography with its height left free, so one read of an element we did not
  // just dirty answers the same question — and the write below is skipped
  // entirely while the height is unchanged, which is most keystrokes.
  const resize = useCallback(() => {
    const el = ref.current
    const measure = measureRef.current
    if (!el || !measure) return
    const next = autogrowHeight(measure.scrollHeight, lastHeightRef.current)
    if (next === null) return
    lastHeightRef.current = next
    el.style.height = `${next}px`
  }, [])

  // Recompute on every edit, before paint so the grown row and the new
  // character land in the same frame.
  useLayoutEffect(() => {
    resize()
  }, [value, resize])

  // Also recompute when the textarea's WIDTH changes (panel/window resize
  // re-wraps the text): without this a multi-line draft keeps a stale height
  // until the next keystroke. Width-gated so our own height writes don't loop.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let lastWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth
        resize()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [resize])

  return (
    <div className="flex flex-wrap items-start gap-2 px-3.5 pt-1.5 max-sm:px-2.5">
      {prefix}
      {/* `basis-48` keeps a usable min input width: when the leading chip cluster
          (`prefix`) leaves less than ~12rem, the row wraps and the textarea drops
          to its own full-width line instead of collapsing to a 1-char column. */}
      <div className="relative min-w-0 flex-1 basis-48">
        {/* Measuring mirror for the autogrow height. Same box width and
            typography as the textarea, height left free and nothing clipped, so
            its scrollHeight IS the natural content height. `invisible` keeps it
            laid out (unlike `hidden`), and it is absolute so it never
            contributes to the row's own height. */}
        <div
          ref={measureRef}
          aria-hidden
          data-autogrow-mirror=""
          className="pointer-events-none invisible absolute left-0 top-0 w-full whitespace-pre-wrap break-words text-base leading-[1.55] max-sm:text-sm"
        >
          {autogrowMirrorText(value)}
        </div>
        {highlight && (
          <div
            ref={mirrorRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 max-h-44 overflow-hidden whitespace-pre-wrap break-words text-base leading-[1.55] text-transparent max-sm:text-sm"
          >
            {highlight(value)}
          </div>
        )}
        <textarea
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          ref={ref}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            reportCaret()
          }}
          onFocus={() => {
            onFocus()
            reportCaret()
          }}
          onBlur={onBlur}
          onScroll={syncScroll}
          onSelect={reportCaret}
          onClick={reportCaret}
          onKeyUp={reportCaret}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (onKeyDown?.(e)) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={completion?.open ?? false}
          aria-controls={completion?.open ? completion.menuId : undefined}
          aria-activedescendant={completion?.open ? completion.activeOptionId : undefined}
          className="relative block w-full min-h-7 max-h-44 resize-none border-none bg-transparent text-base leading-[1.55] text-foreground outline-none caret-foreground placeholder:text-control-border-focus disabled:cursor-not-allowed disabled:opacity-45 max-sm:text-sm"
        />
      </div>
    </div>
  )
}
