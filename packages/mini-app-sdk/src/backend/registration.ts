import type { AgentTool } from '@localixai/agent/agents'
import type { MiniAppChannel } from './channels'
import type { MemoryProvider, MiniAppHooks } from './hooks'
import type { BackendSubsystem } from './subsystem'

/** Value returned by a native plugin's `register(ctx)` entry point. */
export interface MiniAppRegistration {
  tools?: AgentTool[]
  hooks?: MiniAppHooks
  channels?: MiniAppChannel[]
  memory?: MemoryProvider
  backend?: BackendSubsystem | BackendSubsystem[]
}
