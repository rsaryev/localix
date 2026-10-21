import { ChevronRight, X } from 'lucide-react'
import type { FileContentMatch } from '@/shared/api/contracts'
import { Chip } from '@localixai/kit/chip'
import { fileIcon, folderIcon } from '@/shared/ui/file-icon/fileIcon'
import { IconButton } from '@localixai/kit/icon-button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@localixai/kit/input-group'
import { SectionLabel } from '@localixai/kit/section-label'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import type { SearchDirRow, SearchFileRow, SearchMatchRow, SearchRow } from './searchTreeRows'

/** A small square icon-toggle (match case / whole word / regex / details).
 *  `title` renders as the styled Tooltip (and doubles as the aria-label). */
export function Toggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <IconButton
      size="xs"
      onClick={onClick}
      aria-label={title}
      aria-pressed={active}
      tooltip={title}
      className={active ? 'bg-surface-active font-mono text-foreground' : 'font-mono'}
    >
      {children}
    </IconButton>
  )
}

/** A compact 0/1/2/3 selector for how many surrounding source lines to show
 *  around each match ("context lines"). 0 = single-line results. */
export function ContextLinesField({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div
      role="group"
      aria-label="Context lines"
      className="flex items-center justify-between gap-2"
    >
      <SectionLabel as="span" className="pointer-events-none">
        context lines
      </SectionLabel>
      <div className="flex items-center gap-0.5">
        {[0, 1, 2, 3].map((n) => (
          <IconButton
            key={n}
            size="xs"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            aria-label={
              n === 0 ? 'No surrounding lines' : `${n} line${n === 1 ? '' : 's'} of context`
            }
            tooltip={n === 0 ? 'No surrounding lines' : `${n} line${n === 1 ? '' : 's'} of context`}
            className={value === n ? 'bg-surface-active font-mono text-foreground' : 'font-mono'}
          >
            {n}
          </IconButton>
        ))}
      </div>
    </div>
  )
}

/** A subtle, labelled glob input for the include/exclude filters. */
export function GlobField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <label className="block">
      <SectionLabel as="span" className="mb-1 block">
        {label}
      </SectionLabel>
      {/* InputGroup's own `--input` veil, not the pane's dark ground (which read as a black bar). */}
      <InputGroup>
        <InputGroupInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          aria-label={label}
          className="text-2xs"
        />
        {value && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="xs"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange('')}
              aria-label={`Clear ${label}`}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </label>
  )
}

/** A dim, non-highlighted surrounding-context line (rendered above/below a match
 *  when context lines are requested). Clicking opens the file at that exact line. */
