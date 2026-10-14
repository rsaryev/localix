import { shellQuote, interpretRipgrep } from '../../agent-core/tools/environment'
import { includeIgnoredRgFlags, loadProjectFileIndex } from '../../agent-core/project-file-index'
import { withPathLocks, workspaceLockPaths } from '../../agent-core/tools/file/file-utils'
import { ApiError, errorMessage } from '../../../lib/errors'
import { searchToolMissing } from './search-tool-missing'
import { getProjectFileList, type IndexedFiles } from './file-list-cache'
import { applyReplace, buildReplaceRegExp } from './search-replace'
import { parseRipgrepMatches } from './ripgrep-parse'
import { writeResolvedFileUnderLock } from './file-content'
import {
  openSessionEnv,
  resolveAgainst,
  contentHash,
  type FileOpsContext,
} from './file-ops-context'
import type { FileContentSearchResult, FileSearchResult } from '../contracts'

import { searchPaths, type FindFilesOptions } from './file-path-search'
export { deriveFolders, searchPaths, type FindFilesOptions } from './file-path-search'

/**
 * Project SEARCH over a session's working tree: file-name search (⌘P quick-open,
 * the composer @-autocomplete, the tree search box), content search (the inspector
 * search panel), and search-and-replace. Everything runs through the session's
 * execution environment (`rg`), so an ssh/docker session searches its own remote
 * tree; ranking/parsing/substitution are pure and unit-tested.
 */

/**
 * Project file search backing the ⌘P quick-open palette, the composer
 * @-autocomplete, and the file-tree search box. Lists project files via
 * `rg --files` (respects .gitignore) then filters/ranks them.
 *
 * Backend-agnostic: everything runs through `ExecutionEnvironment.exec`, never a
 * direct `node:fs` read of the local path, so ssh/docker sessions search their
 * own remote tree. Returns an empty result (not an error) when ripgrep is
 * unavailable or a regex is malformed, so the UI degrades quietly.
 *
 * Ranking: fuzzy mode scores subsequence matches (exact-basename + boundary +
 * consecutive-run bonuses, shorter paths break ties — see `fuzzyScore`). We have
 * no per-file recency source here, so "recent" ordering is intentionally omitted;
 * the UI surfaces recents separately (e.g. QuickOpen's recent-files group).
 */
export async function findFiles(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  query: string,
  opts: FindFilesOptions = {},
): Promise<FileSearchResult> {
  const { env, dir: root } = await openSessionEnv(ctx, userId, sessionId)

  const includeIgnored = opts.includeIgnored === true
  // The walk is memoized per root: these callers search on EVERY keystroke, and
  // re-walking the tree each time is the dominant cost of quick-open. See
  // file-list-cache.ts for how staleness is bounded.
  let indexed: IndexedFiles
  try {
    indexed = await getProjectFileList(root, includeIgnored, () =>
      loadProjectFileIndex(env, root, includeIgnored),
    )
  } catch {
    return { root, files: [], count: 0 }
  }

  return {
    root,
    ...searchPaths(indexed.paths, query, opts),
    ...(indexed.omitted > 0 ? { indexTruncated: indexed.omitted } : {}),
  }
}

/** Options for {@link searchContent}. */
export interface ContentSearchOptions {
  /** Treat the query as a regular expression. Default false = literal text
   *  (fixed-string), so `const a` matches the substring "const a" verbatim. */
  regex?: boolean
  /** Case-sensitive match. Default false = smart-case (case-insensitive unless
   *  the query contains an uppercase letter), matching editor search ergonomics. */
  caseSensitive?: boolean
  /** Match whole words only (ripgrep `--word-regexp`). */
  wholeWord?: boolean
  /** Restrict to files matching this ripgrep glob (e.g. "*.ts", "src/**"). */
  glob?: string
  /** Exclude files matching this ripgrep glob (e.g. "*.test.ts", "dist/**"). */
  excludeGlob?: string
  /** Hard cap on the number of matches returned (default 300). */
  limit?: number
  /** Lines of surrounding source context to attach to each match (0–3, default 0). */
  contextLines?: number
  /** Search inside files a parent repo's `.gitignore` hides (container-of-clones
   *  — see {@link includeIgnoredRgFlags}). Default false = respect .gitignore. */
  includeIgnored?: boolean
}

