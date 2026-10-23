import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { TextAction } from '@localixai/kit/text-action'
import type { CodeCard } from '../../shared/lens'
import { KIND_LABEL } from '../kinds'
import { CARD } from './geometry'

/**
 * The clickable names over a card's code, laid in the same monospace cells as the text so each
 * sits exactly on its token. A call is underlined solid, any other name (a type, a constant, an
 * imported value) dotted — the two ways code points at a declaration, told apart at a glance. The
 * link that opened the next card stays filled, so the trail reads "this token led there".
 */
export function CodeLinks({
  card,
  next,
  onOpen,
}: {
  card: CodeCard
  next: string | null
  onOpen: (id: string) => void
}) {
  return (
    <>
      {card.links.map((link) => {
        const active = link.target.id === next
        const where = `${link.target.path}${link.target.line ? `:${link.target.line}` : ''}`
        return (
          <TextAction
            key={`${link.line}:${link.column}`}
            className={cn(
              'nodrag nopan absolute select-none rounded-xs border-b text-transparent',
              link.kind === 'call' ? 'border-solid' : 'border-dotted',
              active
                ? 'border-status-info bg-status-info/20'
                : 'border-status-info/60 hover:bg-status-info/15',
            )}
            style={{
              top: (link.line - card.startLine) * CARD.line,
              left: `${link.column}ch`,
              width: `${Math.max(1, link.endColumn - link.column)}ch`,
              height: CARD.line,
            }}
            tooltip={`${KIND_LABEL[link.target.kind]} ${link.target.name} — ${where}`}
            aria-label={`Open ${link.target.name}`}
            onClick={() => onOpen(link.target.id)}
          >
            {link.target.name}
          </TextAction>
        )
      })}
    </>
  )
}
