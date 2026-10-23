import { agentSourceId, type AgentSource } from '@localixai/agent/agents'
import { fileUiUri } from '@localixai/mini-app-sdk/navigation'

export { fileOpenMarkdownLink, fileUiUri } from '@localixai/mini-app-sdk/navigation'

/**
 * Builders for the provenance a built-in tool publishes on its result.
 *
 * `AgentToolResult.sources` has always been the universal channel for "what evidence did this tool
 * put in front of the model", but only `research` and the MCP adapter ever filled it — so the
 * answer's Sources list meant "web links", not "what the agent looked at". Reading a file, jumping
 * to a symbol, searching history and spawning a sub-agent all pull context into the model and all
 * published nothing.
 *
 * These mint URIs that the workbench ALREADY knows how to open. `localix://ui/work-item/file` and
 * `localix://ui/work-item/chat` are registered by `FileTab.surface.ts` and `ChatSurface.surface.ts`
 * (with exactly the `path`/`line` and `session` params used here), so `canNavigateUi` resolves them
 * without one line of new navigation. Note those surfaces set `exposure: {search:false,
 * palette:false}` — that only keeps them out of the command palette; `canNavigateUi` gates on
 * resolvability alone, which is why a source row is clickable.
 *
 * COST: nothing reaches the model. Sources are display-only and never replayed into the prompt
 * (`agents/item-model.ts`). Snippets are deliberately omitted for file/symbol/session sources —
 * the title and URI say everything a row needs, and a snippet per read would inflate
 * `payload_json` and the WS snapshot on exactly the read-heavy sessions where it hurts.
 */

function encode(value: string): string {
  return encodeURIComponent(value)
}

/**
 * The last path segment, for a row label that is readable at a glance.
 *
 * `findLast` would read better and is what the UI's copy of this uses — but `apps/api` targets
 * ES2022, where it does not exist. (It used to surface only in the BUILD task: the type-check
 * config sat at ES2023 while the build sat at ES2022, so the gate was more permissive than what
 * shipped. Both are ES2022 now.) Filtering handles a trailing slash the same way.
 */
function fileName(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1]! : path
}

/**
 * A file the tool actually READ.
 *
 * `role: 'consulted'` is the claim being made — this content entered model context. A search HIT
 * is a different claim; see {@link discoveredFileSource}.
 */
export function fileSource(input: {
  path: string
  line?: number
  /** Absent ⇒ the file name. Pass one when the caller has a better label. */
  title?: string
  status?: AgentSource['status']
}): AgentSource {
  const uri = fileUiUri(input)
  return {
    id: agentSourceId(uri, 'file-'),
    kind: 'file',
    title: input.title ?? fileName(input.path),
    uri,
    role: 'consulted',
    status: input.status ?? 'available',
  }
}

/**
 * A file a SEARCH matched but nothing read.
 *
 * Separate from {@link fileSource} on purpose, and not a parameter: the context-system document
 * rejects "treating discovery snippets as consulted evidence" outright. A grep hit proves a string
 * exists, not that the agent looked at the file — and the answer UI hides `discovered` records for
 * exactly that reason.
 */
export function discoveredFileSource(input: { path: string; line?: number }): AgentSource {
  return { ...fileSource(input), role: 'discovered' }
}

/**
 * Another session whose content informed this answer — a sub-agent's report, a history hit.
 *
 * The URI opens that session, which is the whole affordance: "where did this come from" answered
 * by putting you there, rather than by a transcript pasted into the parent's context.
 */
export function sessionSource(input: {
  sessionId: string
  title?: string
  role?: AgentSource['role']
  status?: AgentSource['status']
}): AgentSource {
  const uri = `localix://ui/work-item/chat?session=${encode(input.sessionId)}`
  return {
    id: agentSourceId(uri, 'session-'),
    kind: 'session',
    title: input.title?.trim() || input.sessionId,
    uri,
    role: input.role ?? 'consulted',
    status: input.status ?? 'available',
  }
}
