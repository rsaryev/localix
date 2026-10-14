import type { HistorySearchHit, UiSession } from '@/shared/api/contracts'
import { sessionTitle } from './sessionTitle'
import { parseSnippet } from '../model/historySnippet'

function Snippet({ text }: { text: string }) {
  return (
    <>
      {parseSnippet(text).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="lx-search-mark rounded-sm px-0.5 text-sidebar-foreground">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}

interface HistorySearchResultsProps {
  hits: HistorySearchHit[]
  sessionsById: Map<string, UiSession>
  onSelect: (session: UiSession) => void
}

/**
 * The sidebar's "Found in messages" section: cross-conversation FTS5 hits that
 * the title filter alone can't surface. One row per session (best-ranked hit
 * wins), with a `[..]`-highlighted snippet; clicking opens that chat (where ⌘F
 * narrows further). Renders nothing when no hit resolves to a loaded session.
 */
export function HistorySearchResults({ hits, sessionsById, onSelect }: HistorySearchResultsProps) {
  const seen = new Set<string>()
  const rows = hits.flatMap((h) => {
    if (seen.has(h.sessionId)) return []
    const session = sessionsById.get(h.sessionId)
    if (!session) return []
    seen.add(h.sessionId)
    return [{ session, snippet: h.snippet }]
  })
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-1 pt-2">
      <p className="px-3.5 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/45 select-none">
        Found in messages
      </p>
      {rows.map(({ session, snippet }) => {
        const title = sessionTitle(session)
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session)}
            className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent/30 focus-ring"
            title={title}
          >
            <span className="truncate text-sm font-medium text-sidebar-foreground/85">{title}</span>
            <span className="line-clamp-2 text-2xs leading-snug text-sidebar-foreground/55">
              <Snippet text={snippet} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
