import { whichBinary } from '../agent-core/tools/environments/shell'
import { loadLoginShellEnv } from '../../lib/login-shell-env'
import { PROVIDER_ADAPTERS } from './backend/adapters/registry'
import type { ProviderId } from './shared/identity'
import { LAUNCH_KINDS } from './backend/live/launch-kinds'

export interface InstalledExternalAgent {
  id: ProviderId
  name: string
  command: string
}

/** An executable on the user's repaired PATH is evidence; leftover history is not. */
export function detectInstalledExternalAgents(
  lookup: (command: string) => string | undefined = whichBinary,
): InstalledExternalAgent[] {
  return PROVIDER_ADAPTERS.flatMap((adapter) => {
    const commands = [
      adapter.command,
      ...(LAUNCH_KINDS.find((kind) => kind.provider === adapter.id)?.executables ?? []),
    ]
    const command = [...new Set(commands)].find((candidate) => lookup(candidate))
    return command ? [{ id: adapter.id, name: adapter.displayName, command }] : []
  })
}

export async function installedExternalAgents(): Promise<InstalledExternalAgent[]> {
  await loadLoginShellEnv()
  return detectInstalledExternalAgents()
}

/** A compact, per-turn fact, never part of the cache-stable identity prompt. */
export function installedAgentsPrompt(agents: readonly InstalledExternalAgent[]): string {
  if (!agents.length) return ''
  return [
    '# Installed external agents',
    'Start a new session in the project terminal with:',
    ...agents.map((agent) => `- ${agent.name}: \`${agent.command}\``),
  ].join('\n')
}
