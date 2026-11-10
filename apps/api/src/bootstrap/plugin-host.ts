import path from 'node:path'

import { managedSettingsDir } from '../features/cc-settings/managed-settings'
import {
  createChatPluginSessions,
  createLocalixPluginHost,
  type ChatPluginSessions,
  type LocalixPluginHost,
} from '../features/plugins/kit'
import { sessionDataDir } from '../features/mini-apps/session-storage'
import { localixHome, userHome } from '../lib/env'
import { childEnv } from '../lib/login-shell-env'

export interface ProcessPluginHost {
  /** The one plugin kit host of the process (`features/plugins/kit/host.ts`). */
  pluginHost: LocalixPluginHost
  /** Its sessions, one per chat: opened at the chat's first run, forgotten when it is deleted. */
  pluginSessions: ChatPluginSessions
}

/**
 * One plugin host per process, made beside the plugin service. A session binds its own MCP caller
 * and models; the host's answer that none is bound.
 */
export function createProcessPluginHost(): ProcessPluginHost {
  const pluginHost = createLocalixPluginHost({
    homeDir: userHome(),
    environment: () => childEnv(),
    pluginsRoot: () => path.join(localixHome(), 'plugins'),
    scratchDir: () => path.join(localixHome(), 'plugin-scratch'),
    // Where the run's hooks and the Bash tool keep them (`ccSessionEnvFilesOf`).
    envFilesDir: (sessionId) => path.join(sessionDataDir(sessionId), '.claude-code'),
    managedDirectory: managedSettingsDir(),
    mcp: () => undefined,
    models: () => undefined,
  })
  return { pluginHost, pluginSessions: createChatPluginSessions(pluginHost) }
}
