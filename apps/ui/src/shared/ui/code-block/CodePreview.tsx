import { memo, useMemo } from 'react'
import { SUGAR_HIGH_THEME } from './sugarHighTheme'
import { highlightCode } from './highlightCode'

interface CodePreviewProps {
  code: string
  /** A supported fenced-code language id. Unknown and omitted languages stay plain. */
  language?: string
  /** Tailwind max-height utility (e.g. 'max-h-64'). */
  maxHeightClass?: string
  className?: string
  /** Drop the bordered/elevated surface chrome (border, radius, bg, padding) —
   * for full-panel contexts like the live file-change tab where the surrounding
   * panel already provides the frame. */
  bare?: boolean
  /** Render a blinking typing caret at the end of the code — for live, still-
   * streaming views so it reads as the agent typing in real time. */
  caret?: boolean
  /** Disable tokenization for an oversized or still-growing input. */
  syntaxHighlight?: boolean
}

/**
 * Compact, syntax-highlighted, scrollable code block for inline tool bodies.
 * Clean surface (white on light, elevated on dark) — no muddy gray. Lighter than
 * the full CodeBlock (no caption/copy chrome). Pass `bare` to drop the surface
 * chrome entirely.
 */
export const CodePreview = memo(function CodePreview({
  code,
  language,
  maxHeightClass = 'max-h-64',
  className,
  bare = false,
  caret = false,
  syntaxHighlight = true,
}: CodePreviewProps) {
  const normalized = useMemo(() => code.replace(/\n$/, ''), [code])
  const html = useMemo(
    () => (syntaxHighlight ? highlightCode(normalized, language) : ''),
    [language, normalized, syntaxHighlight],
  )
  const inner = caret ? `${html}<span class="lx-type-caret" aria-hidden="true"></span>` : html
  return (
    <pre
      className={[
        'overflow-auto scrollbar-thin',
        // Sunken, matching CodeBlock: a code inset deepens its pane rather than covering it.
        bare ? '' : 'rounded-md border border-control-border/55 bg-surface-sunken px-2.5 py-2',
        'font-mono text-2xs leading-[1.55]',
        maxHeightClass,
        SUGAR_HIGH_THEME,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {syntaxHighlight ? (
        <code
          className="block min-w-max whitespace-pre"
          dangerouslySetInnerHTML={{ __html: inner }}
        />
      ) : (
        <code className="block min-w-max whitespace-pre">
          {normalized}
          {caret && <span className="lx-type-caret" aria-hidden="true" />}
        </code>
      )}
    </pre>
  )
})
