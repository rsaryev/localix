/**
 * WHAT IS WAITING ON THE PERSON — the vocabulary every "your turn" kind shares.
 *
 * Three things wait on the person: a blocking interaction (a permission card, an `ask`), a
 * participant addressing them by name, and a plan presented for review. Each used to be announced
 * by its own producer in its own shape — the journal had a row builder per kind, a sidebar mark
 * per kind, and a reload restored only the ones
 * whose session happened to be loaded. So there is ONE item shape and ONE registry
 * (`registry.ts`): every source raises and settles through it, and the snapshot frame, the
 * `GET /rpc/attention` read and the journal rows are all derived from what it holds.
 *
 * An item's `key` is its identity and is the journal row's key too, which is what kept the rows
 * written before the registry existed (and the boot sweep's prefixes) meaning the same thing.
 */
import type { SettleReason } from '../notifications/contracts'

export const ATTENTION_KINDS = ['interaction', 'mention', 'plan'] as const
export type AttentionKind = (typeof ATTENTION_KINDS)[number]

export interface AttentionSubject {
  requestId?: string
  messageId?: string
  planId?: string
  version?: number
  agentHandle?: string
}

export interface AttentionItem {
  /** `hitl:<requestId>` | `mention:<sessionId>:<messageId>` | `plan:<rootSessionId>:<planId>` */
  key: string
  kind: AttentionKind
  /** The session the person must open — where the prompt is rendered and answered. */
  sessionId: string
  /** ISO time it started waiting. */
  at: string
  title: string
  /** The question, the plan's opening lines, the mention's text. */
  summary?: string
  subject: AttentionSubject
  /**
   * Kind `interaction` only: the payload `hitl.requested` carries (`messageId`, `toolCallId`,
   * `toolName`, `request`), so a client can answer it without loading the session.
   */
  interaction?: unknown
}

/** Why an item stopped waiting — the journal row's settle reason. */
export type AttentionSettleReason = Extract<
  SettleReason,
  'answered' | 'dismissed' | 'expired' | 'cancelled' | 'superseded' | 'restart'
>

/** One item, or every item under a prefix (a conversation's mentions, a plan's versions). */
export type AttentionTarget = { key: string } | { prefix: string }

export const hitlAttentionKey = (requestId: string) => `hitl:${requestId}`
export const HITL_ATTENTION_PREFIX = 'hitl:'
/** Session first, so every mention in a conversation settles as one prefix. */
export const mentionAttentionPrefix = (sessionId: string) =>
  `mention:${encodeURIComponent(sessionId)}:`
export const mentionAttentionKey = (sessionId: string, messageId: string) =>
  `${mentionAttentionPrefix(sessionId)}${messageId}`
/** Root first, so a newer version settles every older one of the conversation as one prefix. */
export const planAttentionPrefix = (rootSessionId: string) => `plan:${rootSessionId}:`
export const planAttentionKey = (rootSessionId: string, planId: string) =>
  `${planAttentionPrefix(rootSessionId)}${planId}`

export const matchesTarget = (key: string, target: AttentionTarget): boolean =>
  'key' in target ? key === target.key : key.startsWith(target.prefix)
