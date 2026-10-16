import type { AgentToolResult, AgentToolUpdateCallback } from '@localixai/agent/agents'
import { MAX_AGENT_SOURCES } from '@localixai/agent/agents'
import { discoveredFileSource } from '../source-refs'
import {
  hasUnescapedRegexMeta,
  matchedFiles,
  modelFacingMatches,
  truncateOutput,
} from './search-output'
import type { SearchToolDetails } from './search-contracts'

type SearchUpdate = AgentToolUpdateCallback<SearchToolDetails>

/** What one search was asked for. */
interface SearchAsk {
  query: string
  cwd: string
  input: { glob?: string }
}

export function presentEmptySearch({
  query,
  cwd,
  input,
  scope,
  onUpdate,
}: SearchAsk & {
  scope: string
  onUpdate?: SearchUpdate
}): AgentToolResult<SearchToolDetails> {
  const details: SearchToolDetails = {
    query: query,
    cwd,
    ...(input.glob ? { glob: input.glob } : {}),
    bytes: 0,
    truncated: false,
    output: '',
  }
  onUpdate?.(details)
  const regexHint = hasUnescapedRegexMeta(query)
    ? ' A literal-string retry found nothing either, so the text is genuinely absent.'
    : ''
  const globHint = input.glob
    ? ' Searching the whole tree without the glob found nothing either.'
    : ''
  return {
    content: `No matches for "${query}" in ${cwd}${scope}.${regexHint}${globHint}`,
    details,
  }
}

interface MatchResultOptions extends SearchAsk {
  rawOutput: string
  onUpdate?: SearchUpdate
}

export function presentSearchMatches({
  query,
  cwd,
  input,
  rawOutput,
  onUpdate,
}: MatchResultOptions): AgentToolResult<SearchToolDetails> {
  const truncated = truncateOutput(rawOutput)
  const details: SearchToolDetails = {
    query: query,
    cwd,
    ...(input.glob ? { glob: input.glob } : {}),
    bytes: truncated.bytes,
    truncated: truncated.truncated,
    output: truncated.output,
  }
  onUpdate?.(details)

  // DISCOVERED, never consulted. A hit proves a string exists in a file; nothing read it.
  // `docs/internals/subsystems/context-system.md` §9 rejects treating discovery snippets as
  // consulted evidence, so the answer surface hides these while the session registry keeps
  // them — "what did you look at" honestly includes what you searched.
  //
  // Built on the SAME conservative parser the grouper uses: one unparseable line and it
  // returns nothing at all, so a change in ripgrep's output shape costs provenance rather
  // than producing wrong provenance.
  //
  // Parsed from `rawOutput`, NOT from `truncated.output`. Truncation appends a `[…truncated…]`
  // sentinel and can cut the final line mid-content, and the parser above treats either as
  // "this is not match output" and returns nothing — so every search large enough to truncate
  // published no provenance at all, silently. Measured before the fix: 20 000 matches gave
  // 20 000 files from the raw output and 0 from the truncated one. The bigger the search, the
  // less it could say about itself.
  //
  // Bounded here rather than left to `normalizeAgentSources`: that cap protects the wire, but
  // building twenty thousand records to throw all but a few away is work nobody asked for.
  const sources = matchedFiles(rawOutput)
    .slice(0, MAX_AGENT_SOURCES)
    .map(({ file, line }) => discoveredFileSource({ path: file, line }))
  return {
    content: modelFacingMatches(truncated.output) || 'No matches found.',
    details,
    ...(sources.length > 0 ? { sources } : {}),
  }
}
