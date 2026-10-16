import type { IntralineSegment } from './intralineDiff'
import { DIFF_WORD_MARK } from './diffLineStyles'

const CODE_CLASS = 'flex-1 whitespace-pre pr-3 [tab-size:4]'

/**
 * Make raw line text safe for the `html` prop. `DiffCode` renders that prop as
 * HTML, so a surface that SKIPS syntax highlighting (past
 * `DIFF_HIGHLIGHT_MAX_LINES`) must escape the text itself — this is the one
 * escape both diff surfaces use, kept next to the component that consumes it.
 */
export const escapeDiffHtml = (s: string): string =>
  s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))

/**
 * A single diff line's code cell — the shared code-rendering leaf for BOTH the
 * read-only `DiffView` and the interactive `DiffStagingView`, so a line reads
 * identically whichever surface shows it.
 *
 * When word-level `segments` are supplied (a modify-in-place del/add pair) the
 * altered runs are tinted with the change-word mark and syntax highlighting is
 * skipped — the two can't both wrap the same text, and the word mark carries the
 * more useful signal. Otherwise the pre-highlighted sugar-high `html` is rendered
 * (already escaped by sugar-high; empty string → plain, safe fallback).
 */
export function DiffCode({
  html,
  segments,
  kind,
}: {
  /** Pre-computed sugar-high HTML for this line's content. */
  html: string
  /** Word-level segments when this line is part of a modify-in-place pair. */
  segments?: IntralineSegment[] | null
  kind: 'add' | 'del' | 'ctx'
}) {
  if (segments && (kind === 'add' || kind === 'del')) {
    return (
      <code className={CODE_CLASS}>
        {segments.map((seg, i) =>
          seg.changed ? (
            <span key={i} className={DIFF_WORD_MARK[kind]}>
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </code>
    )
  }
  return <code className={CODE_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
}
