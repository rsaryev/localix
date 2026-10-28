import type { CSSProperties } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { parseAnsiRows, plainAnsiText, type AnsiSpan } from '@/shared/lib/ansiRows'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { useModSession } from '../model/useModSession'
import { fillOf, INVERSE, textColorOf, toneOf } from './modColor'

/**
 * The conversation's status lines, a quiet area under its message box as Claude Code draws its
 * status bar under the prompt: the person's `statusLine` command first, then each mod's
 * `$.ui.status`, every row of every source a row of its own. A terminal command prints colors and
 * links; they are drawn in the app's own palette (`modColor.ts`) as spans of text, never as
 * markup, and a row too long for the box is cut with an ellipsis (the whole row is its title).
 *
 * It is also where the conversation's mods meet its prompt box: reading their state
 * (`useModSession`) applies the drafts a mod filled and the suggestion it offered, so it stays
 * mounted while a question hides the rows, as Claude Code hides its line during a permission
 * prompt.
 */

const ROW_BASE = 'overflow-hidden text-ellipsis whitespace-pre'

/** The person's own line first, then the mods in the order they set theirs. */
const rank = (source: string) => (source === 'statusLine' ? 0 : 1)

function spanLook(span: AnsiSpan): { style: CSSProperties; className: string } {
  const color = textColorOf(span.fg, 'band', Boolean(span.dim))
  const style: CSSProperties = {
    ...(span.inverse ? INVERSE : {}),
    ...(color ? { color } : span.dim ? { color: 'var(--text-faint)' } : {}),
    ...(span.bg ? { backgroundColor: fillOf(span.bg, 'text') } : {}),
  }
  const decoration = [span.underline && 'underline', span.strike && 'line-through']
    .filter(Boolean)
    .join(' ')
  if (decoration) style.textDecorationLine = decoration
  return { style, className: cn(span.bold && 'font-semibold', span.italic && 'italic') }
}

function Span({ span }: { span: AnsiSpan }) {
  const { style, className } = spanLook(span)
  const body = (
    <span className={className} style={style} data-tone={toneOf(span.fg)}>
      {span.text}
    </span>
  )
  return span.href ? (
    <ExternalAnchor
      className="underline underline-offset-2 hover:text-text-strong"
      href={span.href}
    >
      {body}
    </ExternalAnchor>
  ) : (
    body
  )
}

export function ModsStatusFooter({
  sessionId,
  context,
}: {
  sessionId: string | null
  context?: { hasInteraction?: boolean }
}) {
  const statuses = useModSession(sessionId)
  const sources = Object.entries(statuses).sort(([a], [b]) => rank(a) - rank(b))
  if (sources.length === 0 || context?.hasInteraction) return null
  return (
    <div
      role="group"
      aria-label="Status"
      className="mt-1.5 flex flex-col gap-0.5 px-3 font-mono text-2xs text-text-soft"
    >
      {sources.flatMap(([source, text]) =>
        parseAnsiRows(text).map((row, index) => (
          <div
            key={`${source}:${index}`}
            className={ROW_BASE}
            data-status-source={source}
            title={plainAnsiText(row)}
          >
            {row.length > 0 ? row.map((span, at) => <Span key={at} span={span} />) : ' '}
          </div>
        )),
      )}
    </div>
  )
}
