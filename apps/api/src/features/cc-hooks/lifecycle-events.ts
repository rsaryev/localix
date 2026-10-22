import {
  createLifecycleEventRegistry,
  type LifecycleEventDefinition,
  type BuiltinLifecycleEventId,
} from '@localixai/agent/runtime'
import type { CcHookEvent } from './contracts'

/** External names are confined to the format adapter, including its supported-event matrix. */
const EVENT_NAMES = {
  SessionStart: 'session.start',
  UserPromptSubmit: 'input.submit',
  PreToolUse: 'tool.before',
  PostToolUse: 'tool.after',
  PostToolUseFailure: 'tool.failed',
  Stop: 'run.finish',
  SessionEnd: 'session.end',
  SubagentStart: 'delegation.start',
  SubagentStop: 'delegation.finish',
  PreCompact: 'context.checkpoint.before',
  Notification: 'attention.request',
} as const satisfies Record<CcHookEvent, BuiltinLifecycleEventId>

const events = createLifecycleEventRegistry()

export function nativeLifecycleEvent(event: CcHookEvent): LifecycleEventDefinition {
  const descriptor = events.get(EVENT_NAMES[event])
  if (!descriptor) throw new Error('External event has no registered native lifecycle translation')
  return descriptor
}
