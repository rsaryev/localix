import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SUGAR_HIGH_THEME } from '../code-block/sugarHighTheme'
import { highlightCode } from '../code-block/highlightCode'
import { languageFromPath } from './parseUnifiedDiff'
import { useDiffViewMode } from './diffViewMode'
import { DiffToolbar } from './DiffToolbar'
import { DiffStickyOverlay } from './DiffStickyOverlay'
import { DiffRowView, rowRun, type DiffRowContext } from './DiffRowView'
import { DIFF_CODE_TEXT } from './diffLineStyles'
import { useDiffViewport, useRootScale } from './useDiffViewport'
import type { DiffDocument, DocFile } from './document/diffDocument'
import { DIFF_ROW_HEIGHT, layoutDiffRows } from './document/diffRows'
import { useDiffDisclosure } from './useDiffDisclosure'
import { useSplitScroll } from './useSplitScroll'
import { diffStickyState } from './document/diffSticky'
import { createLineCache } from './document/lineCache'

export interface VirtualDiffProps {
  doc: DiffDocument
  /** Show one disclosure header per file (commit / range / working-tree diffs). */
  multiFile?: boolean
  /** On-disk path of a file, for new-side line links; omitted → plain numbers. */
  linkPath?: (file: DocFile) => string | undefined
  /** Path whose extension picks the highlighter, when the file path is synthetic. */
  languagePath?: string
  /** Left side of the toolbar: what this diff is. */
  lead?: ReactNode
  /** Right side of the toolbar, before the layout toggle. */
  actions?: ReactNode
  /** In-flow notice between toolbar and code (e.g. a truncated diff). */
  notice?: ReactNode
  fileActions?: (file: DocFile) => ReactNode
  /** Hover actions for one change run (block staging). */
  runActions?: (run: number) => ReactNode
  /** Runs before the built-in j/k navigation; `preventDefault()` claims the key. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  /** Keep the newest line in view while the document grows (a streaming patch). */
  followTail?: boolean
  /** Start files past `LARGE_FILE_LINES` collapsed. Off for a stream, where a file crossing
   *  the threshold mid-write would snap shut under the reader. */
  collapseLarge?: boolean
  ariaLabel?: string
  className?: string
}

const TAIL_SLACK_PX = 80

const SSR_RECT = { width: 960, height: 720 }

/**
 * The one diff surface for the inspector: single-file, multi-file and interactive
 * staging all mount this. It exists because every earlier surface mounted one DOM row
 * per diff line — a lockfile or a 300-file commit froze the tab on open, and the
 * staging view had no cap at all. Here only the rows in view (plus overscan) exist,
 * every row has an exact precomputed height, and highlight/word-diff work runs per
 * mounted line (`lineCache`).
 */
