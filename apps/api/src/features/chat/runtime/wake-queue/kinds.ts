/**
 * WHAT THE QUEUE DOES WITH EACH KIND OF ENTRY — one table, read by admission, selection, steering
 * and delivery alike.
 *
 * Every question the queue asks of an entry is answered here, per kind:
 *
 *   opens   may it open a turn of its own now, or does it wait for the work it reports on?
 *   joins   may a RUNNING model take it, and at which boundary?
 *   batch   which other entries is it delivered together with?
 *   render  what does one delivered batch say?
 *   route   whom does the conversation strategy give the turn to?
 *   speaks  is the person speaking — so the agents they tag join, and colleague chains drop?
 *
 * They used to be predicates over optional fields in five places (`isBoundaryDeliverable`,
 * `isDelegatorMessage`, `isSubagentReport`, `hasExecutionOverrides` and the band rules of
 * `selectDrainBand`), and a kind added to one of them and not another advertised a delivery the
 * queue never made. The table is typed like a change feed's consumer (`changes/contracts.ts`):
 * every kind must answer every question, so a kind added to `PendingTurn` fails to compile until
 * it says what it does.
 */
import { participantAgentId } from '../../../../db/participant'
import { delegationReportsMessage } from '../delegation-report'
import type { ConversationEvent } from '../conversation-strategy'
import type { QueueSource } from '../queue-policy'
import {
  fixesExecution,
  surfaceKey,
  type EntryKind,
  type EventTurn,
  type PendingTurn,
  type PersonTurn,
} from './entry'

/**
 * Where a running model may take an entry: at its next boundary (the person's interjection, a
 * delegator's amended brief), only once a tool turn has completed (a child's report — injecting
 * one mid-turn would split the response whose async tools produced it), or never.
 */
export type JoinPoint = 'boundary' | 'tool-turn' | 'never'

/**
 * Entries sharing a key are delivered as one turn. `adjacent`: only an unbroken run of them in
 * queue order — the person's messages keep their order around anything typed between them.
 */
export interface BatchRule {
  key: string
  adjacent: boolean
}

interface KindPolicy<T extends PendingTurn> {
  /** `settled`: held while the work it reports on is still running (`holds.ts`). */
  opens: 'now' | 'settled'
  joins(turn: T): JoinPoint
  batch(turn: T): BatchRule | undefined
  render(turns: readonly T[]): string
  route(turn: T, content: string, routedTo: string | undefined): ConversationEvent
  speaks(turn: T): boolean
}

type KindTable = { [K in EntryKind]: KindPolicy<Extract<PendingTurn, { entry: K }>> }

const joined = (turns: readonly PendingTurn[]) => turns.map((turn) => turn.content).join('\n\n')
/** The runtime rule: the participant a wake names, else whoever was dispatched least recently. */
const byRuntime = (routedTo: string | undefined): ConversationEvent => ({
  kind: 'runtime',
  recipient: routedTo ? (participantAgentId(routedTo) ?? undefined) : undefined,
})

/** A plain message: no attachments, nothing that fixes its own run. */
const plain = (turn: PersonTurn | EventTurn) => !turn.bindings?.length && !fixesExecution(turn)

/**
 * Who a message names, as a key: two messages merge only when they are for the same addressees.
 * Approximate on purpose — a mismatch only keeps two messages apart, as they always were.
 */
const mentionKey = (content: string) =>
  [...new Set([...content.matchAll(/(?:^|[\s(])@([\w.-]+)/g)].map((m) => m[1]!.toLowerCase()))]
    .sort()
    .join(',')

const KINDS: KindTable = {
  person: {
    opens: 'now',
    // A hidden prompt is a client's (a wizard's), not an interjection the person typed.
    joins: (turn) => (!turn.internal && plain(turn) ? 'boundary' : 'never'),
    // Three lines typed while the agent worked are one thought: answered once, in order.
    batch: (turn) =>
      !turn.internal && plain(turn)
        ? {
            key: `person:${surfaceKey(turn.toolSurface)}:${mentionKey(turn.content)}`,
            adjacent: true,
          }
        : undefined,
    render: joined,
    // By its own text, exactly as when the session was idle — a webhook's words included.
    route: (_turn, content) => ({ kind: 'user-message', text: content }),
    speaks: (turn) => !turn.internal,
  },
  command: {
    opens: 'now',
    joins: () => 'never',
    batch: () => undefined,
    render: joined,
    route: (_turn, content) => ({ kind: 'user-message', text: content }),
    speaks: () => true,
  },
  event: {
    opens: 'now',
    // A delegator's message amends the brief its child works from; nothing else interrupts.
    joins: (turn) =>
      turn.source === 'delegator' && plain(turn) && !turn.toolSurface ? 'boundary' : 'never',
    batch: (turn) =>
      turn.coalesce && plain(turn) && !turn.toolSurface
        ? {
            key: `event:${turn.source ?? ''}:${turn.coalesce}:${turn.to?.participant ?? ''}`,
            adjacent: false,
          }
        : undefined,
    render: joined,
    // A machine wake goes by the runtime rule (its addressee, else the least recently
    // dispatched participant); one that carries the person's words goes by those words.
    route: (turn, content, routedTo) =>
      !turn.internal
        ? { kind: 'user-message', text: content }
        : turn.addressedAs !== undefined
          ? { kind: 'user-message', text: turn.addressedAs }
          : byRuntime(routedTo),
    speaks: (turn) => !turn.internal || turn.addressedAs !== undefined,
  },
  report: {
    opens: 'settled',
    joins: () => 'tool-turn',
    // Every report to one delegator, however they interleave with other wakes.
    batch: (turn) => ({ key: `report:${turn.to?.participant ?? ''}`, adjacent: false }),
    render: (turns) => delegationReportsMessage(turns.map((turn) => turn.report)),
    route: (_turn, _content, routedTo) => byRuntime(routedTo),
    speaks: () => false,
  },
  ticket: {
    opens: 'now',
    joins: () => 'never',
    // A second address to a waiting participant folds into its ticket at admission instead.
    batch: () => undefined,
    render: joined,
    route: (_turn, _content, routedTo) => byRuntime(routedTo),
    speaks: () => false,
  },
}

const policy = <T extends PendingTurn>(turn: T) => KINDS[turn.entry] as unknown as KindPolicy<T>

export const opensWhen = (turn: PendingTurn): 'now' | 'settled' => policy(turn).opens
export const joinPoint = (turn: PendingTurn): JoinPoint => policy(turn).joins(turn)
export const batchRule = (turn: PendingTurn): BatchRule | undefined => policy(turn).batch(turn)
export const personSpeaks = (turn: PendingTurn): boolean => policy(turn).speaks(turn)

/** What one delivered batch says: the head's kind words the whole batch. */
export const renderBatch = (turns: readonly PendingTurn[]): string =>
  policy(turns[0]!).render(turns)

/** The event the conversation strategy routes a delivered batch by. */
export const routeEvent = (
  head: PendingTurn,
  content: string,
  routedTo: string | undefined,
): ConversationEvent => policy(head).route(head, content, routedTo)

/** The band an entry waits in (`queue-policy.ts` numbers them). */
export function queueSourceOf(turn: PendingTurn): QueueSource {
  if (turn.entry === 'ticket') return { kind: 'agent-turn', producer: turn.agentTurn.source }
  return turn.source || turn.internal ? { kind: 'wake', producer: turn.source } : { kind: 'user' }
}
