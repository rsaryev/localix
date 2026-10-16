import { fuzzyMatchPositions } from '../lib/fuzzy-match'

interface MatchedTextProps {
  /** The full string to display. */
  text: string
  /** The fuzzy query whose matched characters should be emphasised. */
  query: string
  /**
   * The ranker's own matched indices in `text`, when the surface ranks with a matcher that
   * reports them (the slash menu's tiers). Given, they are drawn as-is instead of re-matching
   * `query`, so the highlight is the reason the row ranked. `null`/empty draws plain text.
   */
  positions?: ReadonlySet<number> | null
  /** Class for the wrapper when nothing is highlighted (full-strength text). */
  plainClassName?: string
  /** Class for the wrapper when some characters match (dimmed base). */
  dimClassName?: string
  /** Class applied to each matched character. */
  matchClassName?: string
}

/**
 * Renders `text` with the characters that fuzzy-match `query` emphasised and the
 * rest dimmed — the "go to file/symbol" treatment that shows WHY a result
 * matched. Falls back to plain full-strength text when `query` isn't a
 * subsequence of `text`, so it never mis-highlights. Presentation-only; the
 * actual filtering/ranking happens elsewhere.
 */
export function MatchedText({
  text,
  query,
  positions,
  plainClassName = 'truncate text-foreground',
  dimClassName = 'truncate text-text-soft',
  matchClassName = 'font-semibold text-foreground',
}: MatchedTextProps) {
  const pos = positions === undefined ? fuzzyMatchPositions(query, text) : positions
  if (!pos?.size) return <span className={plainClassName}>{text}</span>
  return (
    <span className={dimClassName}>
      {Array.from(text, (ch, i) =>
        pos.has(i) ? (
          <span key={i} className={matchClassName}>
            {ch}
          </span>
        ) : (
          ch
        ),
      )}
    </span>
  )
}
