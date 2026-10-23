/**
 * Line-level authorship for the git backend — `git blame --porcelain`, parsed
 * into compact per-line records for the editor's inline blame decoration.
 * Read-only; never mutates the repo.
 *
 * The porcelain format emits a commit's metadata (author / author-time / summary)
 * ONCE, the first time that commit's sha is seen; later lines from the same commit
 * carry only the sha header + the tab-prefixed content line. `parseBlamePorcelain`
 * caches metadata per sha so every line resolves its full record. Uncommitted
 * (working-tree) lines carry the all-zero sha and are flagged `uncommitted` with
 * blanked author/time — the UI renders "Not committed yet".
 *
 * `blameFile` never throws: any git failure (not a file in the repo, unborn
 * branch, etc.) resolves to an empty list so the route degrades to no blame
 * rather than surfacing an error.
 */
import type { GitRunner } from './cli'

export interface BlameLine {
  /** 1-based line number in the file (the blamed "final" line). */
  line: number
  /** Full commit sha the line is attributed to (all-zero for uncommitted work). */
  sha: string
  /** Commit author name; blank for an uncommitted line. */
  author: string
  /** Author time as epoch SECONDS; 0 for an uncommitted line. */
  authorTime: number
  /** Commit subject (first line of the message); blank for an uncommitted line. */
  summary: string
  /** True when the line is not yet committed (all-zero sha) — "Not committed yet". */
  uncommitted: boolean
}

/** The blame group header: `<40-hex-sha> <orig-line> <final-line> [<num-lines>]`. */
const HEADER_RE = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/
/** A commit that isn't committed yet — git reports it as an all-zero sha. */
const ZERO_SHA_RE = /^0{40}$/

interface CommitMeta {
  author: string
  authorTime: number
  summary: string
}

/**
 * Parse `git blame --porcelain` output into per-line authorship records. Pure and
 * self-contained (no git or editor dependency) so it can be unit-tested directly. Handles
 * the format's header-once-per-sha caching, so a repeated commit's lines still
 * resolve their author/date/summary. Malformed / empty input → an empty list.
 */
export function parseBlamePorcelain(output: string): BlameLine[] {
  const result: BlameLine[] = []
  if (!output) return result

  // Metadata is emitted once per sha; cache it so repeated lines resolve fully.
  const cache = new Map<string, CommitMeta>()
  let sha = ''
  let finalLine = 0
  // Metadata parsed within the CURRENT group (before its tab content line). Undefined
  // for a repeated sha, in which case we fall back to the cached values.
  let author: string | undefined
  let authorTime: number | undefined
  let summary: string | undefined

  for (const raw of output.split('\n')) {
    const header = HEADER_RE.exec(raw)
    if (header) {
      sha = header[1]
      finalLine = Number(header[2])
      author = undefined
      authorTime = undefined
      summary = undefined
      continue
    }
    // `author-mail`/`author-tz` also start with `author `-ish prefixes — match the
    // exact keys so they aren't mistaken for the author NAME / time.
    if (raw.startsWith('author ')) {
      author = raw.slice('author '.length)
      continue
    }
    if (raw.startsWith('author-time ')) {
      authorTime = Number(raw.slice('author-time '.length))
      continue
    }
    if (raw.startsWith('summary ')) {
      summary = raw.slice('summary '.length)
      continue
    }
    // The tab-prefixed line carries the source text and closes the group — finalize
    // one BlameLine for `finalLine`. (We don't keep the content; the editor has it.)
    if (raw.startsWith('\t')) {
      if (!sha) continue
      const cached = cache.get(sha)
      const meta: CommitMeta = {
        author: author ?? cached?.author ?? '',
        authorTime: authorTime ?? cached?.authorTime ?? 0,
        summary: summary ?? cached?.summary ?? '',
      }
      cache.set(sha, meta)
      const uncommitted = ZERO_SHA_RE.test(sha)
      result.push({
        line: finalLine,
        sha,
        author: uncommitted ? '' : meta.author,
        authorTime: uncommitted ? 0 : meta.authorTime,
        summary: uncommitted ? '' : meta.summary,
        uncommitted,
      })
    }
  }
  return result
}

/**
 * A file path safe to pass after `--`: non-empty and not a bare `-flag` (the `--`
 * separator already stops flag interpretation, but reject empties up front).
 */
function isSafePath(file: string): boolean {
  return file.length > 0 && !file.startsWith('-')
}

/**
 * Blame a file (optionally a `[start,end]` 1-based line range via `-L`), returning
 * per-line authorship. Read-only; never throws — a git failure yields `[]`.
 */
export async function blameFile(
  run: GitRunner,
  file: string,
  range?: { start: number; end: number },
): Promise<BlameLine[]> {
  if (!isSafePath(file)) return []
  const args = ['blame', '--porcelain']
  // `-L` bounds are integers built here (never client text), so no injection risk.
  if (range && range.start > 0 && range.end >= range.start) {
    args.push('-L', `${range.start},${range.end}`)
  }
  args.push('--', file)
  const res = await run(args)
  if (!res.ok) return []
  return parseBlamePorcelain(res.stdout)
}
