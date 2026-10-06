import { shellQuote } from '@localixai/plugin-sdk/backend'
import type { SessionSummary } from '../shared/contracts'
import type { AdapterEnv, ProviderAdapter, SourceRef } from './adapters/types'
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

/** Read only the source summary needed for native continuation. */
export async function readSessionResume(
  source: { adapter: ProviderAdapter; ref: SourceRef } | null,
  env: AdapterEnv,
) {
  const summary = await readNativeSummary(source, env)
  return summary ? { resume: resumeSession(summary) } : null
}

export async function readNativeSummary(
  source: { adapter: ProviderAdapter; ref: SourceRef } | null,
  env: AdapterEnv,
) {
  if (!source) return null
  const [summary] = await source.adapter.readSummaries([source.ref], env)
  return summary ?? null
}