function ContextLine({ text, line, onClick }: { text: string; line: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Line ${line}`}
      className="flex w-full items-center py-[0.05rem] pr-2 text-left outline-none transition-colors focus-ring hover:bg-surface-hover"
      style={{ paddingLeft: 38 }}
    >
      <span className="truncate font-mono text-2xs text-text-faint">{text || ' '}</span>
    </button>
  )
}

/** A single matched line with the match span highlighted, optionally flanked by
 * its surrounding source lines (dim, clickable) when context lines are requested.
 * When `replacement` is non-null the match span renders as a preview diff:
 * the original struck-through (red tint) + the replacement (green tint),
 * as an inline replace preview. */
function MatchLine({
  m,
  onClick,
  replacement,
  openAt,
}: {
  m: FileContentMatch
  onClick: () => void
  replacement: string | null
  openAt: (line: number) => void
}) {
  const matched = m.lineText.slice(m.matchStart, m.matchEnd)
  const showDiff = replacement !== null && replacement !== matched
  const before = m.before ?? []
  const after = m.after ?? []
  const beforeLines = before.map((text, index) => ({
    text,
    line: m.line - before.length + index,
  }))
  const afterLines = after.map((text, index) => ({ text, line: m.line + 1 + index }))
  return (
    <>
      {beforeLines.map(({ text, line }) => (
        <ContextLine
          key={`before:${m.path}:${line}`}
          text={text}
          line={line}
          onClick={() => openAt(line)}
        />
      ))}
      <button
        type="button"
        onClick={onClick}
        title={`${m.path}:${m.line}`}
        className="flex w-full items-center gap-2 py-[0.1rem] pr-2 text-left outline-none transition-colors focus-ring hover:bg-surface-hover"
        style={{ paddingLeft: 38 }}
      >
        <span className="truncate font-mono text-2xs text-text-soft">
          {m.lineText.slice(0, m.matchStart)}
          {showDiff ? (
            <>
              <span className="rounded-l-xs bg-status-error/18 px-px text-status-error line-through decoration-1 dark:bg-status-error/12">
                {matched}
              </span>
              <span className="rounded-r-xs bg-status-success/18 px-px font-medium text-status-success dark:bg-status-success/12">
                {replacement}
              </span>
            </>
          ) : (
            <mark className="rounded-xs bg-foreground/15 px-px font-medium text-foreground">
              {matched}
            </mark>
          )}
          {m.lineText.slice(m.matchEnd)}
        </span>
      </button>
      {afterLines.map(({ text, line }) => (
        <ContextLine
          key={`after:${m.path}:${line}`}
          text={text}
          line={line}
          onClick={() => openAt(line)}
        />
      ))}
    </>
  )
}

/** Folder header row — expand/collapse plus the recursive match count. */
function DirRow({ row, toggle }: { row: SearchDirRow; toggle: (key: string) => void }) {
  const { Icon, color } = folderIcon(row.isOpen)
  return (
    <button
      type="button"
      onClick={() => toggle(row.node.path)}
      title={row.node.path}
      data-search-node={row.node.path}
      style={{ paddingLeft: row.depth * 12 + 8 }}
      className="flex w-full items-center gap-1.5 py-[0.2rem] pr-2 text-left text-xs outline-none transition-colors focus-ring hover:bg-surface-hover"
    >
      <ChevronRight
        className={`size-3.5 shrink-0 text-text-faint transition-transform ${row.isOpen ? 'rotate-90' : ''}`}
      />
      <Icon className={`size-4 shrink-0 ${color}`} />
      <span className="truncate text-foreground">{row.node.name}</span>
      <Chip tone="neutral" size="dense" className="ml-auto shrink-0 text-text-soft">
        {row.node.count}
      </Chip>
    </button>
  )
}

/** File header row — expand/collapse plus this file's match count. */
function FileRow({ row, toggle }: { row: SearchFileRow; toggle: (key: string) => void }) {
  const { Icon, color } = fileIcon(row.node.name)
  const path = row.node.path
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return (
    <button
      type="button"
      onClick={() => toggle(path)}
      title={path}
      data-search-node={path}
      style={{ paddingLeft: row.depth * 12 + 8 }}
      className="flex w-full items-center gap-1.5 py-[0.2rem] pr-2 text-left text-xs outline-none transition-colors focus-ring hover:bg-surface-hover"
    >
      <ChevronRight
        className={`size-3.5 shrink-0 text-text-faint transition-transform ${row.isOpen ? 'rotate-90' : ''}`}
      />
      <Icon className={`size-4 shrink-0 ${color}`} />
      <span className="truncate text-foreground">{row.node.name}</span>
      {dir && <span className="truncate text-2xs text-text-faint">{dir}</span>}
      <Chip tone="neutral" size="dense" className="ml-auto shrink-0 text-text-soft">
        {row.node.matches.length}
      </Chip>
    </button>
  )
}

/** One match row: the matched line plus every context line rendered with it. */
function MatchRow({
  row,
  sessionId,
  root,
  previewFor,
}: {
  row: SearchMatchRow
  sessionId: string | null
  root: string | null
  previewFor: (m: FileContentMatch) => string | null
}) {
  const m = row.match
  const absolute = root ? `${root}/${m.path}` : m.path
  const openAt = (line: number) => {
    if (sessionId) openFileInGrid({ sessionId, path: absolute, line })
  }
  return (
    <MatchLine m={m} replacement={previewFor(m)} onClick={() => openAt(m.line)} openAt={openAt} />
  )
}

/** Render one flattened search row. Layout lives in `searchTreeRows.ts`. */
export function SearchRowView({
  row,
  toggle,
  sessionId,
  root,
  previewFor,
}: {
  row: SearchRow
  toggle: (key: string) => void
  /** The chat the results were searched in — a picked match opens in it, never the one on screen. */
  sessionId: string | null
  root: string | null
  previewFor: (m: FileContentMatch) => string | null
}) {
  if (row.kind === 'dir') return <DirRow row={row} toggle={toggle} />
  if (row.kind === 'file') return <FileRow row={row} toggle={toggle} />
  return <MatchRow row={row} sessionId={sessionId} root={root} previewFor={previewFor} />
}
