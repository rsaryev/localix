import { DiffFileHeader } from './DiffFileHeader'
import { HunkHeaderLabel } from './HunkHeaderLabel'
import { DIFF_HUNK_HEADER_CLASS } from './diffLineStyles'
import type { DiffRowContext } from './DiffRowView'
import type { DiffDocument } from './document/diffDocument'
import type { DiffStickyState } from './document/diffSticky'

/**
 * The pinned file + hunk headers of a virtualized diff (geometry: `diffStickyState`).
 *
 * A zero-height `sticky top-0 left-0` layer as the scroll container's first child:
 * zero height so it takes no room above the canvas, viewport-wide so the pinned
 * labels stay in view while code scrolls sideways, and inside the scroller so it
 * never covers the scrollbar. The file header is the SAME component as the in-flow
 * row, so the disclosure toggle works from the pin too.
 */
export function DiffStickyOverlay({
  doc,
  sticky,
  heights,
  width,
  ctx,
}: {
  doc: DiffDocument
  sticky: DiffStickyState
  heights: { file: number; hunk: number }
  width: number
  ctx: DiffRowContext
}) {
  if (!sticky.file && !sticky.hunk) return null
  const fileSlot = sticky.file ? heights.file : 0
  return (
    <div className="sticky left-0 top-0 z-(--z-sticky) h-0" style={width ? { width } : undefined}>
      {sticky.hunk && (
        <div
          className={`absolute inset-x-0 ${DIFF_HUNK_HEADER_CLASS}`}
          style={{
            top: fileSlot,
            height: heights.hunk,
            transform: `translateY(${sticky.hunk.shift}px)`,
          }}
        >
          <span className="px-3">
            <HunkHeaderLabel header={doc.hunks[sticky.hunk.id]!.header} />
          </span>
        </div>
      )}
      {sticky.file && (
        <div
          className="absolute inset-x-0 top-0"
          style={{ height: heights.file, transform: `translateY(${sticky.file.shift}px)` }}
        >
          <DiffFileHeader
            file={doc.files[sticky.file.id]!}
            open={!ctx.collapsed.has(sticky.file.id)}
            width={width}
            onToggle={() => ctx.onToggleFile(sticky.file!.id)}
            actions={ctx.fileActions?.(doc.files[sticky.file.id]!)}
          />
        </div>
      )}
    </div>
  )
}
