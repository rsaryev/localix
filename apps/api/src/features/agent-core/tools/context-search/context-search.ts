import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'

import type { ChatRepository } from '../../../chat/repository'
import type { ContextChunkHit, ContextStore } from '../../../context-store/repository'
import { isIndexSkippedTool, MAX_CHUNKS_PER_SESSION } from '../../context-index-policy'
import { toFtsMatchQuery } from '../history/history-search-format'
import { retrieveStoredOutput, storedToolCallOutput } from '../bash/retrieve-output'

/**
 * Chunk-level search over this session's LARGE tool outputs — the query half of
 * context externalization, paired with action="get" (exact bytes back by id) as
 * action="search" for "find the sections that answer X". Results come from the FTS index the
 * externalization hook fills (features/context-store); a `tool_call_id` whose
 * output was never indexed (pre-feature messages, a masked result's pointer) is
 * indexed LAZILY from the durable store on first search, so every pointer that
 * names this tool stays truthful.
 */

const TOOL_OUTPUT_ACTIONS = ['search', 'get'] as const
export type ToolOutputAction = (typeof TOOL_OUTPUT_ACTIONS)[number]
interface ToolOutputInput {
  action: ToolOutputAction
  queries?: string[]
  tool_call_id?: string
}

function buildToolOutputInputSchema(
  allowedActions: readonly ToolOutputAction[],
): z.ZodType<ToolOutputInput> {
  const shape: Record<string, z.ZodType> = {
    action: z.enum(allowedActions as [ToolOutputAction, ...ToolOutputAction[]]),
    tool_call_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        allowedActions.includes('search')
          ? 'The earlier call: required for get, optional scope for search.'
          : 'Required: the earlier tool call whose complete output to return.',
      ),
  }
  if (allowedActions.includes('search')) {
    shape.queries = z
      .array(z.string().min(1))
      .min(1)
      .max(5)
      .optional()
      .describe('search: phrases of 2-4 keywords, batched in one call.')
  }
  return z.object(shape) as unknown as z.ZodType<ToolOutputInput>
}

/** Hard cap on the response so search can never re-inflate what it exists to shrink. */
const MAX_RESPONSE_BYTES = 40_000
const HITS_PER_QUERY = 6

type ToolOutputRepo = Pick<ChatRepository, 'findActiveBranchToolCallMessage'>

const utf8 = new TextEncoder()

