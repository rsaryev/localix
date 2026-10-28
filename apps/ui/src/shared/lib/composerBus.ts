import type { MessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import type { MessageBinding } from '@/shared/api/contracts'
import { loadHeldInserts, saveHeldInserts } from './composerHeldStore'

/**
 * Agnostic "prefill the chat composer" bus. Any feature — code/preview review
 * comments, quote-to-reply, deep links, future surfaces — calls
 * {@link composerBus.insert} to drop text and/or bindings into the message input
 * (visible and editable; the user reviews and sends). The composer owner
 * (ChatSurface) subscribes once and applies it. One mechanism, reused everywhere —
 * no per-surface send paths.
 */
export interface ComposerInsert {
  /** Text to place in the composer. Appended to the current draft unless `replace`. */
  text?: string
  /** Assets or context links to stage. Subscribers consume only variants they own. */
  bindings?: Array<MessageBindingDraft | MessageBinding>
  /** Replace the current draft instead of appending to it. */
  replace?: boolean
  /**
   * `text` continues the sentence rather than starting a paragraph — joined to the draft with a
   * single space instead of a blank line. For tokens a person builds a message out of, such as
   * a fragment a mod fills in: several of those on their own lines are a column, not a phrase.
   */
  inline?: boolean
  /**
   * Send `text` as a chat message IMMEDIATELY instead of staging it in the input — for flows
   * that already collected the user's intent (e.g. the chart's AI-analysis wizard). Goes
   * through the composer's normal send path (a running turn queues it, bindings ride along).
   */
  submit?: boolean
  /**
   * With `submit`: send as a HIDDEN user turn (`isInternal` — the model sees it, the transcript
   * does not). For machine-composed prompts the user triggered but did not type, e.g. a contributed
   * analysis action: echoing the wall of task text into the chat adds nothing.
   */
  internal?: boolean
  /**
   * The chat whose composer receives this. Required: an insert that named none went to whichever
   * composer had focus, so a review comment made in chat A's file tab landed in chat B's draft
   * when B was the one on screen.
   */
  sessionId: string
  /**
   * When no mounted composer accepts the insert (target session not open yet —
   * e.g. a deep link that mints a fresh chat), hold it and deliver to the next
   * accepting subscriber instead of dropping it. Held inserts expire after
   * {@link BUFFER_TTL_MS} so a never-mounted target can't surprise-prefill a
   * composer minutes later.
   */
  buffer?: boolean
  /**
   * Like `buffer`, but the insert never expires: it is words the person wrote and cannot get
   * back any other way (a stopped session's queue, taken off the server). It waits for the
   * addressed composer, however long the session stays closed.
   */
  hold?: boolean
  /** Keep focus on the source surface while staging context for a later message. */
  focus?: boolean
}

/**
 * A handler returns `false` to decline an insert that isn't addressed to it
 * (session mismatch); `void`/`true` means applied. Existing void handlers keep
 * their old semantics: everything offered is considered applied.
 */
type Handler = (req: ComposerInsert) => void | boolean

/**
 * Take a staged context binding back OUT of the composer — the mirror of an insert, for a
 * surface whose observation stopped existing (a review comment deleted where it was made).
 * Without it the chip could only be removed in the composer, so deleting the comment on its
 * own page left its context still riding the next message.
 */
export interface ComposerRetract {
  /** Binding tokens to unstage. Unknown tokens are ignored. */
  tokens: readonly string[]
  /** The chat whose composer holds the bindings. */
  sessionId: string
}

type RetractHandler = (req: ComposerRetract) => void | boolean

const BUFFER_TTL_MS = 30_000

const handlers = new Set<Handler>()
const retractHandlers = new Set<RetractHandler>()
const pending: Array<{ req: ComposerInsert; expiresAt: number }> = []
const NEVER = Number.POSITIVE_INFINITY
let restored = false

/** Held inserts of a previous page life rejoin the queue, ahead of anything held since. */
function restoreHeld(): void {
  if (restored) return
  restored = true
  const entries = loadHeldInserts().map((req) => ({ req, expiresAt: NEVER }))
  pending.unshift(...entries)
}

/** Mirror the held entries to storage; called whenever one is added, delivered or retracted. */
function persistHeld(): void {
  saveHeldInserts(pending.filter((entry) => entry.expiresAt === NEVER).map((entry) => entry.req))
}

/**
 * Addressing rule shared by every composerBus subscriber: an insert reaches the composer of the
 * chat it names, even while that composer is warm-hidden — and no other. Focus plays no part.
 */
export function composerInsertMatchesSession(
  targetSessionId: string,
  composerSessionId: string | null | undefined,
): boolean {
  return targetSessionId === composerSessionId
}

function offer(handler: Handler, req: ComposerInsert): boolean {
  try {
    return handler(req) !== false
  } catch {
    /* never let one subscriber break another */
    return false
  }
}

export const composerBus = {
  /** Prefill the composer. No-op until a subscriber (the composer) is mounted. */
  insert(req: ComposerInsert): void {
    restoreHeld()
    let applied = false
    for (const h of handlers) {
      if (offer(h, req)) applied = true
    }
    if (applied) return
    if (req.hold) {
      pending.push({ req, expiresAt: NEVER })
      persistHeld()
    } else if (req.buffer) pending.push({ req, expiresAt: Date.now() + BUFFER_TTL_MS })
  },
  /** Unstage bindings by token. No-op when nothing holds them. */
  retract(req: ComposerRetract): void {
    if (req.tokens.length === 0) return
    restoreHeld()
    for (const h of retractHandlers) {
      try {
        h(req)
      } catch {
        /* never let one subscriber break another */
      }
    }
    // A buffered insert has not reached a composer yet, so its retraction has to catch it here.
    let changedHeld = false
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const bindings = pending[i]!.req.bindings ?? []
      const retracted = bindings.some(
        (binding) => binding.kind === 'context' && req.tokens.includes(binding.target.token),
      )
      if (!retracted) continue
      if (pending[i]!.expiresAt === NEVER) changedHeld = true
      pending.splice(i, 1)
    }
    if (changedHeld) persistHeld()
  },
  /** Subscribe to retractions (the composer's context-ref owner). */
  subscribeRetract(handler: RetractHandler): () => void {
    retractHandlers.add(handler)
    return () => retractHandlers.delete(handler)
  },
  /**
   * Subscribe (the composer owner). Returns an unsubscribe. Held inserts are delivered right
   * after the current task, not inside this call: a composer subscribes several handlers (text,
   * attachments, context chips) one after another, and offering the entry to the first alone
   * let it take the whole insert, leaving the others' share of it undelivered.
   */
  subscribe(handler: Handler): () => void {
    restoreHeld()
    handlers.add(handler)
    if (pending.length > 0 && !flushScheduled) {
      flushScheduled = true
      queueMicrotask(flushPending)
    }
    return () => handlers.delete(handler)
  },
}

let flushScheduled = false

/** Offer every waiting insert to every live subscriber, as `insert` does; drop the expired. */
function flushPending(): void {
  flushScheduled = false
  let changedHeld = false
  for (let i = 0; i < pending.length;) {
    const entry = pending[i]!
    let applied = false
    if (entry.expiresAt > Date.now()) {
      for (const handler of handlers) {
        if (offer(handler, entry.req)) applied = true
      }
    }
    if (applied || entry.expiresAt <= Date.now()) {
      if (entry.expiresAt === NEVER) changedHeld = true
      pending.splice(i, 1)
    } else i += 1
  }
  if (changedHeld) persistHeld()
}

/** Tests: forget the in-memory queue as a page reload would (storage is NOT touched). */
export function reloadComposerBusForTests(): void {
  pending.length = 0
  restored = false
}
