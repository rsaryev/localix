import { z } from 'zod'

import { sendMessageRequestSchema, toolInteractSchema } from '../chat/contracts'
import {
  COMPLETION_INLINE_CONTENT_MAX,
  COMPLETION_REFERENCE_LIMIT,
  INLINE_COMPLETION_SURFACE_LIMIT,
} from '../inline-completion/contracts'
import { SECRET_VALUE_MAX_LENGTH } from '../secrets/limits'

// Client→server command protocol for the multiplexed realtime socket. Pure
// parsing/validation: maps an inbound envelope to a typed `RealtimeCommand` the
// route then dispatches. Kept apart from the socket wiring in ws.ts so the
// command surface is unit-testable in isolation.

const lspDocSchema = z.object({
  sessionId: z.string().min(1),
  file: z.string().min(1),
  content: z.string(),
})
const lspCloseSchema = z.object({ sessionId: z.string().min(1), file: z.string().min(1) })
const lspWorkspaceSymbolsSchema = z.object({ sessionId: z.string().min(1), query: z.string() })
// The `request_secret` ANSWER leg: the typed secret VALUE rides this dedicated
// command — never `interact` — so the shared respond path can never capture it.
// On a parse failure only the reason leaves this module, never the payload.
const submitSecretSchema = z.object({
  requestId: z.string().min(1),
  value: z.string().min(1).max(SECRET_VALUE_MAX_LENGTH),
})
const previewResultSchema = z.object({
  claim: z.boolean().optional(),
  release: z.boolean().optional(),
  hostId: z.string().min(1).max(100).optional(),
  commandId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  errorCode: z
    .enum([
      'not_found',
      'intercepted',
      'bad_request',
      'failed',
      'app_disconnected',
      'host_unavailable',
      'probe_not_ready',
      'timeout',
      'frame_blocked',
    ])
    .optional(),
  notEngaged: z.boolean().optional(),
})
// Reply to an awaited `mini-app.command` frame (`emitCommandWithReply`): settles the
// server-side pending promise keyed by commandId (mini-app-command-registry).
const miniAppCommandResultSchema = z.object({
  commandId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(4000).optional(),
})
const positionSchema = z.object({
  line: z.number().int().min(0),
  character: z.number().int().min(0),
})
const rangeSchema = z.object({ start: positionSchema, end: positionSchema })
const lspPositionSchema = z.object({
  sessionId: z.string().min(1),
  file: z.string().min(1),
  position: positionSchema,
})
const lspRenameSchema = lspPositionSchema.extend({ newName: z.string().min(1) })
const lspCodeActionSchema = z.object({
  sessionId: z.string().min(1),
  file: z.string().min(1),
  range: rangeSchema,
  // Scope the request by kind (`context.only`); absent → server defaults to quickfix.
  kinds: z.array(z.string().min(1)).optional(),
  // The editor's own lightbulb probe is `automatic`; absent → `invoked` (see CodeActionTrigger).
  trigger: z.enum(['invoked', 'automatic']).optional(),
})
// A code action carried back for `lsp.applyCodeAction`. `edit` (an eager, already-
// flattened WorkspaceEdit) and `data` (opaque, round-tripped on codeAction/resolve)
// are both optional — the server resolves the edit when absent.
const codeActionSchema = z.object({
  title: z.string().min(1),
  kind: z.string().optional(),
  isPreferred: z.boolean().optional(),
  edit: z
    .array(
      z.object({
        file: z.string().min(1),
        edits: z.array(z.object({ range: rangeSchema, newText: z.string() })),
      }),
    )
    .optional(),
  command: z
    .object({ command: z.string(), title: z.string(), arguments: z.array(z.unknown()).optional() })
    .optional(),
  data: z.unknown().optional(),
})
const lspApplyCodeActionSchema = z.object({
  sessionId: z.string().min(1),
  file: z.string().min(1),
  action: codeActionSchema,
})
const lspFormatSchema = z.object({
  sessionId: z.string().min(1),
  file: z.string().min(1),
  options: z.object({ tabSize: z.number().int().min(1).max(16), insertSpaces: z.boolean() }),
})
const lspInlayHintSchema = z.object({
  sessionId: z.string().min(1),
  file: z.string().min(1),
  range: rangeSchema,
})
const lspDocumentColorSchema = z.object({
  sessionId: z.string().min(1),
  file: z.string().min(1),
})
// Unified text-input completion request: ONE call carries every currently
// eligible surface; rich domain context is resolved server-side from the
// session/repo identity. Mirrors `inline-completion/contracts.ts`.
/**
 * A completion reference: identities only, bounded per field. The one field allowed to carry
 * content is a snippet's `content` attribute, capped far below a real message send.
 */
