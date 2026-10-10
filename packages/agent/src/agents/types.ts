import type { AssistantMessage, UserMessage, ToolResultMessage } from '..'

// ---- Agent messages ------------------------------------------------------------
// Extend this via declaration merging to add custom message types:
//
//   declare module '@localixai/agent/agents' {
//     interface CustomAgentMessages {
//       notification: { role: 'notification'; text: string; timestamp: number }
//     }
//   }
//
// Custom messages are filtered out by convertToLlm before sending to the model.

export interface BaseAgentMessages {
  user: UserMessage
  assistant: AssistantMessage
  tool: ToolResultMessage
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomAgentMessages {}

export type AgentMessageMap = BaseAgentMessages & CustomAgentMessages
export type AgentMessage = AgentMessageMap[keyof AgentMessageMap]

// ---- Agent tools ---------------------------------------------------------------

export type {
  AgentTool,
  AgentToolPresentation,
  AgentToolCategory,
  ToolSurface,
  ToolAvailability,
} from './tool-definition'
export type { AgentToolUpdateCallback, AgentToolResult } from './tool-result'
export type { GuardVerdict, ToolGuardContext, ToolStreamGuard } from './tool-guards'
export type {
  BeforeToolCallContext,
  AfterToolCallContext,
  AfterToolCallResult,
  ToolGateProvenance,
} from './tool-call-hooks'
export type { BeforeToolCallResult } from './gate-verdict'

export type { ToolAction, ToolActionDescriptor, AsyncToolRegistry } from './tool-actions'
export type {
  ToolSessionContext,
  ToolCommandReplyOutcome,
  AgentToolExecutionContext,
} from './tool-execution-context'

export { DEFAULT_TOOL_EXPOSURE } from './tool-exposure'
export type { RunShape, ExposureLevel, ToolExposure } from './tool-exposure'

// ---- Agent events --------------------------------------------------------------

/**
 * Provider-independent source metadata attached to a streamed assistant part.
 *
 * A delta must be useful without a cumulative message snapshot: runtime adapters
 * can therefore pass only the changed part across the hot path while the host
 * preserves provider signatures and progressive tool-call metadata.
 */
export interface AgentMessageOrigin {
  api?: string
  provider?: string
  model: string
}

export type { AgentStopReason, AgentMessageDelta, AgentEvent } from './event-types'
