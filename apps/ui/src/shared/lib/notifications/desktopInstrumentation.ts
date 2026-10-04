import {
  onDesktopInvokeEvent,
  type DesktopInvokeEvent,
  type DesktopInvokePhase,
} from '@/shared/lib/tauri'
import { activeEventOrigin } from './context'
import { scheduleUnreportedFailure } from './incidentFallback'
import {
  isUserInitiatedOperation,
  observeOperationContext,
  operationContextAttributes,
  type ObservedOperationContext,
} from './operationContext'
import { addEventTraceStep } from './trace'
import type { EventTraceStep, TraceAttributeValue } from './types'

/** Commands whose owner already has an explicit fallback or that are advisory. */
const BEST_EFFORT_COMMANDS = new Set([
  'deep_link_ready',
  'dragged_paths',
  'frontend_log',
  'notify',
  'open_external',
  'pick_directory',
  'pick_files',
  'quit_ready',
  'resync_runtime_status',
  'save_file',
  'set_projects',
  'set_recent_sessions',
  'set_theme',
  'set_title',
  'updater_check',
])

const COMMAND_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u

function safeCommand(command: string): string {
  return COMMAND_PATTERN.test(command) ? command : 'unknown'
}

function phaseLabel(phase: DesktopInvokePhase): string {
  return phase === 'succeeded' ? 'completed' : phase
}

function errorAttributes(error: unknown): Record<string, TraceAttributeValue> {
  if (!error || typeof error !== 'object') return {}
  const value = error as Record<string, unknown>
  const attributes: Record<string, TraceAttributeValue> = {}
  if (error instanceof Error) attributes.errorType = error.name.slice(0, 80)
  if (typeof value.code === 'string' || typeof value.code === 'number') attributes.code = value.code
  return attributes
}

export function desktopInvokeTraceStep(
  event: DesktopInvokeEvent,
  context?: ObservedOperationContext,
): Omit<EventTraceStep, 'id'> | null {
  if (event.phase !== 'failed' && !isUserInitiatedOperation(context)) return null
  const command = safeCommand(event.command)
  return {
    traceId: event.traceId,
    phase: event.phase,
    kind: `desktop.${command}`,
    summary: `${command} ${phaseLabel(event.phase)}`,
    origin: context?.origin ?? activeEventOrigin(),
    ts: event.ts,
    durationMs: event.durationMs,
    attributes: {
      command,
      ...operationContextAttributes(context),
      ...(event.phase === 'failed' ? errorAttributes(event.error) : {}),
    },
  }
}

export function desktopInvokeFailureNeedsFallback(
  event: DesktopInvokeEvent,
  context?: ObservedOperationContext,
): boolean {
  const command = safeCommand(event.command)
  return (
    event.phase === 'failed' &&
    command !== 'unknown' &&
    !BEST_EFFORT_COMMANDS.has(command) &&
    isUserInitiatedOperation(context)
  )
}

function recordDesktopInvoke(event: DesktopInvokeEvent): void {
  const context = observeOperationContext({
    traceId: event.traceId,
    phase: event.phase,
    ts: event.ts,
    origin: activeEventOrigin(),
  })
  const step = desktopInvokeTraceStep(event, context)
  if (!step) return
  addEventTraceStep(step)
  if (desktopInvokeFailureNeedsFallback(event, context)) {
    scheduleUnreportedFailure({
      traceId: event.traceId,
      summary: step.summary,
      // A native command's name ("save_file") is the bridge's vocabulary, not the person's.
      title: 'The desktop app could not complete the action',
      origin: step.origin,
      ts: event.ts,
    })
  }
}

/** Install once at the application boundary; native command arguments stay at the bridge. */
export function startDesktopEventTracing(): () => void {
  return onDesktopInvokeEvent(recordDesktopInvoke)
}
