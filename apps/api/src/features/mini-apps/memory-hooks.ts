import { isRecord } from '../../lib/record'
import { invokeHook, type HookRunOptions } from './hook-invoke'
import {
  MEMORY_CONTEXT_CAP_CHARS,
  MEMORY_TIMEOUT_MS,
  type MemoryLoadContextEvent,
  type MemoryRunEndEvent,
} from './native'
import type { LoadedMiniApps } from './loader-contract'

/**
 * Memory-provider invocation — same isolation philosophy as the plugin hooks in
 * [[hooks]], but with the more generous MEMORY_TIMEOUT_MS (backends do network
 * round-trips). Shares the [[hook-invoke]] primitive so the timeout/isolation
 * logic lives in exactly one place.
 */

/**
 * Ask the active memory provider for this run's "# Memory context". Returns the
 * effective context string (provider replaced/appended onto the built-in notes),
 * or the built-in notes unchanged when there is no provider / it returns
 * nothing / it fails or times out. Provider output is capped at
 * {@link MEMORY_CONTEXT_CAP_CHARS}.
 */
export async function loadMemoryProviderContext(
  memory: LoadedMiniApps['memory'],
  event: Omit<MemoryLoadContextEvent, 'builtinContext'> & { builtinContext: string },
  options: Omit<HookRunOptions, 'sessionId'> & { timeoutMs?: number },
): Promise<string> {
  if (!memory) return event.builtinContext
  const outcome = await invokeHook(
    memory.app,
    'memory.loadContext',
    () => memory.provider.loadContext(event),
    options.timeoutMs ?? MEMORY_TIMEOUT_MS,
    options.logger,
  )
  if (!isRecord(outcome) || typeof outcome.context !== 'string' || !outcome.context.trim()) {
    return event.builtinContext
  }
  const provided = outcome.context.slice(0, MEMORY_CONTEXT_CAP_CHARS)
  if (outcome.mode === 'append' && event.builtinContext) {
    return `${event.builtinContext}\n\n${provided}`
  }
  return provided
}

/** Fire the provider's extraction pass after a completed run. Best-effort, never throws. */
export function runMemoryProviderRunEnd(
  memory: LoadedMiniApps['memory'],
  event: MemoryRunEndEvent,
  options: Omit<HookRunOptions, 'sessionId'> & { timeoutMs?: number },
): void {
  if (!memory?.provider.onRunEnd) return
  void invokeHook(
    memory.app,
    'memory.onRunEnd',
    () => memory.provider.onRunEnd!(event),
    options.timeoutMs ?? MEMORY_TIMEOUT_MS,
    options.logger,
  )
}
