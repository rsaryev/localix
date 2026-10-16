/**
 * Implementation contract for a system control. Each toggle owns its effect
 * (start on enable, stop on disable) and reports availability for the host.
 * Register more in the system service — the API/UI never name a specific one.
 */
export interface SystemToggleDef {
  id: string
  title: string
  description?: string
  /** False when unsupported on this host (e.g. the OS tool is missing). */
  isAvailable(): boolean
  /** Begin the effect. Should be idempotent. */
  enable(): Promise<void> | void
  /** End the effect and release any held resources. Should be idempotent. */
  disable(): Promise<void> | void
}
