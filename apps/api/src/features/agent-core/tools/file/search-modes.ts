import type { AgentToolResult } from '@localixai/agent/agents'

import type { SearchToolDetails } from './search-contracts'
import { modelFacingMatches } from './search-output'

type Mode = 'content' | 'files_with_matches' | 'count'

/** Hit lines of ripgrep's `path:line:text` output, as paths in order of first appearance. */
function countByFile(output: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of output.split('\n')) {
    const match = /^(.+?):\d+:/.exec(line)
    if (match) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1)
  }
  return counts
}

/** The result lines of a mode: the paths that matched, or `path:hits` and a total. */
function renderMode(output: string, mode: Exclude<Mode, 'content'>): string {
  const counts = countByFile(output)
  if (mode === 'files_with_matches') return [...counts.keys()].join('\n')
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
  const lines = [...counts].map(([file, n]) => `${file}:${n}`)
  return [...lines, `[${total} matches in ${counts.size} files]`].join('\n')
}

/** The first `limit` lines, and a note that says what was cut. */
function capLines(text: string, limit: number): string {
  const lines = text.split('\n')
  if (lines.length <= limit) return text
  return `${lines.slice(0, limit).join('\n')}\n[head_limit ${limit}: ${lines.length - limit} more lines not shown]`
}

/**
 * Claude Code's `output_mode` and `head_limit` on a finished search. The search itself ran as a
 * content search; its `path:line:text` hits are folded into the paths that matched, or a count per
 * file. Any note the search put around its hits (a retry that widened it) stays where it was. A
 * failed or empty search is returned as it is.
 */
export function shapeSearchResult(
  result: AgentToolResult<SearchToolDetails>,
  options: { mode?: Mode; headLimit?: number },
): AgentToolResult<SearchToolDetails> {
  const details = result.details
  const mode = options.mode ?? 'content'
  if (result.isError || !details?.output || (mode === 'content' && options.headLimit === undefined))
    return result
  const body = modelFacingMatches(details.output)
  const shaped = mode === 'content' ? details.output : renderMode(details.output, mode)
  const capped = options.headLimit ? capLines(shaped, options.headLimit) : shaped
  const shown = mode === 'content' ? capLines(body, options.headLimit ?? Infinity) : capped
  const at = result.content.indexOf(body)
  const content =
    at >= 0 ? result.content.slice(0, at) + shown + result.content.slice(at + body.length) : shown
  return { ...result, content, details: { ...details, output: capped } }
}
