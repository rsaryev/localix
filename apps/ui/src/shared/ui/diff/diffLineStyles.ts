/**
 * Shared visual treatment for changed diff rows, used by BOTH the read-only
 * `DiffView` and the interactive `DiffStagingView` so the two surfaces read
 * identically. A restrained row wash plus a 2px status-colored left accent bar
 * (the "change gutter" cue) carries the add/del signal while keeping the code
 * itself legible in both light and dark themes — the loud row-only tint is
 * replaced by a lighter wash + a crisp edge marker.
 *
 * The washes are the kit's diff tokens (`--diff-added`, …: the status colors at a per-theme
 * strength, which a plugin theme may repaint); the accent bars and signs are the status tokens.
 * Radii use the scale
 * (`rounded-xs`), never arbitrary pixel values.
 */
export type DiffChangeKind = 'add' | 'del'

/**
 * Row background wash + 2px status-colored left accent bar for a changed line.
 * The wash is intentionally light — the accent bar does the signalling — so
 * syntax-highlighted code stays readable on near-white and near-black alike.
 */
export const DIFF_ROW_CLASS: Record<DiffChangeKind, string> = {
  add: 'border-l-2 border-status-success/60 bg-diff-added',
  del: 'border-l-2 border-status-error/60 bg-diff-removed',
}

/**
 * Transparent 2px left border so unchanged (context) rows keep the exact same
 * left inset as changed rows — the accent bar never shifts the gutter.
 */
export const DIFF_CTX_ROW_CLASS = 'border-l-2 border-transparent'

/**
 * The side of a split row with no counterpart line: a faint neutral wash, so an
 * add/delete reads as "present on one side only". One owner — both diff surfaces
 * used to carry their own copy.
 */
export const DIFF_SPLIT_EMPTY_CLASS =
  'self-stretch border-l-2 border-transparent bg-foreground/[0.03] dark:bg-foreground/[0.02]'

/**
 * The split centre divider. Not `divide-x`: Tailwind compiles the divide colour
 * inside a zero-specificity `:where()`, so every cell's own border colour won — the
 * divider vanished on context rows and turned green/red on changed ones.
 */
export const DIFF_SPLIT_DIVIDER_CLASS = 'border-r border-r-border-soft'

/** Code text recipe for every diff row: the 12px/`text-xs` mono face, tabs at 4. */
export const DIFF_CODE_TEXT = 'font-mono text-xs [tab-size:4]'

/** Line-number gutter cell; its width is set from the document's largest line number. */
export const DIFF_LINE_NO_CLASS =
  'shrink-0 select-none px-1 text-right tabular-nums text-text-faint'

/** +/- sign-column color for a changed line. */
export const DIFF_SIGN_CLASS: Record<DiffChangeKind, string> = {
  add: 'text-status-success',
  del: 'text-status-error',
}

/**
 * The unified line-kind vocabulary shared by both diff surfaces. `DiffView`
 * (string-parsed) uses `add|del|ctx|meta`; `DiffStagingView` (fetched) uses
 * `add|del|context|hunk` — callers normalize their own kind to this before asking
 * for a class. `meta`/hunk rows render their own italic header treatment, so the
 * row helpers only ever see `add|del|ctx` at runtime.
 */
export type DiffLineKind = 'add' | 'del' | 'ctx' | 'meta'

/**
 * Row background wash + accent bar for a line kind — the ONE mapping both surfaces
 * share (previously a `ROW_BG` record in `DiffView` + a `rowWash` fn in
 * `DiffStagingView`). Changed rows get the status wash; everything else keeps the
 * transparent-border inset so the accent bar never shifts the gutter.
 */
export function diffRowWash(kind: DiffLineKind): string {
  return kind === 'add'
    ? DIFF_ROW_CLASS.add
    : kind === 'del'
      ? DIFF_ROW_CLASS.del
      : DIFF_CTX_ROW_CLASS
}

/** The +/- (or blank) sign-column glyph for a line kind. */
export function diffSignGlyph(kind: DiffLineKind): string {
  return kind === 'add' ? '+' : kind === 'del' ? '-' : ' '
}

/** The sign-column color for a line kind (context/meta stay faint). */
export function diffSignClass(kind: DiffLineKind): string {
  return kind === 'add'
    ? DIFF_SIGN_CLASS.add
    : kind === 'del'
      ? DIFF_SIGN_CLASS.del
      : 'text-text-faint'
}

/**
 * Intra-line changed-word mark, layered over the row wash:
 * a small rounded, lightly padded pill around only the runs that actually
 * changed within a modified line.
 */
export const DIFF_WORD_MARK: Record<DiffChangeKind, string> = {
  add: 'rounded-xs px-px bg-diff-added-word',
  del: 'rounded-xs px-px bg-diff-removed-word',
}

/**
 * Shared hunk-header (`@@ … @@`) row treatment, used by BOTH `DiffView`'s sticky
 * header and `DiffStagingView`'s interactive hunk bar so the two surfaces read
 * identically. Callers add their own positioning (`sticky top-0 z-10`) or
 * interaction (`w-full text-left hover:bg-surface-hover`) on top of this base.
 * Tight vertical rhythm + a hairline top/bottom rule mark the hunk boundary
 * without shouting.
 */
/* `lx-occluder`, the shared recipe (index.css): rows scroll under the sticky variant of this
   bar, so it has to hide them, and the utility does that with the pane's own hue plus a blur
   instead of a near-opaque flat coat — which under glass read as an abrupt black strip between
   code lines. Also escapes the paint-once ground rule, since it is not a bare ground token. */
/* No vertical padding: the row's height is fixed by the virtualized layout (`DIFF_ROW_HEIGHT.hunk`),
   and padding inside a fixed box only pushes the label off-centre. */
export const DIFF_HUNK_HEADER_CLASS =
  'lx-occluder flex items-center border-y border-border-soft font-mono text-2xs tracking-tight select-none'

/**
 * Split a unified-diff hunk header into its line-range coordinates and the
 * optional trailing context (the enclosing function/section git appends after
 * the closing `@@`). Rendering the range muted and the context slightly stronger
 * makes the *where* skimmable without the coordinates competing
 * with the code. Falls back gracefully when the header isn't the canonical shape.
 */
export function splitHunkHeader(header: string): { range: string; context: string } {
  const m = header.match(/^(@@[^@]*@@)(.*)$/)
  if (!m) return { range: header, context: '' }
  return { range: m[1].trim(), context: m[2].trim() }
}
