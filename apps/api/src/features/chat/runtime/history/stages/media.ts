/**
 * MEDIA: turn persisted rows into model payloads, with everything the wire needs and nothing
 * the database keeps for the UI.
 *
 * This is the one stage that changes the list's TYPE (`PersistedMessage` → payload), so it
 * is the seam between the two pipelines rather than a stage inside one. Four transforms,
 * all wire-only — the stored row is never touched (four plus the tool-image pass):
 *
 *   - a STEERED user message that was never answered inline gets a causality note, so a later
 *     run does not answer it a second time;
 *   - an invocation's instruction becomes a text asset on its own message, on every turn;
 *   - file-backed media is rehydrated only when the wire actually carries the bytes, and large
 *     non-image attachments are spilled to the session cwd as a manifest + head preview;
 *   - images a TOOL returned get their bytes back when the model reads images (`tool-images.ts`);
 *   - large images are downscaled once per run.
 *
 * Bounded fan-out: rehydration and spill touch disk per message, and a long session must not
 * open a file per row at once.
 */
import { assetBindings } from '@localixai/agent'
import { isWireCarriableImage } from '@localixai/agent/agents'

import type { PersistedMessage } from '../../../contracts'
import type { StoredMessagePayload } from '../../../../../db/payload'
import { USER_PARTICIPANT } from '../../../../../db/participant'
import type { MediaStore } from '../../../../media/store'
import { rehydrateMediaAttachments } from '../../../../media/attachments'
import type { DocumentTextExtractor } from '../../../../agent-core/tools/file/document-ports'
import { mapLimit } from '../../../../../lib/map-limit'
import { contextBindingsToModelAssets } from '../../../model-assets'
import { invocationModelText } from '../../context-token-estimate'
import { downscaleRunImages } from '../../run/image-downscale'
import { spillMessageAttachments } from '../../run/attachment-spill'
import { rehydrateToolImages } from './tool-images'

/** Bound per-message media rehydration/spill fan-out across a long session. */
export const MEDIA_CONCURRENCY = 4

export interface MediaStageDeps {
  mediaStore?: MediaStore
  defaultCwd?: string
  extractDocument?: DocumentTextExtractor
  /** Does this request's model read images? Gates the tool images carried on the wire. */
  acceptsImages?: boolean
  /** Results the checkpoint in force collapsed — see `tool-images.ts`. */
  collapsedToolResult?: (messageId: string, toolCallId: string) => boolean
}

/** Where the active invocation sits: an explicit trigger id, else the last real user row. */
export function findActiveInvocationIndex(
  messages: readonly PersistedMessage[],
  activeInvocationId: string | undefined,
): number {
  if (activeInvocationId !== undefined) {
    return messages.findIndex((message) => message.id === activeInvocationId)
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (
      message?.payload.from === USER_PARTICIPANT &&
      message.payload.role === 'user' &&
      !message.payload.uiOnly &&
      !message.payload.isInternal
    )
      return i
  }
  return -1
}

export async function toModelPayloads(
  messages: readonly PersistedMessage[],
  deps: MediaStageDeps,
): Promise<StoredMessagePayload[]> {
  const { mediaStore, defaultCwd, extractDocument } = deps
  // A correctly-split steer is FOLLOWED by an assistant row; a trailing one is not.
  const answeredInline = (idx: number): boolean => messages[idx + 1]?.payload.role === 'assistant'

  const rehydrated = await mapLimit(
    messages.map((message, idx) => ({ message, idx })),
    MEDIA_CONCURRENCY,
    async ({ message, idx }) => {
      if (
        message.payload.origin === 'user-steer' &&
        message.payload.role === 'user' &&
        !answeredInline(idx)
      ) {
        const base = message.payload.content ?? ''
        const contextAssets = contextBindingsToModelAssets(message.payload.bindings)
        const assets = [...assetBindings(message.payload.bindings), ...contextAssets]
        return {
          ...message.payload,
          content: `${base}

[Note: this message was delivered MID-RUN — the assistant response above already saw it and reacted to it in its later turns. Do not answer it again.]`,
          ...(assets.length > 0 ? { bindings: assets } : {}),
        }
      }
      const contextAssets = contextBindingsToModelAssets(message.payload.bindings)
      // On EVERY turn, not only the one the invocation started: an instruction the model was
      // sent and then stops seeing is an edit of history it already read (prefix cache,
      // preserved thinking). It leaves the view the way any turn does — at a checkpoint.
      const invocationAssets = (message.payload.bindings ?? []).flatMap((binding) => {
        if (binding.kind !== 'invocation') return []
        const text = invocationModelText(binding)
        if (!text) return []
        return [
          {
            kind: 'text' as const,
            name: binding.presentation.token ?? binding.presentation.label,
            text,
            size: Buffer.byteLength(text, 'utf8'),
            contextRef: true,
          },
        ]
      })
      const assets = [
        ...assetBindings(message.payload.bindings),
        ...contextAssets,
        ...invocationAssets,
      ]
      if (assets.length === 0) return message.payload
      const reh = await rehydrateMediaAttachments(mediaStore, assets, {
        shouldRehydrate: (att) =>
          !defaultCwd || (att.kind === 'image' && isWireCarriableImage(att.mediaType)),
      })
      const next = await spillMessageAttachments(reh, {
        defaultCwd,
        sessionId: message.sessionId,
        messageId: message.id,
        mediaStore,
        extractDocument,
      })
      return { ...message.payload, bindings: next }
    },
  )
  const withToolImages = await rehydrateToolImages(rehydrated, {
    mediaStore,
    acceptsImages: deps.acceptsImages ?? false,
    ...(deps.collapsedToolResult ? { collapsed: deps.collapsedToolResult } : {}),
  })
  return downscaleRunImages(withToolImages)
}
