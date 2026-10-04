import { classifyAgentError, type AgentErrorInfo } from './error-classification'

/**
 * HOW A FAILED RUN IS SAID TO A PERSON — one presenter for every surface that says it.
 *
 * A failed run used to be worded three times, by three owners: the transcript line appended
 * "Trying again may work." to the classifier's sentence (which itself still said "Retrying…"
 * after the last retry was spent), the Event Center row titled it "Agent run failed" with the
 * same sentence as its body, and the provider's condition row said it a third time. Where the
 * classifier had no sentence of its own, all three showed the provider's raw body —
 * `403: {"message":"Key limit exceeded…"}` — as if it were an explanation.
 *
 * So the classification (`error-classification.ts`, which decides what the HOST does: retry,
 * compress, cool a route down) is followed by ONE presentation (what the PERSON reads and can
 * do), and every surface renders from its parts:
 *
 *   headline  "Could not …" — the journal row's title; names the conversation when given one
 *   reason    one human sentence ending in a full stop — the transcript notice and the row body
 *   actions   what can be done, from the open recovery set below; first is primary
 *   detail    the error's own text, when it had any, for a tooltip or a log — never the reason
 *   severity  `error` when trying again cannot help, `warning` when it may
 *
 * Recovery is an OPEN set of typed verbs rather than prose ("sign in from Settings"), because a
 * control beside the sentence is what makes it actionable, and because a Retry offered for a
 * spent quota is a promise it cannot keep:
 *
 *   retry | open-settings:<tab>[/<anchor>] | sign-in:<connectionId> | restart:<subject>
 *
 * The host resolves each verb to a destination (`apps/api` `notifications/recovery.ts`).
 */

export type Recovery =
  | 'retry'
  | `open-settings:${string}`
  | `sign-in:${string}`
  | `restart:${string}`

export interface PresentedError {
  headline: string
  reason: string
  actions: Recovery[]
  detail?: string
  severity: 'warning' | 'error'
}

export interface PresentContext {
  /** The conversation's title, named in the headline. */
  conversation?: string
  /** The provider connection the run went out on; a refused key offers to sign in to it. */
  connectionId?: string | null
}

const DETAIL_MAX = 300

const sentence = (text: string): string => {
  const trimmed = text.trim()
  return /[.!?…]$/u.test(trimmed) ? trimmed : `${trimmed}.`
}

function verbatimDetail(info: AgentErrorInfo): string | undefined {
  if (!info.verbatim) return undefined
  const text = info.userMessage.replace(/^Error:\s*/u, '').trim()
  if (!text) return undefined
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text
}

/** Reason and recovery for an already-classified failure — the run finalizer's entry. */
export function presentErrorInfo(
  info: AgentErrorInfo,
  context: PresentContext = {},
): PresentedError {
  const headline = context.conversation?.trim()
    ? `Could not finish the reply in “${context.conversation.trim()}”`
    : 'Could not finish the reply'
  const providers: Recovery = 'open-settings:providers'
  const detail = verbatimDetail(info)
  const shape = ((): Pick<PresentedError, 'reason' | 'actions'> => {
    if (info.authFailed) {
      return {
        reason: 'The provider refused the API key or sign-in.',
        actions: [context.connectionId ? `sign-in:${context.connectionId}` : providers],
      }
    }
    if (info.rateLimited) {
      return info.retryable
        ? {
            reason: 'The provider is rate-limiting requests. Wait a moment, then try again.',
            actions: ['retry'],
          }
        : { reason: 'This connection has reached its usage limit.', actions: [providers] }
    }
    if (info.modelUnavailable) return { reason: sentence(info.userMessage), actions: [providers] }
    // A retry sends the same history and fails the same way; the reason says what does help.
    if (info.kind === 'context_overflow') return { reason: sentence(info.userMessage), actions: [] }
    if (info.verbatim) {
      return info.retryable
        ? { reason: 'The provider had a temporary error.', actions: ['retry'] }
        : { reason: 'The run stopped on an unexpected error.', actions: [] }
    }
    return { reason: sentence(info.userMessage), actions: info.retryable ? ['retry'] : [] }
  })()
  return {
    headline,
    ...shape,
    ...(detail ? { detail } : {}),
    severity: info.retryable ? 'warning' : 'error',
  }
}

/** Classify and present in one step, for a caller holding the raw error. */
export function presentError(error: unknown, context: PresentContext = {}): PresentedError {
  return presentErrorInfo(classifyAgentError(error), context)
}
