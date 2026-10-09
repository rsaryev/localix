import type { ToolErrorPayload, TextContent, ImageContent, FileContent } from '..'
import type { AgentSource } from './sources'
import type { ToolGateProvenance } from './tool-call-hooks'

export type AgentToolUpdateCallback<TDetails = unknown> = (details: Partial<TDetails>) => void

export interface AgentToolResult<TDetails = unknown> {
  content: string
  /**
   * Compact provenance for resources that informed this result. This is persisted
   * for presentation but is never replayed as model content; tools put the actual
   * evidence in `content`.
   */
  sources?: AgentSource[]
  /**
   * Optional model-facing multimodal content (images / documents) for tools that
   * load media into context (e.g. an image handled by `read`). When present, these parts are
   * sent to the model in place of the plain `content` string; `content` remains the
   * human-readable summary shown in the UI tool card and the text fallback for
   * providers (or non-vision models) that can't accept media in a tool result.
   */
  contentParts?: Array<TextContent | ImageContent | FileContent>
  details?: TDetails
  isError?: boolean
  error?: ToolErrorPayload
  /** If true, agent stops after this tool batch */
  terminate?: boolean
  /**
   * Marks this result as a SNAPSHOT of a live, mutating resource keyed by this
   * string (e.g. a preview page, a terminal screen). Only the latest result of a key is
   * valid, so at the next context checkpoint the older ones are replaced by a recovery
   * pointer in the model context (`context/checkpoint/transforms.ts`) — at a checkpoint and
   * not before, because collapsing on arrival would rewrite a message already sent.
   * Per-resource (two terminals → two keys). The persisted history is untouched. The
   * live-execution hook `afterToolCall` also reads it, to keep stale frames out of the
   * searchable context store.
   */
  supersedeKey?: string
  /**
   * Per-CALL override of the tool's static {@link AgentTool.mutates} flag, for a tool
   * whose calls are sometimes read-only. `bash` is the only one that matters: it is
   * statically `mutates: true` (it can `rm -rf`), but `rg`/`git diff`/`ls` change
   * nothing — and treating those as mutations resets the exploration-guard streak, so
   * a model that researches exclusively through the shell is never braked. A tool that
   * can classify its own call sets this; everything else leaves it undefined and keeps
   * the static flag — except that a result with `isError` counts as non-mutating no
   * matter what the static flag says, because a call that failed changed nothing. A tool
   * that DID mutate before failing (a partial write) sets `mutated: true` explicitly.
   */
  mutated?: boolean
  /**
   * Display-only permission provenance for this call. A tool that re-enters the run's
   * permission gate itself sets it, and the inner, more specific decision wins over the
   * loop-level gate's (usually default-allow, hence absent) provenance. Rides the
   * `tool_execution_end` event onto the tool item. Never sent on the model wire.
   */
  gateProvenance?: ToolGateProvenance
}
