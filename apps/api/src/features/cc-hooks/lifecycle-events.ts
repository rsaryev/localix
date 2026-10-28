import {
  createLifecycleEventRegistry,
  type LifecycleEventDefinition,
} from '@localixai/agent/runtime'
import type { CcHookEvent } from './contracts'

/** External names are confined to the format adapter, including its supported-event matrix. */
const EVENT_NAMES = {
  SessionStart: 'session.start',
  UserPromptSubmit: 'input.submit',
  UserPromptExpansion: 'input.expand',
  PreToolUse: 'tool.before',
  PermissionRequest: 'permission.request',
  PermissionDenied: 'permission.denied',
  PostToolUse: 'tool.after',
  PostToolUseFailure: 'tool.failed',
  PostToolBatch: 'tool.batch.after',
  Stop: 'run.finish',
  StopFailure: 'run.failed',
  SessionEnd: 'session.end',
  SubagentStart: 'delegation.start',
  SubagentStop: 'delegation.finish',
  TaskCreated: 'task.create',
  TaskCompleted: 'task.complete',
  PreCompact: 'context.checkpoint.before',
  PostCompact: 'context.checkpoint.after',
  Notification: 'attention.request',
  InstructionsLoaded: 'instructions.load',
  ConfigChange: 'config.change',
  CwdChanged: 'session.cwd.change',
  FileChanged: 'file.change',
  PreModelSwitch: 'model.switch.before',
  PostModelSwitch: 'model.switch.after',
  Elicitation: 'mcp.elicitation',
  ElicitationResult: 'mcp.elicitation.result',
  MessageDisplay: 'message.display',
  WorktreeCreate: 'worktree.create',
} as const satisfies Record<CcHookEvent, string>

const events = createLifecycleEventRegistry()

/**
 * The host's own control points beyond the builtins. A gate says what a rejection DOES here:
 * a task write is refused like a tool call, and
 * a rejected tool batch keeps its results from reaching the model (the run halts). An approval
 * card, a denial already made, a model switch or a checkpoint are observed: a prompt verdict
 * cannot decide them (CC discards it on the first two; the others take no prompt hooks).
 */
for (const event of [
  { id: 'input.expand', gate: 'input' },
  { id: 'permission.request', gate: 'observe' },
  { id: 'permission.denied', gate: 'observe' },
  { id: 'tool.batch.after', gate: 'input' },
  { id: 'run.failed', gate: 'observe' },
  { id: 'task.create', gate: 'tool' },
  { id: 'task.complete', gate: 'tool' },
  { id: 'context.checkpoint.after', gate: 'observe' },
  { id: 'instructions.load', gate: 'observe' },
  { id: 'config.change', gate: 'observe' },
  { id: 'session.cwd.change', gate: 'observe' },
  { id: 'file.change', gate: 'observe' },
  { id: 'model.switch.before', gate: 'observe' },
  { id: 'model.switch.after', gate: 'observe' },
  { id: 'mcp.elicitation', gate: 'observe' },
  { id: 'mcp.elicitation.result', gate: 'observe' },
  { id: 'message.display', gate: 'observe' },
  // The hook makes the worktree; there is no verdict to apply (`runtime-worktree-hooks.ts`).
  { id: 'worktree.create', gate: 'observe' },
] as const)
  events.register(event)

export function nativeLifecycleEvent(event: CcHookEvent): LifecycleEventDefinition {
  const descriptor = events.get(EVENT_NAMES[event])
  if (!descriptor) throw new Error('External event has no registered native lifecycle translation')
  return descriptor
}
