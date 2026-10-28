/**
 * THE PERSISTED DECISION of one context checkpoint — what the model sees of a conversation
 * that has outgrown its window, frozen so the next turn can rebuild exactly the same view.
 *
 * The defect this shape exists to stop is a history that changes bytes between turns. Every
 * provider caches a request by its PREFIX, and on models with preserved thinking (Claude Fable
 * 5.1, Opus 5, Opus 5.5) each thinking block is bound to the exact bytes before it — edit an
 * earlier message and every later block is dropped. So the view may change only at a
 * checkpoint, all at once, and between checkpoints the history is append-only. That forces the
 * view to be a pure function of the durable log plus THIS record: nothing in it may depend on
 * a planner re-run, on today's tool roster, or on messages that arrived after it was taken.
 *
 * Deterministic by construction, and taken without a model call: the cards are rendered from
 * the tool calls and the text the evicted messages already contain.
 */
import type { ChatMessage } from '../../chat'
import type { ReadFate } from '../live-reads'
import type { OpKind } from '../op-menu'

/** Why a checkpoint was taken — kept for audits and for the transcript's view divider. */
export type CheckpointReason =
  /** The provider-measured request reached the high-water mark. */
  | 'threshold'
  /** The history would not fit the request ceiling at all (a smaller model, no anchor yet). */
  | 'ceiling'
  /** The provider rejected the request as too long. */
  | 'overflow'
  /** The model returned nothing on an oversized context. */
  | 'empty_run'

/** One message of the history a checkpoint reasons over, with the host's facts about it. */
export interface CheckpointEntry<M extends ChatMessage = ChatMessage> {
  message: M
  /**
   * The person started a turn here. Eviction cuts only
   * in front of such a message, so the kept history never opens with a reply to a question the
   * model can no longer see.
   */
  turnStart: boolean
  /** Host-authored context (a turn's runtime context, a wake note): evictable, never quoted. */
  internal: boolean
  /** A trusted delegator amended the assignment; quote it as an update, never as human input. */
  assignmentUpdate?: boolean
  /** The person asked to keep this message in view. */
  pinned: boolean
  /** ISO timestamp, for the date range an epoch card states. */
  createdAt?: string
}

/** A tool-observation op, as a fold stacks on it. */
export interface FrozenToolOp {
  kind: Exclude<OpKind, 'verbatim' | 'fold'>
  truncateChars?: number
}

/**
 * How one kept message is shown, frozen so re-applying it depends on nothing but the message.
 *
 * A menu cannot be re-derived at projection time: which reads are LIVE depends on the reads
 * that come after, so the same message planned inside a longer list gets a different menu —
 * and the view of an old message would change on the turn a new read arrived.
 */
export interface FrozenTransform {
  op?: FrozenToolOp | { kind: 'fold'; stackedOn?: FrozenToolOp }
  /** Tool calls in this message the op leaves verbatim (its live reads). */
  protectedItemIds?: string[]
  /** How each elided read in this message must be recovered. */
  readFates?: Record<string, ReadFate>
  /** Live-state snapshots (`supersedeKey`) a newer same-key result replaced. */
  supersededItemIds?: string[]
}

/** What the model is told about one run of evicted messages. */
export interface EpochCard {
  fromId: string
  throughId: string
  /** Detail: 0 full, 1 brief, 2 one line. A card only ever loses detail, at a later checkpoint. */
  level: 0 | 1 | 2
  /** The rendered text, frozen — a renderer change must not rewrite an existing view. */
  text: string
}

export interface ContextCheckpoint {
  version: 1
  reason: CheckpointReason
  /** The newest message the checkpoint reasoned over. Everything after it is shown verbatim. */
  coversThroughId: string
  /** The newest evicted message; the cards describe everything from the start through it. */
  evictedThroughId?: string
  cards: EpochCard[]
  /** Kept messages shown transformed, by id. Absent id: verbatim (reasoning still stripped). */
  transforms: Record<string, FrozenTransform>
  /** Evicted messages the person pinned, kept verbatim right after the cards. */
  pinnedIds: string[]
  /** Frozen with the view: a roster change later must not reword the pointers already shown. */
  recoveryToolAvailable: boolean
  recallToolAvailable: boolean
  tokens: { before: number; after: number; target: number }
}
