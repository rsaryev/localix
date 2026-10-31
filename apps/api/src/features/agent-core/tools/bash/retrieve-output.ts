import {
  isToolBackedItem,
  type AgentToolResult,
  type ToolBackedItem,
} from '@localixai/agent/agents'
import { heavyMutateInputs } from '@localixai/agent'
import type { ChatRepository } from '../../../chat/repository'
import type { ContextStore, ToolOutputArtifact } from '../../../context-store/repository'

/** Cap the returned text so a huge original can't blow the context back up. */
const MAX_OUTPUT_CHARS = 100_000

type RetrieveOutputRepo = Pick<ChatRepository, 'findActiveBranchToolCallMessage'>
type RetrieveOutputArtifactStore = Pick<ContextStore, 'getToolOutputArtifact'>

function richestToolBackedOutput(backed: ToolBackedItem): { toolName: string; text: string } {
  // Return the RICHEST stored copy: content-aware filters (test-runner
  // summaries etc.) shrink `resultText` at the tool layer, but the raw
  // output survives on the item — a command item's `output` string
  // (100KB-capped), or a generic tool item's details `output` field.
  const rich = 'output' in backed ? backed.output : undefined
  const rawCopy =
    typeof rich === 'string'
      ? rich
      : typeof (rich as { output?: unknown } | undefined)?.output === 'string'
        ? (rich as { output: string }).output
        : ''
  const resultText = backed.resultText ?? ''
  let text = rawCopy.length > resultText.length ? rawCopy : resultText
  // A mutating call's OUTPUT is a one-line summary ("Wrote 9160 bytes to …"),
  // while the thing compression elided is its heavy INPUT (`content` / `patch`).
  const heavies = heavyMutateInputs(backed)
  if (heavies.length) {
    const args = heavies
      .map((h) => `[original \`${h.field}\` argument of ${backed.name}]\n${h.text}`)
      .join('\n\n')
    text = text ? `${args}\n\n[its result was: ${text}]` : args
  }
  return { toolName: backed.name, text }
}

function artifactOutput(artifact: ToolOutputArtifact): { toolName: string; text: string } {
  return richestToolBackedOutput({
    id: artifact.toolCallId,
    toolCallId: artifact.toolCallId,
    name: artifact.toolName,
    type: 'tool_call',
    activeVerb: artifact.toolName,
    status: artifact.isError ? 'failed' : 'completed',
    input: artifact.input,
    resultText: artifact.text,
  })
}

/**
 * Resolve the richest stored text of one tool call from a session's messages —
 * the shared lookup behind `ToolOutput` action="get" (serves it back) and
 * action="search" lazy indexing (chunks it on first search). Null when the id
 * doesn't exist; text may still be '' for a call that stored nothing.
 */
export function storedToolCallOutput(
  messages: Awaited<ReturnType<ChatRepository['listMessages']>>,
  wanted: string,
): { toolName: string; text: string } | null {
  for (const message of messages) {
    for (const item of message.payload.items ?? []) {
      if (isToolBackedItem(item) && item.toolCallId === wanted) {
        return richestToolBackedOutput(item as ToolBackedItem)
      }
    }
  }
  return null
}

/**
 * Exact-output leg of the consolidated `ToolOutput` model tool. Kept as a narrow
 * function because context search also uses the same durable artifact/history sources
 * for lazy indexing; the model-facing schema lives in context-search.ts.
 *
 * It reverses the context-compression layers on demand. When an old tool result is
 * crushed/truncated in the wire to save context (the `CRUSH_MARKER` / `ELISION_MARKER`
 * phrases, carrying the originating `tool_call_id`), the FULL
 * original is still persisted in the session history — only the model-facing wire
 * copy was shrunk. This tool fetches that original back by `tool_call_id`, so the
 * agent can recover a dropped detail (a specific row, a middle log line) instead of
 * re-running the command. For a MUTATING call the elided payload is its heavy INPUT
 * (`content` / `patch`), not its one-line result — so those args are served back too,
 * or the elision pointer would promise a recovery this tool cannot perform.
 * This is what makes aggressive compression safe (headroom's
 * compress-cache-retrieve idea, but the "cache" is just our durable message store).
 */
export async function retrieveStoredOutput(
  repo: RetrieveOutputRepo,
  userId: string,
  sessionId: string,
  wanted: string,
  artifactStore?: RetrieveOutputArtifactStore,
): Promise<AgentToolResult> {
  let artifactError: unknown
  if (artifactStore) {
    try {
      const artifact = await artifactStore.getToolOutputArtifact(userId, sessionId, wanted)
      if (artifact) return outputResult(artifactOutput(artifact), wanted)
    } catch (error) {
      // Backward-compatible message history remains an independent recovery
      // source; use it when the artifact table is temporarily unavailable.
      artifactError = error
    }
  }
  let message
  try {
    message = await repo.findActiveBranchToolCallMessage(userId, sessionId, wanted)
  } catch (error) {
    const artifactMessage =
      artifactError instanceof Error
        ? `; artifact lookup also failed: ${artifactError.message}`
        : ''
    return {
      content:
        `Could not load session history: ${error instanceof Error ? error.message : 'unknown error'}` +
        artifactMessage,
      isError: true,
    }
  }
  const stored = message ? storedToolCallOutput([message], wanted) : null
  if (!stored) {
    return {
      content: `No tool call with id "${wanted}" found in this session's history.`,
      isError: true,
    }
  }
  return outputResult(stored, wanted)
}

function outputResult(
  stored: { toolName: string; text: string },
  wanted: string,
): { content: string; isError?: boolean } {
  const text = stored.text
  if (!text) return { content: `Tool call ${wanted} has no stored output.`, isError: true }
  const clipped = text.length > MAX_OUTPUT_CHARS
  return {
    content: clipped
      ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[retrieved output clipped at ${MAX_OUTPUT_CHARS} chars]`
      : text,
  }
}
