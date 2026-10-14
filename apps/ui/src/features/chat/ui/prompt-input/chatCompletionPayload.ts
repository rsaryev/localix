import type { CompletionReference, InlineCompletionSurfacePayloads } from '@localixai/api/client'

type ChatCompletionPayload = InlineCompletionSurfacePayloads['chat']

/**
 * Keep the composer → completion wire projection explicit and testable.
 *
 * `references` are the chips the user linked (pinned and typed); what is merely open on screen
 * rides the shared working set every surface carries. Omitting an empty array keeps the request
 * fingerprint stable and avoids a second "no context" representation.
 */
export function chatCompletionPayload(
  draft: string,
  references: readonly CompletionReference[],
): ChatCompletionPayload {
  return {
    draft,
    ...(references.length > 0 ? { references: [...references] } : {}),
  }
}
