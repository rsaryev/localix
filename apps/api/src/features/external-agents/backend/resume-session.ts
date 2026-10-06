import { shellQuote } from '@localixai/plugin-sdk/backend'
import type { SessionSummary } from '../shared/contracts'
import { adapterFor } from './adapters/registry'

/** Only adapters that declare native continuation expose a terminal action. */
export function resumeSession(summary: SessionSummary) {
  const adapter = adapterFor(summary.provider)
  if (!adapter?.resumeCommand || !summary.nativeSessionId) return undefined
  const command = adapter.resumeCommand(summary.nativeSessionId)
  return {
    providerName: adapter.displayName,
    command: summary.cwd ? `cd -- ${shellQuote(summary.cwd)} && ${command}` : command,
  }
}