/**
 * Project content (text) search backing the inspector search panel's "Text" mode
 * — the substring/regex grep over file CONTENTS that filename search never did.
 *
 * Runs `rg --json` through the session's execution environment (backend-agnostic:
 * local/ssh/docker), so a query like `const a` finds every line containing it.
 * Defaults to a literal (fixed-string), smart-case match — the behaviour a user
 * typing into a search box expects. When `contextLines > 0`, `--context N` is
 * added and the surrounding lines are attached to each match (expandable
 * context). Returns an empty result only for ripgrep's ordinary exit-1 "no matches".
 * Broken regexes,
 * missing ripgrep, and unreadable roots are surfaced so the UI cannot present a
 * failed search as the factual claim "No results". Parsing is delegated to the
 * pure {@link parseRipgrepMatches}.
 */
export async function searchContent(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  query: string,
  opts: ContentSearchOptions = {},
): Promise<FileContentSearchResult> {
  const { env, dir: root } = await openSessionEnv(ctx, userId, sessionId)
  const limit = opts.limit ?? 300
  // Clamp context to a small, sane window (guards a hostile/large query param).
  const contextLines = Math.max(0, Math.min(3, Math.trunc(opts.contextLines ?? 0)))

  if (!query) return { root, matches: [], count: 0, truncated: false }

  const flags = ['--json']
  if (!opts.regex) flags.push('--fixed-strings')
  flags.push(opts.caseSensitive ? '--case-sensitive' : '--smart-case')
  if (opts.wholeWord) flags.push('--word-regexp')
  if (contextLines > 0) flags.push('--context', String(contextLines))
  if (opts.includeIgnored) flags.push(...includeIgnoredRgFlags())
  if (opts.glob) flags.push('--glob', shellQuote(opts.glob))
  // Exclusion is a negated ripgrep glob (`!pattern`).
  if (opts.excludeGlob) flags.push('--glob', shellQuote(`!${opts.excludeGlob}`))

  // Bound the JSON stream at the SOURCE. Unbounded, `rg --json` emits an event per
  // match across the whole tree and only `limit` of them survive parsing, so the
  // panel paid for the entire result set to show a page of it. Worse, past 4 MB the
  // exec capture trims to the TAIL, and the kept slice begins mid-record — that
  // first partial line is not valid JSON and is silently dropped.
  //
  // Measured on a 400-file / 80k-match tree, medians over 6 alternating runs:
  // 3.00 MB captured / 16ms → 197 KB / 8ms. (Not claimed: that particular matches
  // are lost. `rg` walks in parallel, so "the first 300" was never a defined set.)
  //
  // `head` both bounds the transfer and makes ripgrep stop early (SIGPIPE) instead
  // of scanning on for results nobody will read. Line budget: each match is one
  // `match` event, each file adds `begin`/`end`, and each context line one more.
  const maxJsonLines = limit * (3 + 2 * contextLines) + 16
  // ripgrep's exit code has to survive the pipe (the pipeline reports HEAD's status,
  // and `pipefail` is not portable across the ssh/docker shells). Route it out on
  // stderr, which `head` never sees.
  const command =
    `{ rg ${flags.join(' ')} -e ${shellQuote(query)} . ; echo "__RG_EXIT__$?" >&2 ; }` +
    ` | head -n ${maxJsonLines}`

  let res: { stdout: string; stderr: string; exitCode: number }
  try {
    res = await env.exec(command, { cwd: root })
  } catch (err) {
    throw (
      searchToolMissing(errorMessage(err)) ??
      new ApiError(500, 'content_search_failed', errorMessage(err))
    )
  }
  const marker = /__RG_EXIT__(\d+)/.exec(res.stderr)
  // 141 = SIGPIPE: `head` closed the stream because we already have all we asked
  // for. That is a successful, deliberately-cut search, not a failure.
  const rgExit = marker ? Number(marker[1]) : res.exitCode
  const cutShort = rgExit === 141
  let stdout: string
  try {
    // exit 1 is the normal no-match result; 2+ with partial stdout preserves the
    // readable matches, while a genuinely failed invocation throws.
    stdout = interpretRipgrep({
      stdout: res.stdout,
      stderr: res.stderr.replace(/__RG_EXIT__\d+\s*/, ''),
      exitCode: cutShort ? 0 : rgExit,
    })
  } catch (err) {
    throw (
      searchToolMissing(errorMessage(err), rgExit) ??
      new ApiError(opts.regex ? 400 : 500, 'content_search_failed', errorMessage(err))
    )
  }

  // A stream `head` cut is truncated even when the parser did not have to drop
  // anything — there are more matches out there, we simply stopped asking.
  const { matches, truncated } = parseRipgrepMatches(stdout, { limit, contextLines })
  return { root, matches, count: matches.length, truncated: truncated || cutShort }
}

