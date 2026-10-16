import type { AgentTool } from '@localixai/agent/agents'
import type { PluginChannel } from './channels'
import type { MemoryProvider, PluginHooks } from './hooks'
import type { BackendSubsystem } from './subsystem'

/** Value returned by a native plugin's `register(ctx)` entry point. */
export interface PluginRegistration {
  tools?: AgentTool[]
  hooks?: PluginHooks
  channels?: PluginChannel[]
  memory?: MemoryProvider
  backend?: BackendSubsystem | BackendSubsystem[]
}
