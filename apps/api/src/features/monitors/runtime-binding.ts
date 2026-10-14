import type { MonitorService } from './service'

/**
 * Late binding for the monitor service. It is constructed in bootstrap AFTER the chat service
 * (its wake and publish ports are chat's), but two things created EARLIER need to reach it:
 * the `monitor` tool built inside the agent runner, and chat's own session-delete reap. Same
 * seam, same reason as `loops/runtime-binding.ts` — it is what keeps `agent-core` from
 * importing `features/chat`.
 */
let current: MonitorService | null = null

export function setMonitorService(service: MonitorService): void {
  current = service
}

export function getMonitorService(): MonitorService | null {
  return current
}