export function VirtualDiff({
  doc,
  multiFile = false,
  linkPath,
  languagePath,
  lead,
  actions,
  notice,
  fileActions,
  runActions,
  onKeyDown,
  followTail = false,
  collapseLarge = true,
  ariaLabel = 'File diff',
  className,
}: VirtualDiffProps) {
  const [mode] = useDiffViewMode()
  const split = mode === 'split'
  const scale = useRootScale()
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const { scrollTop, width } = useDiffViewport(scrollEl)

  const { collapsed, toggleFile, revealFile } = useDiffDisclosure(doc, multiFile, collapseLarge)

  const layout = useMemo(
    () => layoutDiffRows(doc, { split, fileHeaders: multiFile, collapsed, scale }),
    [doc, split, multiFile, collapsed, scale],
  )
  // Tail follow compares against the PREVIOUS total: after the grow, "near the bottom"
  // measured on the new height is false by exactly the amount that just streamed in.
  const lastTotal = useRef(0)
  useLayoutEffect(() => {
    const total = layout.offsets[layout.rows.length]!
    const previous = lastTotal.current
    lastTotal.current = total
    const file = revealFile.current
    revealFile.current = null
    if (!scrollEl) return
    if (file !== null) {
      const headerTop = layout.offsets[layout.fileRows[file]!] ?? 0
      if (scrollEl.scrollTop > headerTop) scrollEl.scrollTop = headerTop
    } else if (followTail && total > previous) {
      const nearBottom = previous - scrollEl.scrollTop - scrollEl.clientHeight < TAIL_SLACK_PX
      if (nearBottom) scrollEl.scrollTop = total
    }
  }, [layout, scrollEl, followTail])
  const cache = useMemo(
    () =>
      createLineCache(
        doc,
        (file) => languageFromPath(languagePath ?? doc.files[file]?.path),
        highlightCode,
      ),
    [doc, languagePath],
  )
  const gutterCh = Math.max(3, String(doc.maxLineNo).length) + 1

  const ctx = useMemo<DiffRowContext>(
    () => ({
      doc,
      cache,
      gutterCh,
      viewportWidth: width,
      linkPath: (file) => linkPath?.(doc.files[file]!),
      fileActions,
      collapsed,
      onToggleFile: toggleFile,
      runActions,
    }),
    // Callers pass stable callbacks; a fresh one re-renders every mounted row, nothing worse.
    [doc, cache, gutterCh, width, linkPath, fileActions, collapsed, toggleFile, runActions],
  )

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: layout.rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: (index) => layout.offsets[index + 1]! - layout.offsets[index]!,
    overscan: 16,
    initialRect: SSR_RECT,
  })

  // The virtualizer caches sizes by index; a relayout (split toggle, collapse) that keeps the
  // row count would otherwise compute its window from the previous layout's heights.
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [layout, virtualizer])

  const heights = {
    file: Math.round(DIFF_ROW_HEIGHT.file * scale),
    hunk: Math.round(DIFF_ROW_HEIGHT.hunk * scale),
  }
  const sticky = diffStickyState(layout, scrollTop, heights, multiFile)
  const pinnedHeight = (sticky.file ? heights.file : 0) + (sticky.hunk ? heights.hunk : 0)

  const goToHunk = useCallback(
    (index: number) => {
      const count = layout.hunkRows.length
      if (!scrollEl || count === 0) return
      const target = layout.hunkRows[((index % count) + count) % count]!
      // Land the header just under the pinned file bar, where the overlay would put it.
      scrollEl.scrollTop = layout.offsets[target]! - (multiFile ? heights.file : 0)
    },
    [layout, scrollEl, multiFile, heights.file],
  )

  const [hoverRun, setHoverRun] = useState(-1)
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const host = (event.target as HTMLElement).closest<HTMLElement>('[data-run]')
    const run = host ? Number(host.dataset.run) : -1
    if (run !== hoverRun) setHoverRun(run)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.target !== event.currentTarget) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
    if (event.key === 'j' || (event.key === 'F7' && !event.shiftKey)) {
      event.preventDefault()
      goToHunk(sticky.current + 1)
    } else if (event.key === 'k' || (event.key === 'F7' && event.shiftKey)) {
      event.preventDefault()
      goToHunk(sticky.current - 1)
    }
  }

  // Unified scrolls natively across the widest line. Split is viewport-wide and moves
  // only its code, by one shared offset — see `useSplitScroll` for the defect.
  const canvasWidth = split
    ? '100%'
    : `max(100%, calc(${gutterCh * 2 + 2 + doc.maxCols}ch + 1.5rem))`
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null)
  const splitScroll = useSplitScroll({
    enabled: split,
    scrollEl,
    canvasEl,
    contentCh: doc.maxCols,
    gutterCh: gutterCh + 2,
    viewportWidth: width,
  })

  let actionsPlaced = false
  const rendered = virtualizer.getVirtualItems().map((item) => {
    const row = layout.rows[item.index]!
    const top = layout.offsets[item.index]!
    const height = layout.offsets[item.index + 1]! - top
    let rowActions: ReactNode
    // One action bar per hovered run, on its first row that is actually in view.
    if (
      runActions &&
      hoverRun >= 0 &&
      !actionsPlaced &&
      top + height > scrollTop + pinnedHeight &&
      rowRun(doc, row) === hoverRun
    ) {
      rowActions = runActions(hoverRun)
      actionsPlaced = true
    }
    return (
      <DiffRowView
        key={item.index}
        row={row}
        top={top}
        height={height}
        ctx={ctx}
        actions={rowActions}
      />
    )
  })

  return (
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${className ?? ''}`}>
      <DiffToolbar
        lead={lead}
        current={sticky.current}
        total={layout.hunkRows.length}
        onNavigate={goToHunk}
        actions={actions}
      />
      {notice}
      {layout.rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-text-faint">No changes to display.</p>
      ) : (
        <div
          ref={setScrollEl}
          role="region"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className={`relative min-h-0 flex-1 outline-none scrollbar-thin focus-ring ${split ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto'} ${DIFF_CODE_TEXT} ${SUGAR_HIGH_THEME}`}
        >
          <DiffStickyOverlay doc={doc} sticky={sticky} heights={heights} width={width} ctx={ctx} />
          <div
            ref={setCanvasEl}
            data-slot="diff-canvas"
            data-layout={split ? 'split' : 'unified'}
            className="relative"
            style={{ height: layout.offsets[layout.rows.length], width: canvasWidth }}
            onMouseMove={runActions ? onMouseMove : undefined}
            onMouseLeave={runActions ? () => setHoverRun(-1) : undefined}
          >
            {rendered}
          </div>
        </div>
      )}
      {splitScroll.overflow > 0 && (
        <div
          ref={splitScroll.barRef}
          onScroll={splitScroll.onBarScroll}
          aria-hidden="true"
          className="shrink-0 overflow-x-auto overflow-y-hidden scrollbar-thin"
        >
          {/* Sized so the bar's scroll range equals the code overflow exactly. */}
          <div className="h-px" style={{ width: `calc(100% + ${splitScroll.overflow}px)` }} />
        </div>
      )}
    </div>
  )
}
