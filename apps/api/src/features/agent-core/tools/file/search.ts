import { errorMessage } from '../../../../lib/errors'
import { basename, dirname } from 'node:path'
import { stat } from 'node:fs/promises'
import {
  defineAgentTool,
  type AgentToolResult,
  type AgentToolUpdateCallback,
} from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import { type ExecutionEnvironment, shellQuote, resolveToolCwd } from '../environment'
import { localEnvironment } from '../environments/local'
import { LOCALIX_EXCLUDE_GLOB } from '../environments/ripgrep'
import {
  hasUnescapedRegexMeta,
  modelFacingMatches,
  searchRetries,
  truncateOutput,
} from './search-output'
import { FILE_LIST_LIMIT, presentFileListing } from './search-file-listing'
import { prepareSearchArguments, searchToolInputSchema, type SearchInput } from './search-input'
import { shapeSearchResult } from './search-modes'
import { runSearchBatch, searchQueries } from './search-batch'

/**
 * Wall-clock ceiling per invocation, including retries and file listings.
 * resolveToolCwd accepts absolute paths, so a broad root scan must remain bounded;
 * the caller's cancellation signal can end it sooner.
 */
export const SEARCH_TIMEOUT_SECONDS = 120
export { FILE_LIST_LIMIT } from './search-file-listing'

// Re-export the pure search helpers so existing importers (tests) keep their
// stable `./search` surface.
export { hasUnescapedRegexMeta } from './search-output'

export { searchToolInputSchema, prepareSearchArguments } from './search-input'

import type { SearchToolDetails } from './search-contracts'
export type { SearchToolDetails } from './search-contracts'
import { presentEmptySearch, presentSearchMatches } from './search-results'
import { escapeRegExp } from '../../../../lib/regexp'

/** What a search passes to ripgrep beyond its pattern and glob. Lines of context only go with lines. */
function searchFlags(input: SearchInput) {
  const lines = (input.output_mode ?? 'content') === 'content'
  return {
    ...(lines && input.context ? { context: input.context } : {}),
    ...(input.ignore_case ? { ignoreCase: true } : {}),
    ...(input.multiline ? { multiline: true } : {}),
    ...(input.type ? { type: input.type } : {}),
  }
}

