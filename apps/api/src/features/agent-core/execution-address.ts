/** An agent's stable address inside a conversation; independent of handles and run attempts. */
export interface ExecutionAddress {
  sessionId: string
  agentId: string
}

/** Tuple encoding avoids collisions when either identifier contains a delimiter. */
export function agentLaneKey(address: ExecutionAddress): string {
  if (!address.sessionId || !address.agentId) throw new Error('Execution address is incomplete')
  return JSON.stringify([address.sessionId, address.agentId])
}

/** Match all lanes of a deleted conversation without matching similarly named sessions. */
export function agentLaneSessionPrefix(sessionId: string): string {
  return `[${JSON.stringify(sessionId)},`
}
