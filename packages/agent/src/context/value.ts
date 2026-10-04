/**
 * Per-message task-value for VBC (pure, no LLM). High-value messages are kept
 * verbatim; low-value ones are the first to be downgraded by the allocator.
 *
 *   v_i = wRecency·recency(i) + wDep·depScore(i) + roleScore(i)
 *         + wError·errorFlag(i) − wSuperseded·supersededScore(i),  clamped ≥ ε.
 */
import type { ChatMessage } from '../chat'
import { hasItemError, isNarrativeItem } from '../agents/items'
import type { DepGraph } from './dep-graph'

export interface ValueWeights {
  /** Half-life (in messages) of the recency term. */
  recencyHalfLife: number
  wRecency: number
  wDep: number
  wError: number
  wSuperseded: number
  /** Bonus for the first user message (the original task/intent). */
  firstTaskBonus: number
  /** Bonus for messages stating a decision or constraint. */
  decisionBonus: number
  /** Floor so no message is ever "free" to destroy. */
  epsilon: number
}

export const DEFAULT_VALUE_WEIGHTS: ValueWeights = {
  recencyHalfLife: 10,
  wRecency: 1.0,
  wDep: 1.5,
  wError: 0.8,
  wSuperseded: 2.5,
  firstTaskBonus: 5.0,
  decisionBonus: 1.0,
  epsilon: 0.01,
}

const DECISION_RE =
  /\b(decided|chose|must|never|always|constraint|require[ds]?|important|do not|don't|instead of|because)\b/i

function messageText(m: ChatMessage): string {
  return typeof m.content === 'string' ? m.content : ''
}

/**
 * Text the decision-bonus regex should scan: the string content PLUS the prose
 * of narrative items (text/reasoning/plan). Tool-using turns carry their prose in
 * `items`, not `content`, so without this a turn stating a hard constraint
 * ("must never…") earns no decisionBonus and can be crushed during compression.
 * Kept separate from `messageText` so `hasError`'s keyword scan is unaffected.
 */
function decisionText(m: ChatMessage): string {
  const narrativeText = (m.items ?? [])
    .flatMap((item) => (isNarrativeItem(item) ? [item.text] : []))
    .join('\n')
  return narrativeText ? `${messageText(m)}\n${narrativeText}` : messageText(m)
}

function hasError(m: ChatMessage): boolean {
  if ((m.items ?? []).some((it) => hasItemError(it))) return true
  return /\b(error|failed|exception|traceback|cannot|denied)\b/i.test(messageText(m))
}

/** Compute the (non-negative) task value of message `i`. */
export function messageValue(
  i: number,
  messages: ChatMessage[],
  graph: DepGraph,
  weights: ValueWeights = DEFAULT_VALUE_WEIGHTS,
): number {
  const N = messages.length
  const m = messages[i]

  const recency = Math.pow(0.5, (N - 1 - i) / weights.recencyHalfLife)

  let role = 0
  if (i === 0 && m.role === 'user') role += weights.firstTaskBonus
  if (DECISION_RE.test(decisionText(m))) role += weights.decisionBonus

  const v =
    weights.wRecency * recency +
    weights.wDep * graph.depScore(i) +
    role +
    weights.wError * (hasError(m) ? 1 : 0) -
    weights.wSuperseded * graph.supersededScore(i)

  return Math.max(weights.epsilon, v)
}

/** Convenience: value of every message. */
export function scoreMessages(
  messages: ChatMessage[],
  graph: DepGraph,
  weights: ValueWeights = DEFAULT_VALUE_WEIGHTS,
): number[] {
  return messages.map((_, i) => messageValue(i, messages, graph, weights))
}