export function createToolOutputTool(
  store: ContextStore,
  repo: ToolOutputRepo,
  userId: string,
  sessionId: string,
  allowedActions: readonly ToolOutputAction[] = TOOL_OUTPUT_ACTIONS,
) {
  const inputSchema = buildToolOutputInputSchema(allowedActions)
  return defineAgentTool({
    name: TOOL.ToolOutput,
    label: 'Tool output',
    activeVerb: 'Inspecting output',
    description: [
      'Inspect your own stored outputs from earlier tool calls in this session.',
      ...(allowedActions.includes('search')
        ? ['search returns only the matching sections of large results.']
        : []),
      ...(allowedActions.includes('get')
        ? [
            'get returns the full original output, only when it is needed after being filtered, truncated or elided.',
          ]
        : []),
      ...(allowedActions.includes('search') && allowedActions.includes('get')
        ? ['Prefer search for a detail: a full replay stays in context.']
        : []),
    ].join(' '),
    inputSchema,
    permissionResources: (input) => [inputSchema.parse(input).action],
    // Both actions only re-read this session's OWN stored tool output. `action="search"` can
    // lazily fill the FTS index for a call that was never indexed, but that writes a derived
    // index of bytes already in the session — no file, process, or user data changes, and
    // gating it would make recovering an elided result need approval.
    mutates: false,
    // Read-only FTS lookup — safe to run alongside other reads.
    executionMode: 'parallel',
    async execute(_toolCallId, input) {
      if (input.action === 'get') {
        if (!input.tool_call_id) {
          return {
            content: 'action="get" requires tool_call_id.',
            isError: true,
          }
        }
        return retrieveStoredOutput(repo, userId, sessionId, input.tool_call_id, store)
      }

      if (!input.queries?.length) {
        return {
          content: 'action="search" requires a non-empty queries array.',
          isError: true,
        }
      }
      const wanted = input.tool_call_id
      try {
        // Lazy self-heal: a scoped search over an un-indexed call indexes it from
        // the durable store first, so pointers minted before indexing (or by a
        // checkpoint's masked result) never dead-end.
        if (wanted && !(await store.hasChunks(userId, sessionId, wanted))) {
          const artifact = await store.getToolOutputArtifact(userId, sessionId, wanted)
          const message = artifact
            ? null
            : await repo.findActiveBranchToolCallMessage(userId, sessionId, wanted)
          const stored = artifact ?? (message ? storedToolCallOutput([message], wanted) : null)
          if (!stored) {
            return {
              content: `No tool call with id "${wanted}" found in this session's history.`,
              isError: true,
            }
          }
          // The self-heal is the LAST gate on what enters the index, so the skip policy has
          // to hold here too — "not indexed" is that policy's outcome for these tools, not a
          // gap to repair. Indexing on demand would let one stale pointer file a search
          // result, which is the echo the policy exists to prevent.
          if (isIndexSkippedTool(stored.toolName)) {
            return {
              content:
                `The ${stored.toolName} output "${wanted}" is not indexed for search, and will not be: ` +
                'search and recovery results are kept out of the index so their hits cannot echo. ' +
                `Read it in full with ToolOutput(action="get", tool_call_id="${wanted}"), or search the ` +
                'original tool call whose output it reports on.',
              isError: true,
            }
          }
          await store.indexToolOutput({
            userId,
            sessionId,
            toolCallId: wanted,
            toolName: stored.toolName,
            text: stored.text,
          })
        }

        // The session cap evicts oldest-first across the whole session, so an older output
        // can be left holding only its tail. `hasChunks` above stays true for it, meaning the
        // self-heal does not fire and the search silently covers a prefix-shorn output —
        // "nothing matched" would then be a claim about text this index no longer holds.
        //
        // The unscoped search — the DEFAULT, since tool_call_id is optional — has the same
        // exposure and cannot name a single culprit, so it asks the session-level question
        // instead: a saturated index has already discarded its oldest sections.
        const headEvicted = wanted ? !(await store.hasHeadChunk(userId, sessionId, wanted)) : false
        const sessionSaturated = wanted
          ? false
          : (await store.chunkCount(userId, sessionId)) >= MAX_CHUNKS_PER_SESSION

        const seen = new Set<string>()
        const hits: Array<{ query: string; hit: ContextChunkHit }> = []
        const searchable: string[] = []
        for (const query of input.queries) {
          const match = toFtsMatchQuery(query)
          if (!match) continue
          searchable.push(query)
          const rows = await store.searchChunks(userId, sessionId, match, {
            ...(wanted ? { toolCallId: wanted } : {}),
            limit: HITS_PER_QUERY,
          })
          for (const hit of rows) {
            const key = `${hit.toolCallId}#${hit.chunkIndex}`
            if (seen.has(key)) continue
            seen.add(key)
            hits.push({ query, hit })
          }
        }
        if (searchable.length === 0) {
          return { content: 'No searchable terms in queries.', isError: true }
        }
        const partialNote = headEvicted
          ? `\n\n[partial index: earlier sections of ${wanted} were evicted by the session cap, so this` +
            ' search covered only the later ones — ToolOutput(action="get", tool_call_id) still has the full text]'
          : sessionSaturated
            ? '\n\n[partial index: this session filled its section cap, so the oldest indexed sections' +
              ' have been evicted — scope with tool_call_id to re-index one output, or use' +
              ' ToolOutput(action="get", tool_call_id) for its full text]'
            : ''
        if (hits.length === 0) {
          return {
            content:
              `No indexed sections match ${searchable.map((q) => `"${q}"`).join(', ')}` +
              (wanted ? ` in tool call ${wanted}.` : ' in this session.') +
              ' Try different keywords, or ToolOutput(action="get", tool_call_id) for the full text.' +
              partialNote,
          }
        }

        // Emit full sections until the byte budget runs out — a section is the
        // useful unit; a budget-buster tail is summarized as a count.
        const blocks: string[] = []
        let bytes = 0
        let emitted = 0
        for (const { query, hit } of hits) {
          const block =
            `── ${hit.toolName} tool_call_id="${hit.toolCallId}" section ${hit.chunkIndex}` +
            ` (matched "${query}")\n${hit.content}`
          const blockBytes = utf8.encode(block).length + 2
          if (emitted > 0 && bytes + blockBytes > MAX_RESPONSE_BYTES) break
          blocks.push(block)
          bytes += blockBytes
          emitted++
        }
        const omitted = hits.length - emitted
        let content = blocks.join('\n\n')
        if (omitted > 0) {
          content += `\n\n[${omitted} more matching sections omitted for size — narrow the query or scope with tool_call_id]`
        }
        content += partialNote
        return {
          content,
          details: {
            queries: searchable,
            hits: emitted,
            omitted,
            ...(headEvicted || sessionSaturated ? { partial: true } : {}),
          },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('no such table') || message.includes('no such module')) {
          return {
            content: 'Context search is not available in this environment (FTS5 not enabled).',
            isError: true,
          }
        }
        return { content: `Context search failed: ${message}`, isError: true }
      }
    },
  })
}

/** Query half of context externalization; exposed by default but user-toggleable. */
