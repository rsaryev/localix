/**
 * Diff-shaped contracts — a patch, its hunks, its individually stageable lines,
 * a two-commit range, and per-line authorship.
 *
 * Split out of `contracts.ts`, which had grown past the repo's own size ratchet.
 * The seam is real rather than arbitrary: nothing here refers to working-tree
 * status, branches or the workspace envelope, so this file has no import back —
 * it is the vocabulary of "what changed between two versions of a file",
 * independent of who changed it or where. `contracts.ts` re-exports it, so every
 * importer still reads `from './contracts'`.
 */

/** Selects which diff of a path to produce. */
export interface FileDiffInput {
  path: string
  /** Diff the staged (index-vs-HEAD) version instead of the full working change. */
  staged?: boolean
  /** The path is untracked — synthesize a diff against an empty file. */
  untracked?: boolean
}

export interface FileDiff {
  path: string
  /** Unified diff text (empty when there is no change). */
  diff: string
  /**
   * The diff carries no textual hunk at all — every change in it is binary. A multi-file diff
   * with one binary file among text files is NOT binary; it renders its text files.
   */
  binary: boolean
  /**
   * The patch outgrew the capture ceiling, so `diff` is its leading complete files only (a
   * single-file diff keeps its complete lines). Absent when the diff is whole. Without it an
   * overflow read as "no changes".
   */
  truncated?: boolean
}

/**
 * One granular change block of a file vs the last commit — a single zero-context
 * (`-U0`) hunk. VCS-neutral: a unified-diff hunk is a general concept, not a git
 * one. Backs the editor's inline quick-diff peek + per-hunk revert; each hunk maps
 * 1:1 to a gutter marker so the user can revert exactly one agent-made change.
 */
export interface RepoFileHunk {
  /** 0-based position in the file's ordered hunk list — the revert target. */
  index: number
  /** Raw `@@ -a,b +c,d @@` header; a drift guard checked on revert (stale → refuse). */
  header: string
  /**
   * 1-based first line the change occupies in the MODIFIED (current) file, aligned
   * with the quick-diff gutter marker. A pure deletion points at the surviving line
   * above the removed block.
   */
  modifiedStart: number
  /** 1-based last modified line (inclusive); equals `modifiedStart` for a deletion. */
  modifiedEnd: number
  /** Original lines this hunk removed (no `-` prefix) — what a revert restores. */
  oldLines: string[]
  /** New lines this hunk added (no `+` prefix) — what a revert removes. */
  newLines: string[]
}

/** What a single rendered diff line is — a hunk header or a body line. VCS-neutral. */
export type DiffLineKind = 'hunk' | 'context' | 'add' | 'del'

/**
 * One line of a file's diff, addressable for LINE-LEVEL staging. `index` is the
 * 0-based position in the raw diff text (the stable selection key sent back to
 * stage/unstage/discard); the same diff is re-fingerprinted server-side to guard
 * against drift.
 */
export interface RepoDiffLine {
  index: number
  kind: DiffLineKind
  /** Line text WITHOUT the leading `+`/`-`/space; for a `hunk` line the verbatim `@@ … @@`. */
  content: string
  /** 1-based line number in the OLD (pre-image) file — set for `context`/`del`. */
  oldNo?: number
  /** 1-based line number in the NEW (post-image) file — set for `context`/`add`. */
  newNo?: number
}

/** Which diff of a file backs a staging view. `unstaged` = worktree vs index; `staged` = index vs HEAD. */
export type LineStageMode = 'staged' | 'unstaged'

/** A file's diff as selectable lines for the line-staging view. */
export interface FileDiffLines {
  path: string
  mode: LineStageMode
  /** Fingerprint of the underlying diff; echoed back on stage/unstage/discard as a drift guard. */
  diffId: string
  lines: RepoDiffLine[]
  /** Binary file — no selectable lines (stage the whole file instead). */
  binary: boolean
  /**
   * The file's diff outgrew the capture ceiling. `lines` is then EMPTY: a patch built from a cut
   * diff would stage against a hunk git never finished printing. Stage the whole file instead.
   */
  truncated?: boolean
}

/**
 * The diff between two commits — a whole `git diff <from> <to>` as a PURE
 * multi-file unified-diff string (rendered by the same multi-file DiffView a
 * commit diff uses) plus a compact `--shortstat` summary. `two-dot` (default)
 * shows the total difference between the two trees; `three-dot` shows what
 * changed on `to` since the merge base with `from`.
 */
export interface RangeDiff extends FileDiff {
  /** The base ref (older side) as passed. */
  from: string
  /** The target ref (newer side) as passed. */
  to: string
  /** Compact `git diff --shortstat` line (e.g. "3 files changed, 12 insertions(+), 4 deletions(-)"); empty when none. */
  stat: string
  /** True when this was a symmetric three-dot (`from...to`) diff. */
  threeDot: boolean
}

/**
 * One line's authorship, for the editor's inline blame decoration.
 * VCS-neutral: "who last touched this line,
 * when, and why" is a general concept. An uncommitted (working-tree) line carries
 * the all-zero sha, `uncommitted: true`, and blank author/date — the UI renders
 * "Not committed yet".
 */
export interface BlameLine {
  /** 1-based line number in the file. */
  line: number
  /** Full commit sha (all-zero for uncommitted work). */
  sha: string
  /** Commit author name; blank for an uncommitted line. */
  author: string
  /** Author time as epoch SECONDS; 0 for an uncommitted line. */
  authorTime: number
  /** Commit subject (first message line); blank for an uncommitted line. */
  summary: string
  /** True when the line is not yet committed. */
  uncommitted: boolean
}
