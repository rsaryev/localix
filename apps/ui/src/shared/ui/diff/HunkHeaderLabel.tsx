import { splitHunkHeader } from './diffLineStyles'

/**
 * Renders a unified-diff hunk header (`@@ … @@ context`) with the line-range
 * coordinates muted and the trailing context slightly stronger. Shared by BOTH
 * `DiffView`'s sticky header and `DiffStagingView`'s interactive hunk bar so the
 * two surfaces read identically. Callers own the surrounding row element (its
 * positioning / interaction); this only renders the label spans.
 */
export function HunkHeaderLabel({ header }: { header: string }) {
  const { range, context } = splitHunkHeader(header)
  return (
    <>
      <span className="text-text-faint">{range}</span>
      {context && <span className="ml-2 text-text-soft">{context}</span>}
    </>
  )
}