const completionReferenceSchema = z.object({
  kind: z.string().min(1).max(128),
  token: z.string().min(1).max(2048),
  label: z.string().min(1).max(512),
  uri: z.string().min(1).max(2048).optional(),
  attributes: z
    .record(
      z.string().max(64),
      z.union([z.string().max(COMPLETION_INLINE_CONTENT_MAX), z.number(), z.boolean()]),
    )
    .refine((attributes) => Object.keys(attributes).length <= 16)
    .optional(),
  origin: z.enum(['linked', 'ambient']).optional(),
})
const completionReferencesSchema = z
  .array(completionReferenceSchema)
  .max(COMPLETION_REFERENCE_LIMIT)

const inlineCompletionSchema = z.object({
  sessionId: z.string().min(1),
  references: completionReferencesSchema.optional(),
  // Core validates the surfaces it OWNS. A contributed one is namespaced (`<app>.field`) and
  // validates its own payload inside the mini app, because core cannot know its shape — all that is
  // enforced here is the bound on how much of it may arrive at once.
  surfaces: z
    .object({
      chat: z
        .object({
          draft: z.string().max(4000).default(''),
          references: completionReferencesSchema.optional(),
        })
        .optional(),
    })
    .catchall(z.unknown())
    .refine(
      (surfaces) =>
        Object.keys(surfaces).every(
          (id) => id === 'chat' || /^[a-z0-9-]+\.[a-z0-9_.-]+$/i.test(id),
        ),
      { message: 'contributed surface ids must be namespaced' },
    )
    .refine((surfaces) => Object.keys(surfaces).length <= INLINE_COMPLETION_SURFACE_LIMIT, {
      message: 'too many surfaces in one completion request',
    }),
})

// Edit prediction — an aux call proposing the SINGLE most-likely next
// line-range edit in the SAME file. The whole file text rides along; the service
// reasons around `cursorLine`.
const predictNextEditSchema = z.object({
  /** Correlation metadata required by the edit-prediction protocol. */
  requestId: z.string().min(1).max(128),
  sessionId: z.string().min(1),
  file: z.string().min(1),
  content: z.string(),
  documentVersion: z.number().int().min(0),
  documentDigest: z.string().min(8).max(256),
  contextFingerprint: z.string().min(8).max(256).optional(),
  cursorLine: z.number().int().min(1),
  // 0-based caret column — pins the caret within the line for a precise "complete
  // the line at the cursor". Optional.
  cursorColumn: z.number().int().min(0).optional(),
  language: z.string(),
  // Same-file recent edits (the "events" signal). `before` enables a before→after
  // diff; `startLine`/`endLine` (1-based inclusive) say WHERE each edit happened.
  // `before` and positions are optional because a fresh editor may have no
  // recorded before-state for a recent edit.
  recentlyEditedRanges: z
    .array(
      z.object({
        before: z.array(z.string()).optional(),
        lines: z.array(z.string()),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      }),
    )
    .default([]),
  // Client selects references only — the same shape every completion surface sends. The server
  // owns scope, provenance, resolution, sensitivity and model-visible content through Context Fabric.
  contextReferences: completionReferencesSchema.default([]),
})

// Revoke a session's "Always allow" grant. `toolName` omitted = clear the whole set.
const revokePermissionSchema = z.object({
  sessionId: z.string().min(1),
  toolName: z.string().min(1).optional(),
})

/**
 * Declare (or drop) the sessions this connection is actively RENDERING — the client half of the
 * scoped firehose (`subscribeScoped`). A subscribe/unsubscribe command PAIR carrying ids, matching
 * the generic live-stream idiom in `ext/ws-frame-registry.ts` rather than a bespoke "here is my
 * whole set" replace: a delta is what the client actually produces (one surface mounts, another
 * unmounts) and it composes when several surfaces watch the same session.
 *
 * `max` bounds a malicious/buggy client, not real usage: the ids come from mounted chat surfaces,
 * of which there are single digits.
 */
const WATCH_SESSIONS_PER_COMMAND = 64
const watchSessionsSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1).max(WATCH_SESSIONS_PER_COMMAND),
})

