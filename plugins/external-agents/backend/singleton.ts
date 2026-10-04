/**
 * One service per process.
 *
 * `register(ctx)` runs more than once: the host loads a plugin backend at boot (where `ctx.host`
 * is populated) and again per run for tools and hooks (where it is not). The live delegation
 * store and the index cache must survive across those loads or every run would
 * start with an empty roster and lose the state of agents that are still running.
 */

import { AgentSessionsService } from './service'

let instance: AgentSessionsService | undefined
let started: Promise<void> | undefined

export function getAgentSessionsService(
  stateDir: string,
  log: (message: string) => void,
): AgentSessionsService {
  if (!instance) {
    instance = new AgentSessionsService(stateDir, log)
    started = instance.start().catch((error: unknown) => {
      log(`external-agents: startup failed: ${String(error)}`)
    })
  }
  return instance
}

export function whenStarted(): Promise<void> {
  return started ?? Promise.resolve()
}

export function disposeAgentSessionsService(): void {
  instance?.shutdown()
  instance = undefined
  started = undefined
}
