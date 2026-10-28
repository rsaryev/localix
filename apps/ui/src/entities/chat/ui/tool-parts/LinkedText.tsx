import { Fragment, useMemo, type ReactNode } from 'react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { TextAction } from '@localixai/kit/text-action'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { inspector } from '@/shared/lib/inspectorBus'
import { detectCodeLanguage } from '@/shared/ui/code-block/detectCodeLanguage'
import { highlightCodeTokens } from '@/shared/ui/code-block/highlightCode'
import { splitLinkedPaths, type TextSegment } from './linkText'

/** Render plain text with file-path tokens turned into inspector-opening links. */
export function LinkedText({
  text,
  syntax = false,
  linkify = true,
}: {
  text: string
  syntax?: boolean
  linkify?: boolean
}) {
  // The transcript's chat: a path in a tool's output opens in the chat that ran the tool.
  const sessionId = useWorkItemSessionId()
  const tokens = useMemo(() => {
    const language = syntax ? detectCodeLanguage(text) : undefined
    return language ? highlightCodeTokens(text, language) : null
  }, [text, syntax])
  const segments: TextSegment[] = linkify ? splitLinkedPaths(text) : [{ text, start: 0 }]
  let tokenIndex = 0
  const colored = (value: string, start: number) => {
    if (!tokens) return value
    const end = start + value.length
    const children: ReactNode[] = []
    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]!
      if (token.start >= end) break
      const content = text.slice(Math.max(start, token.start), Math.min(end, token.end))
      children.push(
        token.kind === 'space' || token.kind === 'break' ? (
          content
        ) : (
          <span
            key={token.start}
            className={`sh__token--${token.kind}`}
            style={{ color: `var(--sh-${token.kind})` }}
          >
            {content}
          </span>
        ),
      )
      if (token.end > end) break
      tokenIndex++
    }
    return children
  }
  return (
    <>
      {segments.map((seg) =>
        seg.path ? (
          <TextAction
            key={seg.start}
            tooltip={seg.line ? `Open ${seg.path}:${seg.line}` : `Open ${seg.path}`}
            tooltipSide="top"
            onClick={(e) => {
              e.stopPropagation()
              if (sessionId) inspector.openFile({ sessionId, path: seg.path!, line: seg.line })
            }}
            className="cursor-pointer rounded-sm text-text-soft underline decoration-dotted decoration-text-faint underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            {colored(seg.text, seg.start)}
          </TextAction>
        ) : seg.href ? (
          <ActionTooltip key={seg.start} label={seg.href} side="top">
            <ExternalAnchor
              href={seg.href}
              onClick={(e) => e.stopPropagation()}
              className="cursor-pointer rounded-sm text-text-soft underline decoration-dotted decoration-text-faint underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground"
            >
              {colored(seg.text, seg.start)}
            </ExternalAnchor>
          </ActionTooltip>
        ) : (
          <Fragment key={seg.start}>{colored(seg.text, seg.start)}</Fragment>
        ),
      )}
    </>
  )
}
