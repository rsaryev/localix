import type { McpClientLike } from './mcp-client-contracts'

/**
 * CLAUDE CODE CHANNEL PERMISSION RELAY. A channel server that declares
 * `capabilities.experimental['claude/channel/permission']` (an object; `false` or absent opts out)
 * receives each tool approval prompt opened in the chat it speaks into, as
 * `notifications/claude/channel/permission_request` `{ request_id, tool_name, description,
 * input_preview }`, and answers with `notifications/claude/channel/permission`
 * `{ request_id, behavior: 'allow' | 'deny' }`.
 *
 * The card in Localix stays open throughout: whichever answer arrives first applies, and the
 * other is dropped — a local answer closes the remote request, and a verdict whose id is not open
 * (or was not sent to that server) is ignored without a reply. A verdict approves this one call;
 * it never widens into a session or saved grant.
 */

export const PERMISSION_CAPABILITY = 'claude/channel/permission'
export const PERMISSION_REQUEST = 'notifications/claude/channel/permission_request'
export const PERMISSION_VERDICT = 'notifications/claude/channel/permission'

/** Five letters from `a`–`z` without `l`, so an id typed on a phone never reads as `1` or `I`. */
const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz'
const ID_LENGTH = 5
/** Claude Code relays each text whole up to this many code points. */
export const RELAY_MAX_CODE_POINTS = 3500

/** Whether a server declared the relay: an object, never `false`. */
export function declaresPermissionRelay(client: McpClientLike): boolean {
  const value = client.getServerCapabilities?.()?.experimental?.[PERMISSION_CAPABILITY]
  return typeof value === 'object' && value !== null
}

export function permissionRequestId(random: () => number = Math.random): string {
  let id = ''
  for (let i = 0; i < ID_LENGTH; i++)
    id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % ID_ALPHABET.length]
  return id
}

// Direction overrides and isolates, zero-width and other invisible characters, controls.
// oxlint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g
const LOOKALIKES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '‹': '<',
  '›': '>',
  '〈': '<',
  '〉': '>',
  '⟨': '<',
  '⟩': '>',
  '＜': '<',
  '＞': '>',
  '«': '<',
  '»': '>',
}

/**
 * Text as Claude Code relays it: invisible and direction characters neutralized, quote and
 * angle-bracket lookalikes made plain, whitespace folded, and a long value cut to its start and
 * its end around a counted marker, so the end of a long command still reaches the approver.
 */
export function relayText(value: string): string {
  const folded = value
    .replace(INVISIBLE, ' ')
    .replace(/[‘’‚‛“”„‟‹›〈〉⟨⟩＜＞«»]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim()
  // Code points are the unit the budget counts, so a surrogate pair is one point.
  // oxlint-disable-next-line typescript/no-misused-spread -- splitting by code point is the intent
  const points = [...folded]
  if (points.length <= RELAY_MAX_CODE_POINTS) return folded
  const head = Math.floor(RELAY_MAX_CODE_POINTS / 2)
  const tail = RELAY_MAX_CODE_POINTS - head
  const elided = points.length - RELAY_MAX_CODE_POINTS
  return `${points.slice(0, head).join('')} ⋯ ${elided} code points elided ⋯ ${points.slice(-tail).join('')}`
}

/** The tool's arguments as JSON-shaped display text, each top-level field relayed separately. */
export function relayInputPreview(input: Readonly<Record<string, unknown>>): string {
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    try {
      fields[relayText(key)] =
        typeof value === 'string' ? relayText(value) : JSON.parse(JSON.stringify(value))
    } catch {
      fields[relayText(key)] = '(value unserializable)'
    }
  }
  return JSON.stringify(fields)
}

/** An approval prompt as the relay sends it. */
export interface PermissionPrompt {
  userId: string
  /** The chat the card is shown in. */
  sessionId: string
  /** The host's own request id — what an answer settles. */
  hostRequestId: string
  toolName: string
  /** A summary of the call, never the command itself. */
  description: string
  input: Readonly<Record<string, unknown>>
}

/** Settle the host's request; false when it is no longer open. */
export type PermissionAnswerer = (answer: {
  userId: string
  hostRequestId: string
  allow: boolean
}) => boolean | void

export interface PermissionRelay {
  /** A card opened: send it to every relay-capable channel `channelsFor` names. */
  open(prompt: PermissionPrompt): void
  /** The card closed (answered here, dismissed, expired): its remote request is dropped. */
  close(hostRequestId: string): void
  /** A channel's verdict; ignored unless its id is open and was sent to that channel. */
  verdict(channelKey: string, params: unknown): void
  /** Set once by the composition root. */
  answerWith(answerer: PermissionAnswerer | undefined): void
}

interface OpenRequest {
  userId: string
  hostRequestId: string
  sentTo: Set<string>
}

export function createPermissionRelay(deps: {
  /** The relay-capable channels speaking into a chat: their keys and clients. */
  channelsFor: (userId: string, sessionId: string) => Array<{ key: string; client: McpClientLike }>
  random?: () => number
  logger?: { warn(msg: string, meta?: unknown): void }
}): PermissionRelay {
  const open = new Map<string, OpenRequest>()
  const byHost = new Map<string, string>()
  let answerer: PermissionAnswerer | undefined

  const freshId = (): string => {
    for (;;) {
      const id = permissionRequestId(deps.random)
      if (!open.has(id)) return id
    }
  }

  return {
    open(prompt) {
      const channels = deps.channelsFor(prompt.userId, prompt.sessionId)
      if (channels.length === 0 || byHost.has(prompt.hostRequestId)) return
      const requestId = freshId()
      const params = {
        request_id: requestId,
        tool_name: relayText(prompt.toolName),
        description: relayText(prompt.description),
        input_preview: relayInputPreview(prompt.input),
      }
      const sentTo = new Set<string>()
      for (const { key, client } of channels) {
        if (!client.notification) continue
        sentTo.add(key)
        void client.notification({ method: PERMISSION_REQUEST, params }).catch((err: unknown) => {
          deps.logger?.warn('MCP channel could not receive a permission request', {
            error: String(err),
          })
        })
      }
      if (sentTo.size === 0) return
      open.set(requestId, { userId: prompt.userId, hostRequestId: prompt.hostRequestId, sentTo })
      byHost.set(prompt.hostRequestId, requestId)
    },
    close(hostRequestId) {
      const requestId = byHost.get(hostRequestId)
      if (requestId === undefined) return
      byHost.delete(hostRequestId)
      open.delete(requestId)
    },
    verdict(channelKey, params) {
      const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
      const requestId = typeof record.request_id === 'string' ? record.request_id : ''
      const behavior = record.behavior
      if (behavior !== 'allow' && behavior !== 'deny') return
      const request = open.get(requestId)
      if (!request || !request.sentTo.has(channelKey)) return
      open.delete(requestId)
      byHost.delete(request.hostRequestId)
      answerer?.({
        userId: request.userId,
        hostRequestId: request.hostRequestId,
        allow: behavior === 'allow',
      })
    },
    answerWith(next) {
      answerer = next
    },
  }
}
