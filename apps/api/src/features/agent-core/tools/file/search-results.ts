import type { AgentToolResult, AgentToolUpdateCallback } from '@localixai/agent/agents'
import { MAX_AGENT_SOURCES } from '@localixai/agent/agents'
import { discoveredFileSource } from '../source-refs'
import { searchDedupStub, type SearchDedupStore, type SearchKey } from '../../search/search-dedup'
import {
  hasUnescapedRegexMeta,
  matchedFiles,
  modelFacingMatches,
  truncateOutput,
} from './search-output'
import type { SearchToolDetails } from './search-contracts'

type SearchUpdate = AgentToolUpdateCallback<SearchToolDetails>

export function presentEmptySearch({
  query,
  cwd,
  input,
  scope,
  onUpdate,
}: Pick<SearchKey, 'query' | 'cwd'> & {
  input: Pick<SearchKey, 'glob'>
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

interface MatchResultOptions extends Pick<SearchKey, 'query' | 'cwd'> {
  input: Pick<SearchKey, 'glob' | 'context'>
  rawOutput: string
  toolCallId: string
  dedup: SearchDedupStore
  isResultElided?: (toolCallId: string) => boolean
  onUpdate?: SearchUpdate
}

export function presentSearchMatches({
  query,
  cwd,
  input,
  rawOutput,
  toolCallId,
  dedup,
  isResultElided,
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

  // Repeat-search dedup (see `../../search/search-dedup.ts`). The search RAN — the
  // tree is live and the model must never be told about stale hits — but when this
  // exact search just returned these exact bytes, re-delivering them buys the model
  // nothing it doesn't already have a few turns up. Hand it a pointer and the better
  // move instead. The UI card keeps the real results either way: only the model's
  // `content` is swapped, `details` is untouched.
  //
  // The stub is only truthful while the earlier search it points at is intact on the
  // wire, so ask (`isResultElided`); a host that wires no answer falls back to
  // stubbing each search once, which cannot outlive what it points at by more than
  // one turn.
  const key = {
    query,
    cwd,
    ...(input.glob ? { glob: input.glob } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
  }
  const earlierCallId = dedup.lastCallId(key)
  const stubOk = isResultElided
    ? earlierCallId !== undefined && !isResultElided(earlierCallId)
    : !dedup.stubServed(key)
  if (dedup.isUnchanged(key, truncated.output) && stubOk) {
    dedup.setStubServed(key, true)
    return { content: searchDedupStub(key), details }
  }
  dedup.record(key, truncated.output, toolCallId)

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
