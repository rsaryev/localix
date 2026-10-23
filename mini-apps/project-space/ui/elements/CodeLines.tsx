import { memo, useEffect, useMemo, useState } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  CODE_VIEWER_HIGHLIGHT,
  colorizeCode,
  hasHighlightGrammar,
  highlightCode,
} from '@localixai/kit/code-block'

/**
 * Highlighted code with a line gutter, drawn synchronously — the one code renderer of the board.
 *
 * The kit's `CodeBlock` defers its highlight (`useDeferredValue`) so a streaming chat block never
 * blocks typing. On a board that is the wrong trade: the nodes re-render on every poll and every
 * camera move, the deferred render kept being interrupted, and a file card showed a single empty
 * line under a file that had loaded. A card is highlighted once per text, here, the way the code
 * map's call lens draws its cards.
 */
export const CodeLines = memo(function CodeLines({
  code,
  language,
  startLine = 1,
  className,
}: {
  code: string
  language?: string
  startLine?: number
  className?: string
}) {
  const text = code.replace(/\n$/u, '')
  // highlightCode escapes the source before it adds its token spans. A language it has no grammar
  // for (HTML, JSON, YAML…) shows escaped plain text at once, then the host's full colouring.
  const plain = useMemo(() => highlightCode(text, language), [text, language])
  const [colored, setColored] = useState<{ key: string; html: string } | null>(null)
  const key = `${language ?? ''}\u0000${text}`
  useEffect(() => {
    if (!language || hasHighlightGrammar(language)) return
    let live = true
    void colorizeCode(text, language).then(
      (html) => live && setColored({ key, html }),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [key, language, text])
  const html = colored?.key === key ? colored.html : plain
  const count = text ? text.split('\n').length : 0
  const width = String(startLine + Math.max(0, count - 1)).length + 1
  return (
    <div
      className={cn('flex font-mono text-2xs leading-[1.6]', className)}
      style={{ fontVariantLigatures: 'none' }}
    >
      <div
        aria-hidden
        className="shrink-0 select-none pl-2 pr-3 text-right text-text-faint/60"
        style={{ width: `${width + 2}ch` }}
      >
        {Array.from({ length: count }, (_, row) => (
          <div key={row}>{startLine + row}</div>
        ))}
      </div>
      <pre
        className={cn(
          'm-0 min-w-0 flex-1 whitespace-pre bg-transparent p-0 font-mono',
          CODE_VIEWER_HIGHLIGHT,
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
})