export type LspPosition = z.infer<typeof lspPositionSchema>['position']
export type LspRange = z.infer<typeof rangeSchema>
export type LspCodeActionPayload = z.infer<typeof codeActionSchema>
export type LspFormattingOptions = z.infer<typeof lspFormatSchema>['options']
export type InlineCompletionPayload = z.infer<typeof inlineCompletionSchema>
export type PredictNextEditPayload = z.infer<typeof predictNextEditSchema>

export type RealtimeCommand =
  | { kind: 'send'; sessionId: string; body: z.infer<typeof sendMessageRequestSchema> }
  | { kind: 'stop'; sessionId: string }
  | { kind: 'interact'; body: z.infer<typeof toolInteractSchema> }
  | { kind: 'submit-secret'; body: z.infer<typeof submitSecretSchema> }
  | { kind: 'preview-result'; body: z.infer<typeof previewResultSchema> }
  | { kind: 'mini-app-command-result'; body: z.infer<typeof miniAppCommandResultSchema> }
  | { kind: 'lsp.open'; sessionId: string; file: string; content: string }
  | { kind: 'lsp.change'; sessionId: string; file: string; content: string }
  | { kind: 'lsp.close'; sessionId: string; file: string }
  | { kind: 'lsp.save'; sessionId: string; file: string }
  | { kind: 'lsp.hover'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.completion'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.definition'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.implementation'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.typeDefinition'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.references'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.documentHighlight'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.signatureHelp'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.inlayHint'; sessionId: string; file: string; range: LspRange }
  | { kind: 'lsp.documentColor'; sessionId: string; file: string }
  | { kind: 'lsp.prepareRename'; sessionId: string; file: string; position: LspPosition }
  | { kind: 'lsp.rename'; sessionId: string; file: string; position: LspPosition; newName: string }
  | { kind: 'lsp.formatDocument'; sessionId: string; file: string; options: LspFormattingOptions }
  | {
      kind: 'lsp.codeAction'
      sessionId: string
      file: string
      range: LspRange
      kinds?: string[]
      trigger?: 'invoked' | 'automatic'
    }
  | { kind: 'lsp.applyCodeAction'; sessionId: string; file: string; action: LspCodeActionPayload }
  | { kind: 'lsp.documentSymbols'; sessionId: string; file: string }
  | { kind: 'lsp.workspaceSymbols'; sessionId: string; query: string }
  | { kind: 'inline.complete'; payload: InlineCompletionPayload }
  | { kind: 'predictNextEdit'; payload: PredictNextEditPayload }
  | { kind: 'cancel'; requestId: string }
  | { kind: 'session.revoke-permission'; sessionId: string; toolName?: string }
  | { kind: 'session.watch'; sessionIds: string[] }
  | { kind: 'session.unwatch'; sessionIds: string[] }
  // Generic passthrough: any command not matched above. Carries the raw envelope so
  // ws.ts can consult the WS-frame registry (a registry-contributed live stream)
  // before logging it as truly unknown. `data` = the full parsed `{id, t, …}` object.
  | { kind: 'unknown'; t: string | undefined; data: Record<string, unknown> }
  | { kind: 'invalid'; reason: 'bad_request_id' | 'bad_payload' }