/** Outcome of a {@link replaceContent} run. */
export interface ReplaceContentResult {
  /** Number of files whose contents changed. */
  filesChanged: number
  /** Total number of replacements written. */
  replacements: number
}

interface ReplacePlan {
  path: string
  before: string
  after: string
  replacements: number
}

type ReplaceWriter = (path: string, content: string, baseHash: string) => Promise<unknown>

/**
 * Commit a prepared multi-file replacement. On a later conflict/write failure,
 * restore every file already committed (only when it still contains our exact
 * replacement bytes). This gives Replace all all-or-nothing behaviour for ordinary
 * failures without ever overwriting an external edit that raced the rollback.
 */
export async function commitReplacePlans(
  plans: readonly ReplacePlan[],
  write: ReplaceWriter,
): Promise<ReplaceContentResult> {
  const committed: ReplacePlan[] = []
  try {
    for (const plan of plans) {
      await write(plan.path, plan.after, contentHash(plan.before))
      committed.push(plan)
    }
  } catch (err) {
    const rollbackFailures: string[] = []
    for (const plan of committed.reverse()) {
      try {
        await write(plan.path, plan.before, contentHash(plan.after))
      } catch {
        rollbackFailures.push(plan.path)
      }
    }
    if (rollbackFailures.length > 0) {
      throw new ApiError(
        409,
        'replace_partial',
        `Replace failed and ${rollbackFailures.length} file${rollbackFailures.length === 1 ? '' : 's'} could not be safely restored: ${rollbackFailures.join(', ')}`,
      )
    }
    throw err
  }
  return {
    filesChanged: committed.length,
    replacements: committed.reduce((sum, plan) => sum + plan.replacements, 0),
  }
}

/**
 * Search-and-replace across the project (backs the Search view's "Replace all").
 * Finds the matching files via {@link searchContent} (same flags), then rewrites
 * each one through the locked, optimistic-concurrency file-write path so
 * it stays coherent with the agent's own edits. The substitution itself is the
 * pure, unit-tested {@link applyReplace} (JS RegExp built from the same options),
 * so regex capture references (`$1`) work and a literal `$` stays literal.
 */
export async function replaceContent(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  query: string,
  replacement: string,
  opts: ContentSearchOptions = {},
): Promise<ReplaceContentResult> {
  if (!query) return { filesChanged: 0, replacements: 0 }
  const re = buildReplaceRegExp(query, {
    regex: opts.regex,
    caseSensitive: opts.caseSensitive,
    wholeWord: opts.wholeWord,
  })
  if (!re) return { filesChanged: 0, replacements: 0 }

  // Reuse the search to get the exact set of files that contain matches.
  const search = await searchContent(ctx, userId, sessionId, query, { ...opts, limit: 100_000 })
  const files = [...new Set(search.matches.map((m) => m.path))]
  const { env, dir: root } = await openSessionEnv(ctx, userId, sessionId)
  const paths = files.map((rel) => resolveAgainst(root, rel))

  // Hold every target path lock while reading, writing, and (if necessary)
  // rolling back. The shared locks serialize this operation against editor saves,
  // agent write/edit, LSP edits, and other Replace-all requests.
  return withPathLocks(workspaceLockPaths(root, paths), async () => {
    const plans: ReplacePlan[] = []
    for (const abs of paths) {
      let content: string
      try {
        content = await env.readFile(abs)
      } catch {
        continue
      }
      const { text, count } = applyReplace(content, re, replacement, !opts.regex)
      if (count === 0 || text === content) continue
      plans.push({ path: abs, before: content, after: text, replacements: count })
    }
    return commitReplacePlans(plans, (path, content, baseHash) =>
      writeResolvedFileUnderLock(env, path, content, baseHash),
    )
  })
}
