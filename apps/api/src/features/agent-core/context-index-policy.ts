/**
 * Which tool outputs may enter the chunk index — the one owner of that rule.
 *
 * It was three owners, and only one of them knew the rule. `externalize.ts` skipped these
 * tools at execution time; the LLM compaction digest (since removed) decided whether to
 * advertise the SEARCH form of a handle from size alone; and `context-search.ts`'s lazy self-heal indexed
 * whatever tool_call_id it was handed. So a large output-search result got a digest line
 * advertising another search, the model followed it, the self-heal saw "not
 * indexed" — which was the POLICY, not a gap — and indexed a search result, which is exactly
 * the echo this set exists to prevent. A shared rule that two of its three call sites cannot
 * see is not a rule.
 */

import { TOOL } from './tool-names'

/**
 * Tools whose results must never enter the index: the search/recovery surface itself
 * (indexing a search result makes hits echo forever). Visual `read` calls are excluded
 * per result in externalize.ts because ordinary text reads remain valuable to index.
 *
 * `tool_output` earns its place twice over — its get result is a REPLAY of another call's
 * output, so indexing it would file the same text under a second tool_call_id.
 */
export const INDEX_SKIPPED_TOOLS: ReadonlySet<string> = new Set<string>([
  TOOL.tool_output,
  TOOL.global_search,
  // Historical sessions may still contain model-visible image results from the removed
  // `attach_file` and `view_image` tools: base64 pixels, nothing to index.
  'attach_file',
  'view_image',
])

/** Whether this tool's output is barred from the chunk index. */
export function isIndexSkippedTool(toolName: string): boolean {
  return INDEX_SKIPPED_TOOLS.has(toolName)
}

/**
 * Session index cap: the oldest chunks are evicted past it, so the index never outgrows its
 * session. Exported because a searcher has to be able to tell "nothing in this
 * session matched" from "this session's index is full and older sections are gone".
 */
export const MAX_CHUNKS_PER_SESSION = 5000
