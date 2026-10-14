import type { AgentStreamEvent, UiSession } from '../contracts'

export type StreamOpcode = AgentStreamEvent['type']

export type StreamEventOf<K extends StreamOpcode> = Extract<AgentStreamEvent, { type: K }>

/** How one opcode (or several that share a rule) changes the session. */
export type StreamReducer<K extends StreamOpcode> = (
  session: UiSession,
  event: StreamEventOf<K>,
) => UiSession

/**
 * One family's handlers: EXACTLY its opcodes, each typed by its own event. The entry point
 * spreads every family into a `StreamReducers<StreamOpcode>`, so an opcode no family handles is
 * a type error there rather than a frame the client drops.
 */
export type StreamReducers<K extends StreamOpcode> = { [P in K]: StreamReducer<P> }
