/**
 * applyStreamEvent — how one `/rpc/ws` frame changes a session in the web client.
 *
 * This module is the public surface; each event family has its own file under
 * `applyStreamEvent/`, because as one 800-line switch every rule could reach every other one's
 * module state (the streamed-tail proxy, the notice counters), and the family a new opcode
 * belonged to had to be found by reading all of it:
 *
 *   message-rows.ts      a row created, replaced by a newer snapshot, or removed (+ resync test)
 *   message-delta.ts     a row growing between snapshots, and the tail proxy that keeps it cheap
 *   run.ts               a run's rising and falling edge, and its activity phase
 *   hitl.ts              the human-in-the-loop card and the queue behind it
 *   session-state.ts     session metadata and the last-wins panel snapshots
 *   notices.ts           client-only transcript notices: hooks and terminal lifecycle
 *   routed-elsewhere.ts  opcodes consumed before the store, which leave the session untouched
 */
import type { AgentStreamEvent, UiSession } from './contracts'
import { hitlReducers } from './applyStreamEvent/hitl'
import { messageDeltaReducers } from './applyStreamEvent/message-delta'
import { messageRowReducers } from './applyStreamEvent/message-rows'
import { noticeReducers } from './applyStreamEvent/notices'
import { routedElsewhereReducers } from './applyStreamEvent/routed-elsewhere'
import { runReducers } from './applyStreamEvent/run'
import { sessionStateReducers } from './applyStreamEvent/session-state'
import type { StreamOpcode, StreamReducers } from './applyStreamEvent/types'

export { needsSessionResync } from './applyStreamEvent/message-rows'
export { removeHitlInteractionsFromSource } from './applyStreamEvent/hitl'

/** The one list of families. A family left out of it drops every opcode it handles. */
const FAMILIES = [
  messageRowReducers,
  messageDeltaReducers,
  runReducers,
  hitlReducers,
  sessionStateReducers,
  noticeReducers,
  routedElsewhereReducers,
] as const

// Two families claiming one opcode would let the later one win SILENTLY — the earlier handler
// just stops running. The type below cannot see an overlap, so it is refused here, at load,
// where every test that imports this module trips over it.
const claimed = new Set<string>()
for (const family of FAMILIES)
  for (const opcode of Object.keys(family)) {
    if (claimed.has(opcode)) throw new Error(`applyStreamEvent: '${opcode}' has two handlers`)
    claimed.add(opcode)
  }

/** Every family's handlers as one object type — what merging them all yields. */
type Merged<T> = (T extends unknown ? (family: T) => void : never) extends (family: infer M) => void
  ? M
  : never

/**
 * EXHAUSTIVE BY CONTRACT — the annotation is the check: an `AgentStreamEvent` variant no family
 * handles is a missing property HERE, so adding one to `chat/contracts/stream.ts` fails this
 * file until someone decides what the web client does with it. The API side has the mirror
 * guard (`REPLAY_TIER` in session-stream-registry.ts), and `scripts/stream-contract-guard.test.ts`
 * pins the opcode set in both directions.
 */
const REDUCERS: StreamReducers<StreamOpcode> = Object.assign({}, ...FAMILIES) as Merged<
  (typeof FAMILIES)[number]
>

export function applyStreamEventToSession(session: UiSession, event: AgentStreamEvent): UiSession {
  // Indexed by the event's own opcode, so the handler's event type IS this event's; TypeScript
  // cannot correlate the two through the lookup, hence the one widening. An opcode newer than
  // this client has no handler and leaves the session as it is.
  const reduce = REDUCERS[event.type] as
    | ((session: UiSession, event: AgentStreamEvent) => UiSession)
    | undefined
  return reduce ? reduce(session, event) : session
}
