import type { AgentTool } from '@localixai/agent/agents'

import { wrapToolsWithStuckRunBreaker } from '../../../agent-core/tools/stuck-run-breaker'
import { wrapToolsWithTimeoutPromoter } from '../../../agent-core/tools/timeout-promoter'
import { wrapToolsWithCcHooks } from '../../../cc-hooks'
import { wrapToolsWithHooks } from '../../../plugins/hooks'
import { wrapToolsWithMods, type ModRunScope } from '../../../mods/run-scope'
import { wrapToolsWithPermissionGate, type ChainGate } from './chain-gate'

/**
 * The wrapper chain, innermost-first, as a value rather than a sentence.
 *
 * Anything that DESCRIBES the assembly (the composition dump) reads this list instead of
 * restating the order in prose. Each entry names the FUNCTION it stands for as well as its
 * label, so the link is mechanical: a test asserts this set equals the set of
 * `wrapToolsWith*` calls in `tool-assembly.ts`, which is what makes adding a wrapper without
 * listing it here a failing test rather than a quietly wrong report.
 *
 * It lives apart from the assembly because it is a DESCRIPTION of it, and because folding it
 * in pushed that file past the repo's size ratchet. `applyToolWrapperChain` below builds what
 * the list describes, so the two cannot disagree.
 */
export const TOOL_WRAPPER_CHAIN = [
  { wrapper: 'wrapToolsWithPermissionGate', label: 'permission-gate' },
  { wrapper: 'wrapToolsWithHooks', label: 'plugin-hooks' },
  { wrapper: 'wrapToolsWithCcHooks', label: 'cc-hooks' },
  { wrapper: 'wrapToolsWithMods', label: 'mods' },
  { wrapper: 'wrapToolsWithTimeoutPromoter', label: 'timeout-promoter' },
  { wrapper: 'wrapToolsWithStuckRunBreaker', label: 'stuck-run-breaker' },
] as const

/**
 * Apply the chain, in the order this module declares it.
 *
 * Here rather than at the assembly site, so the order and its application cannot disagree:
 * the list above is what the composition dump reports, and a chain that was described in one
 * place and built in another is the drift the anti-drift test exists to catch.
 *
 * Why the order is what it is:
 *  - the permission gate innermost, and only for a run whose mods hear `tool.call` or
 *    `tool.check` (otherwise it is the loop's `beforeToolCall`, before every wrapper): Claude
 *    Code decides a call after the `tool.call` and `PreToolUse` hooks (`chain-gate.ts`);
 *  - plugin hooks next, then CC hooks, so a PreToolUse deny happens before anything
 *    downstream gets to observe or time the call;
 *  - mods around them: a mod's `tool.call` reaches the settings hooks through `next`, as in
 *    Claude Code, and may answer or refuse before they run;
 *  - the timeout promoter next, so the breaker sees a promotion as the ordinary non-error
 *    result it is rather than as the timeout it replaced;
 *  - the stuck-run breaker outermost: it is also where a THROWN tool error becomes a result
 *    (the agent loop's own conversion happens outside this chain), so it counts every failure.
 */
export function applyToolWrapperChain(
  tools: readonly AgentTool[],
  input: {
    pluginHooks: Parameters<typeof wrapToolsWithHooks>[1]
    pluginHookOptions: Parameters<typeof wrapToolsWithHooks>[2]
    ccHooks: Parameters<typeof wrapToolsWithCcHooks>[1]
    logger: Parameters<typeof wrapToolsWithCcHooks>[2]
    /** Claude Code mods enabled for the run; absent where a run has none. */
    mods?: ModRunScope
    /** The run's permission gate, when it sits inside the chain (`chain-gate.ts`). */
    gate?: ChainGate
    observe?: (event: {
      toolName: string
      input: unknown
      result: { content: string; details?: unknown }
      sessionId: string
    }) => void
    sessionId?: string
  },
): AgentTool[] {
  const observed =
    input.observe && input.sessionId
      ? tools.map((tool) => ({
          ...tool,
          async execute(...args: Parameters<AgentTool['execute']>) {
            const result = await tool.execute(...args)
            try {
              input.observe?.({
                toolName: tool.name,
                input: args[1],
                result,
                sessionId: input.sessionId!,
              })
            } catch (error) {
              input.logger?.warn(`External agent observation failed: ${String(error)}`)
            }
            return result
          },
        }))
      : tools
  const gated = wrapToolsWithPermissionGate(observed, input.gate)
  const hooked = wrapToolsWithHooks(gated, input.pluginHooks, input.pluginHookOptions)
  const ccHooked = wrapToolsWithCcHooks(hooked, input.ccHooks, input.logger)
  const modded = input.mods ? wrapToolsWithMods(ccHooked, input.mods) : ccHooked
  return wrapToolsWithStuckRunBreaker(wrapToolsWithTimeoutPromoter(modded))
}
