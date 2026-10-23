import type { LoadedMiniAppHook } from './loader-contract'
import { HOOK_TIMEOUT_MS, invokeHook, type HookRunOptions } from './hook-invoke'
import type {
  HitlRequestEvent,
  HitlResolvedEvent,
  HumanAssignedEvent,
  MiniAppHooks,
  SubagentStopEvent,
} from './native'

// Lifecycle + observer hooks: fire-and-forget notifications a plugin can observe
// (subagent-stop, HITL request/resolved, session-end). Split out of hooks.ts;
// the historical `./hooks` import surface re-exports these. Each is best-effort —
// per-plugin isolation + timeout, never throws.

/** Fire an observer-only hook on every declaring plugin (isolation + timeout each). */
async function runObserverHooks<
  K extends 'onSubagentStop' | 'onHitlRequest' | 'onHitlResolved' | 'onHumanAssigned',
>(
  hookName: K,
  hookEntries: readonly LoadedMiniAppHook[],
  event: Parameters<NonNullable<MiniAppHooks[K]>>[0],
  options: HookRunOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? HOOK_TIMEOUT_MS
  await Promise.all(
    hookEntries.flatMap(({ app, hooks }) =>
      hooks[hookName]
        ? [
            invokeHook(
              app,
              hookName,
              () => hooks[hookName]!(event as never),
              timeoutMs,
              options.logger,
            ),
          ]
        : [],
    ),
  )
}

/** Fire every plugin's `onSubagentStop` when a child session reaches a terminal status. */
export async function runSubagentStopHooks(
  hookEntries: readonly LoadedMiniAppHook[],
  event: SubagentStopEvent,
  options: HookRunOptions,
): Promise<void> {
  return runObserverHooks('onSubagentStop', hookEntries, event, options)
}

/** Fire every plugin's `onHitlRequest` when a run blocks on a human (confirm/ask/quiz). */
export async function runHitlRequestHooks(
  hookEntries: readonly LoadedMiniAppHook[],
  event: HitlRequestEvent,
  options: HookRunOptions,
): Promise<void> {
  return runObserverHooks('onHitlRequest', hookEntries, event, options)
}

/** Fire every plugin's `onHitlResolved` when a pending HITL request is answered or dismissed. */
export async function runHitlResolvedHooks(
  hookEntries: readonly LoadedMiniAppHook[],
  event: HitlResolvedEvent,
  options: HookRunOptions,
): Promise<void> {
  return runObserverHooks('onHitlResolved', hookEntries, event, options)
}

/** Fire every plugin's `onHumanAssigned` when a board card is assigned to the person. */
export async function runHumanAssignedHooks(
  hookEntries: readonly LoadedMiniAppHook[],
  event: HumanAssignedEvent,
  options: HookRunOptions,
): Promise<void> {
  return runObserverHooks('onHumanAssigned', hookEntries, event, options)
}

/**
 * Fire every plugin's `onSessionEnd` hook. Called from agent-runner's run()
 * finally block — i.e. once per RUN (a continuation is a new run and
 * fires it again); true logical session-end has no single point in the runtime.
 * Best-effort: isolation + timeout per plugin, never throws.
 */
export async function runSessionEndHooks(
  hookEntries: readonly LoadedMiniAppHook[],
  options: HookRunOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? HOOK_TIMEOUT_MS
  await Promise.all(
    hookEntries.flatMap(({ app, hooks }) =>
      hooks.onSessionEnd
        ? [
            invokeHook(
              app,
              'onSessionEnd',
              () => hooks.onSessionEnd!({ sessionId: options.sessionId }),
              timeoutMs,
              options.logger,
            ),
          ]
        : [],
    ),
  )
}
