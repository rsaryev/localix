/**
 * Shared resolution of the API key a run actually used, plus its masked label.
 * Both the per-turn usage-ledger write (event-handlers) and the run-completion
 * provider metadata (finalize) need the same `connection.keys.find(...)` lookup
 * and the same `…last4` masking — kept here so the two stay in lock-step.
 */
import type { ResolvedRunModel } from './model-selection'

type RunConnection = ResolvedRunModel['connection']
type RunKey = RunConnection['keys'][number]

/** The key whose id matches `usedKeyId`, or undefined when none was recorded. */
export function findUsedKey(
  connection: RunConnection,
  usedKeyId: string | undefined,
): RunKey | undefined {
  return connection.keys.find((k) => k.id === usedKeyId)
}

/** `…1234` for the key's last 4 chars, or undefined when there's no key. */
export function maskKey(key: RunKey | undefined): string | undefined {
  return key?.apiKey ? `…${key.apiKey.slice(-4)}` : undefined
}
