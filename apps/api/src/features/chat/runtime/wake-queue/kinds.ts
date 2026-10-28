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
 *   route   what does the conversation's one agent answer — a typed message or a runtime delivery?
 *
 * They used to be predicates over optional fields in five places (`isBoundaryDeliverable`,
 * `isDelegatorMessage`, `isSubagentReport`, `hasExecutionOverrides` and the band rules of
 * `selectDrainBand`), and a kind added to one of them and not another advertised a delivery the
 * queue never made. The table is typed like a change feed's consumer (`changes/contracts.ts`):
 * every kind must answer every question, so a kind added to `PendingTurn` fails to compile until
 * it says what it does.
 */
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
  route(turn: T, content: string): ConversationEvent
}

type KindTable = { [K in EntryKind]: KindPolicy<Extract<PendingTurn, { entry: K }>> }

const joined = (turns: readonly PendingTurn[]) => turns.map((turn) => turn.content).join('\n\n')
/** The runtime rule: the session's agent answers a delivery the runtime addresses. */
const byRuntime = (): ConversationEvent => ({ kind: 'runtime' })

/** A subagent's message to its delegator: an event from a child, not its report. */
export const childMessage = (turn: PendingTurn): boolean =>
  turn.entry === 'event' && turn.source === 'subagent'

/** A plain message: no attachments, nothing that fixes its own run. */
const plain = (turn: PersonTurn | EventTurn) => !turn.bindings?.length && !fixesExecution(turn)

const KINDS: KindTable = {
  person: {
    opens: 'now',
    // A hidden prompt is a client's (a wizard's), not an interjection the person typed.
    joins: (turn) => (!turn.internal && plain(turn) ? 'boundary' : 'never'),
    // Three lines typed while the agent worked are one thought: answered once, in order.
    batch: (turn) =>
      !turn.internal && plain(turn)
        ? {
            key: `person:${surfaceKey(turn.toolSurface)}`,
            adjacent: true,
          }
        : undefined,
    render: joined,
    // By its own text, exactly as when the session was idle — a webhook's words included.
    route: (_turn, content) => ({ kind: 'user-message', text: content }),
  },
  command: {
    opens: 'now',
    joins: () => 'never',
    batch: () => undefined,
    render: joined,
    route: (_turn, content) => ({ kind: 'user-message', text: content }),
  },
  event: {
    opens: 'now',
    // A delegator's message amends the brief its child works from. A subagent's message to its
    // delegator (`SendMessage` to "main") joins as a report does, at a completed tool turn and only
    // for that delegator (`steerable.ts`). Nothing else interrupts.
    joins: (turn) =>
      !plain(turn) || turn.toolSurface
        ? 'never'
        : turn.source === 'delegator'
          ? 'boundary'
          : childMessage(turn)
            ? 'tool-turn'
            : 'never',
    batch: (turn) =>
      turn.coalesce && plain(turn) && !turn.toolSurface
        ? {
            key: `event:${turn.source ?? ''}:${turn.coalesce}`,
            adjacent: false,
          }
        : undefined,
    render: joined,
    // A machine wake goes by the runtime rule; one that carries the person's words by those.
    route: (turn, content) =>
      !turn.internal ? { kind: 'user-message', text: content } : byRuntime(),
  },
  report: {
    opens: 'settled',
    joins: () => 'tool-turn',
    // Every report to one delegator, however they interleave with other wakes.
    batch: () => ({ key: 'report', adjacent: false }),
    render: (turns) => delegationReportsMessage(turns.map((turn) => turn.report)),
    route: () => byRuntime(),
  },
  ticket: {
    opens: 'now',
    joins: () => 'never',
    // A second address to a waiting agent folds into its ticket at admission instead.
    batch: () => undefined,
    render: joined,
    route: () => byRuntime(),
  },
}

const policy = <T extends PendingTurn>(turn: T) => KINDS[turn.entry] as unknown as KindPolicy<T>

export const joinPoint = (turn: PendingTurn): JoinPoint => policy(turn).joins(turn)
export const batchRule = (turn: PendingTurn): BatchRule | undefined => policy(turn).batch(turn)

/** What one delivered batch says: the head's kind words the whole batch. */
export const renderBatch = (turns: readonly PendingTurn[]): string =>
  policy(turns[0]!).render(turns)

/** The event the recipient rule routes a delivered batch by. */
export const routeEvent = (head: PendingTurn, content: string): ConversationEvent =>
  policy(head).route(head, content)

/** The band an entry waits in (`queue-policy.ts` numbers them). */
export function queueSourceOf(turn: PendingTurn): QueueSource {
  if (turn.entry === 'ticket') return { kind: 'agent-turn', producer: turn.agentTurn.source }
  return turn.source || turn.internal ? { kind: 'wake', producer: turn.source } : { kind: 'user' }
}
