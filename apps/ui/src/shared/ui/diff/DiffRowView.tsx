import { memo, type ReactNode } from 'react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { inspector } from '@/shared/lib/inspectorBus'
import { DiffCode } from './DiffCode'
import { HunkHeaderLabel } from './HunkHeaderLabel'
import { DiffFileHeader, DiffNoteRow } from './DiffFileHeader'
import {
  DIFF_HUNK_HEADER_CLASS,
  DIFF_LINE_NO_CLASS,
  DIFF_SPLIT_DIVIDER_CLASS,
  DIFF_SPLIT_EMPTY_CLASS,
  diffRowWash,
  diffSignClass,
  diffSignGlyph,
} from './diffLineStyles'
import type { DiffDocument, DocFile } from './document/diffDocument'
import type { DiffRow } from './document/diffRows'
import type { LineCache } from './document/lineCache'

/**
 * Everything a row needs besides its own position, built once per layout by
 * `VirtualDiff` — so a memoised row re-renders only when ITS inputs change, not on
 * every scroll frame of the parent.
 */
export interface DiffRowContext {
  doc: DiffDocument
  cache: LineCache
  /** Line-number gutter width in `ch`, from the document's largest line number. */
  gutterCh: number
  /** Visible width of the scroll viewport, for labels pinned while code scrolls sideways. */
  viewportWidth: number
  /** On-disk path of a file, for new-side line links; undefined → plain numbers. */
  linkPath: (file: number) => string | undefined
  fileActions?: (file: DocFile) => ReactNode
  collapsed: ReadonlySet<number>
  onToggleFile: (file: number) => void
  runActions?: (run: number) => ReactNode
}

/** The change run a row belongs to (-1 for context/meta/headers). */
export function rowRun(doc: DiffDocument, row: DiffRow): number {
  if (row.kind === 'line') return doc.lines[row.line]!.run
  if (row.kind === 'pair') return doc.lines[row.left >= 0 ? row.left : row.right]!.run
  return -1
}

function LineNo({ no, width, link }: { no?: number; width: string; link?: string }) {
  // The file opens in the chat this diff belongs to (its tab's or transcript's session). A diff
  // shown outside any chat has no workspace to open it in, so its numbers stay plain.
  const sessionId = useWorkItemSessionId()
  if (link && no && sessionId) {
    // One native button per row — a Tooltip tree per line number is what a large diff cannot afford.
    return (
      <button
        type="button"
        onClick={() => inspector.openFile({ sessionId, path: link, line: no })}
        aria-label={`Open file at line ${no}`}
        style={{ width }}
        className={`${DIFF_LINE_NO_CLASS} cursor-pointer outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring`}
      >
        {no}
      </button>
    )
  }
  return (
    <span style={{ width }} className={DIFF_LINE_NO_CLASS}>
      {no ?? ''}
    </span>
  )
}

function Sign({ ctx, id }: { ctx: DiffRowContext; id: number }) {
  const type = ctx.doc.lines[id]!.type
  return (
    <span className={`w-[2ch] shrink-0 select-none text-center ${diffSignClass(type)}`}>
      {diffSignGlyph(type)}
    </span>
  )
}

function CodeText({ ctx, id }: { ctx: DiffRowContext; id: number }) {
  const line = ctx.doc.lines[id]!
  const kind = line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : 'ctx'
  const hidden = ctx.cache.hiddenChars(id)
  return (
    <>
      <DiffCode html={ctx.cache.html(id)} segments={ctx.cache.segments(id)} kind={kind} />
      {hidden > 0 && (
        <span className="shrink-0 select-none pr-3 text-2xs text-text-faint">
          … {hidden.toLocaleString()} more characters
        </span>
      )}
    </>
  )
}

/**
 * One side of a split row. The side is exactly half the viewport; its line number and
 * sign stay put and only the code shifts, by the shared `--diff-x` (`useSplitScroll`).
 */