export function parseRealtimeCommand(msg: unknown): RealtimeCommand {
  const envelope = z
    .object({ id: z.string().min(1), t: z.string().optional() })
    .passthrough()
    .safeParse(msg)
  if (!envelope.success) return { kind: 'invalid', reason: 'bad_request_id' }

  if (envelope.data.t === 'send') {
    const parsedParams = z.object({ sessionId: z.string().min(1) }).safeParse(envelope.data)
    const parsedBody = sendMessageRequestSchema.safeParse(envelope.data)
    if (!parsedParams.success || !parsedBody.success)
      return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'send', sessionId: parsedParams.data.sessionId, body: parsedBody.data }
  }

  if (envelope.data.t === 'interact') {
    const parsed = toolInteractSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'interact', body: parsed.data }
  }

  if (envelope.data.t === 'submit-secret') {
    const parsed = submitSecretSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'submit-secret', body: parsed.data }
  }

  if (envelope.data.t === 'preview-result') {
    const parsed = previewResultSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'preview-result', body: parsed.data }
  }

  if (envelope.data.t === 'mini-app-command-result') {
    const parsed = miniAppCommandResultSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'mini-app-command-result', body: parsed.data }
  }

  if (envelope.data.t === 'stop') {
    const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'stop', sessionId: parsed.data.sessionId }
  }

  if (envelope.data.t === 'lsp.open' || envelope.data.t === 'lsp.change') {
    const parsed = lspDocSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: envelope.data.t,
      sessionId: parsed.data.sessionId,
      file: parsed.data.file,
      content: parsed.data.content,
    }
  }

  if (envelope.data.t === 'lsp.close' || envelope.data.t === 'lsp.save') {
    const parsed = lspCloseSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: envelope.data.t, sessionId: parsed.data.sessionId, file: parsed.data.file }
  }

  if (envelope.data.t === 'lsp.documentSymbols') {
    const parsed = lspCloseSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'lsp.documentSymbols', sessionId: parsed.data.sessionId, file: parsed.data.file }
  }

  if (envelope.data.t === 'lsp.workspaceSymbols') {
    const parsed = lspWorkspaceSymbolsSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: 'lsp.workspaceSymbols',
      sessionId: parsed.data.sessionId,
      query: parsed.data.query,
    }
  }

  if (envelope.data.t === 'inline.complete') {
    const parsed = inlineCompletionSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'inline.complete', payload: parsed.data }
  }

  if (envelope.data.t === 'predictNextEdit') {
    const parsed = predictNextEditSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'predictNextEdit', payload: parsed.data }
  }

  if (envelope.data.t === 'cancel') {
    const requestId = typeof envelope.data.requestId === 'string' ? envelope.data.requestId : ''
    return requestId ? { kind: 'cancel', requestId } : { kind: 'invalid', reason: 'bad_payload' }
  }

  if (envelope.data.t === 'session.revoke-permission') {
    const parsed = revokePermissionSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: 'session.revoke-permission',
      sessionId: parsed.data.sessionId,
      toolName: parsed.data.toolName,
    }
  }

  if (envelope.data.t === 'session.watch' || envelope.data.t === 'session.unwatch') {
    const parsed = watchSessionsSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: envelope.data.t, sessionIds: parsed.data.sessionIds }
  }

  if (envelope.data.t === 'lsp.rename') {
    const parsed = lspRenameSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: 'lsp.rename',
      sessionId: parsed.data.sessionId,
      file: parsed.data.file,
      position: parsed.data.position,
      newName: parsed.data.newName,
    }
  }

  if (envelope.data.t === 'lsp.formatDocument') {
    const parsed = lspFormatSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: 'lsp.formatDocument',
      sessionId: parsed.data.sessionId,
      file: parsed.data.file,
      options: parsed.data.options,
    }
  }

  if (envelope.data.t === 'lsp.documentColor') {
    const parsed = lspDocumentColorSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return { kind: 'lsp.documentColor', sessionId: parsed.data.sessionId, file: parsed.data.file }
  }
  if (envelope.data.t === 'lsp.inlayHint') {
    const parsed = lspInlayHintSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: 'lsp.inlayHint',
      sessionId: parsed.data.sessionId,
      file: parsed.data.file,
      range: parsed.data.range,
    }
  }

  if (envelope.data.t === 'lsp.codeAction') {
    const parsed = lspCodeActionSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: 'lsp.codeAction',
      sessionId: parsed.data.sessionId,
      file: parsed.data.file,
      range: parsed.data.range,
      kinds: parsed.data.kinds,
      trigger: parsed.data.trigger,
    }
  }

  if (envelope.data.t === 'lsp.applyCodeAction') {
    const parsed = lspApplyCodeActionSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: 'lsp.applyCodeAction',
      sessionId: parsed.data.sessionId,
      file: parsed.data.file,
      action: parsed.data.action,
    }
  }

  if (
    envelope.data.t === 'lsp.hover' ||
    envelope.data.t === 'lsp.completion' ||
    envelope.data.t === 'lsp.definition' ||
    envelope.data.t === 'lsp.implementation' ||
    envelope.data.t === 'lsp.typeDefinition' ||
    envelope.data.t === 'lsp.references' ||
    envelope.data.t === 'lsp.documentHighlight' ||
    envelope.data.t === 'lsp.signatureHelp' ||
    envelope.data.t === 'lsp.prepareRename'
  ) {
    const parsed = lspPositionSchema.safeParse(envelope.data)
    if (!parsed.success) return { kind: 'invalid', reason: 'bad_payload' }
    return {
      kind: envelope.data.t,
      sessionId: parsed.data.sessionId,
      file: parsed.data.file,
      position: parsed.data.position,
    }
  }

  return { kind: 'unknown', t: envelope.data.t, data: envelope.data as Record<string, unknown> }
}
