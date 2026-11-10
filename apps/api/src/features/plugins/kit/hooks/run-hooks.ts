import type { HookObserver, PluginSession } from '@rsaryev/llx-plugin'
import type { CcHooksRuntime } from '../../../cc-hooks/runtime-contracts'
import {
  lateMcpCaller,
  lateModelRunner,
  type McpCallByName,
  type ModelBackend,
} from '../ports/session-ports'
import { joinContext } from '../../../cc-hooks/runtime-results'
import { createKitHooksRuntime, type KitHooksRuntimeOptions } from './runtime'
import { registerScopedHooks, type ScopedHooksBlock } from './scoped'

/** What one run of a chat gives its hooks beyond the session. */
export interface RunHooksInput extends KitHooksRuntimeOptions {
  readonly promptId?: string
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** A delegated child's hooks fire inside its subagent (`agent_id`, `agent_type`). */
  readonly agent?: { readonly id: string; readonly type: string }
  readonly interactive?: boolean
  /** The run's models, for `prompt` and `agent` hooks. */
  readonly models?: ModelBackend
  /** The run's MCP tools, for `mcp_tool` hooks. */
  readonly mcp?: McpCallByName
  /** A hook's `statusMessage` while it runs. */
  readonly onHookStatus?: (message: string, active: boolean) => void
  /** The run's scoped blocks (a skill's, an agent's frontmatter `hooks`). */
  readonly scoped: readonly ScopedHooksBlock[]
  /** The prefixes the chat's last run registered (`RunHooks.scopedPrefixes`). */
  readonly previousScoped: readonly string[]
}

export interface RunHooks {
  readonly ccHooks: CcHooksRuntime
  /** The same session outside a run: none of a run's own blocks. */
  readonly betweenRuns: () => CcHooksRuntime
  readonly scopedPrefixes: string[]
  /** What finished `async` hooks left for Claude since the last turn. */
  readonly background: string | undefined
}

function statusObserver(onHookStatus: RunHooksInput['onHookStatus']): HookObserver | undefined {
  if (!onHookStatus) return undefined
  const shown = new Map<string, string>()
  return {
    started({ handlerId, statusMessage }) {
      if (!statusMessage) return
      shown.set(handlerId, statusMessage)
      onHookStatus(statusMessage, true)
    },
    finished({ handlerId }) {
      const message = shown.get(handlerId)
      if (message === undefined) return
      shown.delete(handlerId)
      onHookStatus(message, false)
    },
  }
}

/** The run's hooks: the chat's kit session as a turn of this run, its scoped blocks registered. */
export function openRunHooks(session: PluginSession, input: RunHooksInput): RunHooks {
  const scopedPrefixes = registerScopedHooks(session, input.scoped, input.previousScoped)
  const observer = statusObserver(input.onHookStatus)
  const { models, mcp } = input
  const turn = session.withTurn({
    ...(input.promptId ? { promptId: input.promptId } : {}),
    ...(input.effort ? { effort: { level: input.effort } } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.interactive === undefined ? {} : { interactive: input.interactive }),
    ports: {
      ...(models ? { models: lateModelRunner(() => models) } : {}),
      ...(mcp ? { mcp: lateMcpCaller(() => mcp) } : {}),
      ...(observer ? { observer } : {}),
    },
  })
  const delivered = session.takeBackground()
  const { cwd, transcript, emitNotice } = input
  return {
    ccHooks: createKitHooksRuntime(turn, input),
    betweenRuns: () =>
      createKitHooksRuntime(session, {
        cwd,
        ...(transcript ? { transcript } : {}),
        ...(emitNotice ? { emitNotice } : {}),
        sourcesOnly: ['settings', 'plugin', 'session'],
      }),
    scopedPrefixes,
    background: joinContext([...delivered.systemMessages, ...delivered.additionalContext]),
  }
}