export function createSearchTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
) {
  // TInput/TDetails stated, not inferred — see write.ts: TS defaults TDetails to
  // `unknown` when any return omits `details`, erasing the SearchToolDetails every
  // other return site builds.
  const tool = defineAgentTool<SearchInput, SearchToolDetails>({
    name: TOOL.Search,
    label: 'Search Files',
    activeVerb: 'Searching',
    description: [
      'Search file contents with ripgrep, or find files by name (only `glob`). One call returns file:line for every hit; then `Read` just that span. Put several patterns in one call (`queries`) rather than one repository-wide scan.',
      'A truncated result means narrow the next search; an empty one was already widened, so "no matches" is final.',
    ].join('\n'),
    inputSchema: searchToolInputSchema,
    prepareArguments: prepareSearchArguments,
    mutates: false,
    // Read-only ripgrep search — safe to run concurrently with other reads/searches.
    executionMode: 'parallel',

    async execute(_toolCallId, input, signal, onUpdate) {
      const shaped = (result: AgentToolResult<SearchToolDetails>) =>
        shapeSearchResult(result, { mode: input.output_mode, headLimit: input.head_limit })
      const queries = searchQueries(input)
      if (queries.length <= 1)
        return shaped(await searchOne({ ...input, query: queries[0] }, signal, onUpdate))
      const result = await runSearchBatch(queries, (query) =>
        searchOne({ ...input, query }, signal, undefined),
      )
      if (result.details) onUpdate?.(result.details)
      return shaped(result)
    },
  })

  /** One query: the whole single-search pipeline (listing, retries, grouping). */
  async function searchOne(
    input: SearchInput,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<SearchToolDetails> | undefined,
  ): Promise<AgentToolResult<SearchToolDetails>> {
    const query = input.query?.trim()
    // `path` is the field models reach for on their own (a file or a directory to search):
    // a directory is the cwd, a file is a one-file glob. Live-observed; refusing it cost a
    // round-trip per search, so the schema now accepts what the model already sends.
    if (input.path) {
      const target = resolveToolCwd(input.path, defaultCwd)
      const entry = await stat(target).catch(() => null)
      if (entry?.isDirectory()) input = { ...input, cwd: target }
      else if (entry) input = { ...input, cwd: dirname(target), glob: basename(target) }
      else return { content: `search: path not found: ${input.path}`, isError: true }
    }
    const cwd = resolveToolCwd(input.cwd, defaultCwd)

    // No query: with a glob, LIST file names matching it (`rg --files`) — the
    // correct file-finding primitive (names, not content), elidable, and a
    // replacement for `bash find`. (The old advice `query:"." glob:…` was wrong:
    // `.` matches every line, so it dumped the full content of every file.)
    if (!query) {
      if (!input.glob) {
        return {
          content:
            'search needs a query (ripgrep regex), OR a glob to list files by name (e.g. glob:"**/*.ts" or glob:"plugin.json"). To list one directory, use `Read` on its path.',
          isError: true,
        }
      }
      let res: { stdout: string; stderr: string; exitCode: number }
      try {
        res = await env.exec(
          `rg --files --glob ${shellQuote(input.glob)} --glob ${shellQuote(LOCALIX_EXCLUDE_GLOB)} | head -n ${FILE_LIST_LIMIT + 1}`,
          {
            cwd,
            signal,
            timeout: SEARCH_TIMEOUT_SECONDS,
            uncapped: true,
          },
        )
      } catch (err) {
        return { content: `Failed to list files: ${errorMessage(err)}`, isError: true }
      }
      return presentFileListing({ res, input, cwd, onUpdate })
    }

    let rawOutput: string
    try {
      rawOutput = await env.searchFiles(query, cwd, {
        glob: input.glob,
        ...searchFlags(input),
        signal,
        timeoutSeconds: SEARCH_TIMEOUT_SECONDS,
      })
    } catch (err) {
      const message = errorMessage(err)
      // The model meant a literal string and ripgrep read it as a regex it can't even
      // parse ("patch.matchAll(" → unclosed group). Escaping it is the only thing the
      // model could do on the next turn, so do it now rather than spend that turn.
      if (/regex parse error/i.test(message) && hasUnescapedRegexMeta(query)) {
        const literal = escapeRegExp(query)
        try {
          const out = await env.searchFiles(literal, cwd, {
            glob: input.glob,
            ...searchFlags(input),
            signal,
            timeoutSeconds: SEARCH_TIMEOUT_SECONDS,
          })
          const bounded = truncateOutput(out.trim() ? out : '')
          const details: SearchToolDetails = {
            query: literal,
            cwd,
            ...(input.glob ? { glob: input.glob } : {}),
            ...bounded,
          }
          onUpdate?.(details)
          return {
            content: out.trim()
              ? `"${query}" is not a valid regex — searched for it as a literal string instead:\n${modelFacingMatches(bounded.output)}`
              : `"${query}" is not a valid regex. Searched for it as a literal string too — no matches in ${cwd}.`,
            details,
          }
        } catch {
          // fall through to the generic error below
        }
      }
      // The model pointed `cwd` at a FILE ("search within this file"). rg needs a
      // directory as its working dir, so it fails with ENOTDIR. Re-run from the
      // file's parent, scoped to just that file via a basename glob — the search
      // the model actually intended. Without this the model never recovers (it
      // keeps re-passing the same file cwd), so do it here rather than spend turns.
      if (/ENOTDIR|not a directory/i.test(message)) {
        const parent = dirname(cwd)
        const fileGlob = input.glob ?? basename(cwd)
        try {
          const out = await env.searchFiles(query, parent, {
            glob: fileGlob,
            ...searchFlags(input),
            signal,
            timeoutSeconds: SEARCH_TIMEOUT_SECONDS,
          })
          const bounded = truncateOutput(out.trim() ? out : '')
          const details: SearchToolDetails = { query, cwd: parent, glob: fileGlob, ...bounded }
          onUpdate?.(details)
          return {
            content: out.trim()
              ? `(\`cwd\` was a file, not a directory — searched within ${basename(cwd)} instead)\n${modelFacingMatches(bounded.output)}`
              : `No matches for "${query}" in ${basename(cwd)}. (\`cwd\` must be a directory; searched that one file.)`,
            details,
          }
        } catch {
          // fall through to the generic error below
        }
      }
      const unavailable = message.includes('ENOENT') || message.includes('not found')
      const details: SearchToolDetails = {
        query: query,
        cwd,
        ...(input.glob ? { glob: input.glob } : {}),
        bytes: 0,
        truncated: false,
        output: '',
      }
      onUpdate?.(details)
      return {
        content: unavailable
          ? 'ripgrep (rg) is not available in this environment. Fall back to `Bash` with grep/find for this search.'
          : `Failed to run search: ${message}`,
        details,
        isError: true,
      }
    }

    if (!rawOutput || rawOutput.trim() === '') {
      const scope = input.glob ? ` (glob: ${input.glob})` : ''
      // An empty result is usually a FALSE negative, and telling the model to retry
      // costs it a whole turn. Try the obvious widenings here instead: drop the glob
      // (86 of the 98 empty searches in the recorded corpus carried one), and treat a
      // query with unescaped regex metacharacters as the literal string it looks like
      // (72 of them did). Stop at the first retry that finds something, and always
      // say WHICH search produced the output — never pretend the original matched.
      for (const retry of searchRetries(query, input.glob)) {
        if (signal?.aborted) break
        let out: string
        try {
          out = await env.searchFiles(retry.query, cwd, {
            glob: retry.glob,
            ...searchFlags(input),
            signal,
            timeoutSeconds: SEARCH_TIMEOUT_SECONDS,
          })
        } catch {
          break // rg just worked; a failure here is not worth reporting over the no-match
        }
        if (!out || out.trim() === '') continue
        const bounded = truncateOutput(out)
        const details: SearchToolDetails = {
          query: retry.query,
          cwd,
          ...(retry.glob ? { glob: retry.glob } : {}),
          ...bounded,
        }
        onUpdate?.(details)
        return {
          content:
            `No matches for "${query}" in ${cwd}${scope}. Retried ${retry.label} — these matched:\n` +
            `${modelFacingMatches(bounded.output)}\n` +
            `[the results above come from "${retry.query}"${retry.glob ? ` under glob "${retry.glob}"` : ' across the whole tree'}, not from your original query]`,
          details,
        }
      }

      return presentEmptySearch({ query, cwd, input, scope, onUpdate })
    }

    return presentSearchMatches({ query, cwd, input, rawOutput, onUpdate })
  }
  return tool
}
