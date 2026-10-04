/**
 * The environment a monitor's command runs with — its `${secret:KEY}` references resolved — kept
 * per monitor for as long as this process runs it.
 *
 * Resolved at START, where a missing key refuses the monitor with a sentence the model can act
 * on (see `./secrets`), and remembered: a poll every few seconds that re-read the vault would
 * write an audit entry per poll. A monitor resumed after a restart has nothing remembered, so its
 * first poll resolves again — and a key deleted during the downtime ends the wait with `error`
 * instead of polling an endpoint with an empty credential.
 */
import type { MonitorPayload } from './record'
import { prepareSecrets, type SecretPreflight } from './secrets'

export interface MonitorCredentialsDeps {
  /**
   * Resolve one vault key for this user. `monitorId` is passed for the vault's audit trail — the
   * activity log should say WHICH watch used a key. Absent ⇒ a command that references a secret
   * is refused rather than run without it.
   */
  resolveSecret?: (userId: string, key: string, monitorId: string) => Promise<string | undefined>
}

export function createMonitorCredentials(deps: MonitorCredentialsDeps) {
  const prepared = new Map<string, Extract<SecretPreflight, { ok: true }>>()

  const prepare = (
    userId: string,
    payload: Pick<MonitorPayload, 'command' | 'displayId'>,
    persistentWatch: boolean,
  ): Promise<SecretPreflight> =>
    prepareSecrets({
      command: payload.command,
      persistentWatch,
      ...(deps.resolveSecret
        ? { resolve: (key: string) => deps.resolveSecret!(userId, key, payload.displayId) }
        : {}),
    })

  return {
    prepare,
    remember(triggerId: string, preflight: Extract<SecretPreflight, { ok: true }>): void {
      prepared.set(triggerId, preflight)
    },
    /** The remembered environment, or a fresh resolution for a monitor this process did not start. */
    async forTrigger(
      triggerId: string,
      userId: string,
      payload: Pick<MonitorPayload, 'command' | 'displayId'>,
    ): Promise<SecretPreflight> {
      const known = prepared.get(triggerId)
      if (known) return known
      const fresh = await prepare(userId, payload, false)
      if (fresh.ok) prepared.set(triggerId, fresh)
      return fresh
    },
    forget(triggerId: string): void {
      prepared.delete(triggerId)
    },
  }
}

export type MonitorCredentials = ReturnType<typeof createMonitorCredentials>
