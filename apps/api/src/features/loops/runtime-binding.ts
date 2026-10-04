import type { LoopService } from './service'

/**
 * Late binding for the loop service. Constructed in bootstrap AFTER the chat service (a loop fire
 * drives chat sessions), but the `loops` agent tool — created INSIDE the chat service / agent
 * runner — needs it. Keeps `agent-core` from importing `chat`.
 */
let current: LoopService | null = null

export function setLoopEngine(service: LoopService): void {
  current = service
}

export function getLoopEngine(): LoopService | null {
  return current
}