function SplitCell({ ctx, id, side }: { ctx: DiffRowContext; id: number; side: 'left' | 'right' }) {
  const divider = side === 'left' ? DIFF_SPLIT_DIVIDER_CLASS : ''
  if (id < 0) return <div className={`w-1/2 ${DIFF_SPLIT_EMPTY_CLASS} ${divider}`} />
  const line = ctx.doc.lines[id]!
  const file = ctx.doc.hunks[line.hunk]!.file
  return (
    <div className={`flex w-1/2 min-w-0 ${diffRowWash(line.type)} ${divider}`}>
      <LineNo
        no={side === 'left' ? line.oldNo : line.newNo}
        width={`${ctx.gutterCh}ch`}
        link={side === 'right' ? ctx.linkPath(file) : undefined}
      />
      <Sign ctx={ctx} id={id} />
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="flex [transform:translateX(calc(var(--diff-x,0px)*-1))]">
          <CodeText ctx={ctx} id={id} />
        </span>
      </span>
    </div>
  )
}

/** A zero-width slot pinned to the viewport's right edge, however wide the code is. */
function RunActions({ children }: { children: ReactNode }) {
  return (
    <span className="sticky right-0 ml-auto w-0 shrink-0 self-stretch">
      <span className="absolute right-1.5 top-1/2 z-(--z-raised) -translate-y-1/2">{children}</span>
    </span>
  )
}

export const DiffRowView = memo(function DiffRowView({
  row,
  top,
  height,
  ctx,
  actions,
}: {
  row: DiffRow
  top: number
  height: number
  ctx: DiffRowContext
  /** Present only on the row that shows its run's hover actions. */
  actions?: ReactNode
}) {
  const style = { transform: `translateY(${top}px)`, height, lineHeight: `${height}px` }
  const base = 'absolute left-0 top-0 w-full'
  const { doc } = ctx

  if (row.kind === 'file') {
    return (
      <div style={style} className={base}>
        <DiffFileHeader
          file={doc.files[row.file]!}
          open={!ctx.collapsed.has(row.file)}
          width={ctx.viewportWidth}
          onToggle={() => ctx.onToggleFile(row.file)}
          actions={ctx.fileActions?.(doc.files[row.file]!)}
        />
      </div>
    )
  }
  if (row.kind === 'note') {
    return (
      <div style={style} className={base}>
        <DiffNoteRow
          file={doc.files[row.file]!}
          note={row.note}
          width={ctx.viewportWidth}
          onExpand={() => ctx.onToggleFile(row.file)}
        />
      </div>
    )
  }
  if (row.kind === 'hunk') {
    return (
      <div style={style} className={`${base} ${DIFF_HUNK_HEADER_CLASS}`}>
        <span className="sticky left-0 px-3">
          <HunkHeaderLabel header={doc.hunks[row.hunk]!.header} />
        </span>
      </div>
    )
  }
  if (row.kind === 'meta') {
    return (
      <div style={style} className={`${base} text-2xs italic text-text-faint`}>
        <span className="sticky left-0 px-3">{doc.lines[row.line]!.text}</span>
      </div>
    )
  }
  if (row.kind === 'pair') {
    return (
      <div style={style} className={`${base} flex`} data-run={rowRun(doc, row)}>
        <SplitCell ctx={ctx} id={row.left} side="left" />
        <SplitCell ctx={ctx} id={row.right} side="right" />
        {actions && <RunActions>{actions}</RunActions>}
      </div>
    )
  }
  const line = doc.lines[row.line]!
  const gutter = `${ctx.gutterCh}ch`
  return (
    <div style={style} className={`${base} flex ${diffRowWash(line.type)}`} data-run={line.run}>
      <LineNo no={line.oldNo} width={gutter} />
      <LineNo no={line.newNo} width={gutter} link={ctx.linkPath(doc.hunks[line.hunk]!.file)} />
      <Sign ctx={ctx} id={row.line} />
      <CodeText ctx={ctx} id={row.line} />
      {actions && <RunActions>{actions}</RunActions>}
    </div>
  )
})
