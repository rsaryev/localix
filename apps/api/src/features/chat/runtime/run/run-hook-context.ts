/**
 * The context every hook-firing unit of a run is handed.
 *
 * A run fires hooks from three places — the event handlers (plugin
 * onAssistantMessage / onSubagentStop, CC Notification), the permission gate,
 * and the confirm requester it builds — and each needs the SAME seven values:
 * who is running (`userId`/`session`), which assistant row the run is writing
 * (`assistantMessageId`), the runner environment, and the two hook runtimes
 * (plugin lifecycle hooks + the CC declarative-hook runtime) with their logging
 * options. Each of the three used to re-declare the bundle; they now extend it,
 * so adding a hook runtime is one edit, not three.
 */
import type { LoadedPluginHook } from '../../../plugins/loader'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { SessionRecord } from '../../repository'
import type { RunEnv } from './types'

/** Logging/identity options the plugin hook runners take. */
export interface HookRunOptions {
  sessionId: string
  logger: { warn: (m: string) => void }
}

export interface RunHookContext {
  env: RunEnv
  userId: string
  session: SessionRecord
  /** Stable participant address for this run; independent of roster order. */
  agentId: string
  /** Authoritative parent-walk result. Null means corrupt/missing ancestry: HITL fails closed. */
  hitlTargetSessionId: string | null
  /** The assistant row this run is writing (re-pointed by a mid-run steer split). */
  assistantMessageId: string
  /** Plugin lifecycle hooks loaded for this run. */
  pluginHooksForRun: readonly LoadedPluginHook[]
  hookRunOptions: HookRunOptions
  /** Per-run CC declarative-hooks runtime — fires the observer-only Notification. */
  ccHooks: CcHooksRuntime
}
