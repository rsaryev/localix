/**
 * The OPTIONAL half of a run's tool registry: every `OptionalToolPorts` key, built from the
 * run, plus the reason for each key the host left empty.
 *
 * Split from `runtime-tools.ts` so that file stays the wiring of the core bag and the call,
 * and this one is the wiring of the ports. The second half of this file — `explainEmptyPorts`
 * — is what turns an absent port from "the tool is simply not there" into a ledger row: a
 * builder that returns `undefined` for a HOST reason names the
 * capability the run lacked, and the model, the settings screen and the
 * composition dump all read that name instead of guessing.
 */
import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import type { ToolLedger } from '../../../agent-core/tool-ledger'
import { createContextBudgetTool } from '../../../agent-core/tools/context-budget'
import { isToolDirect } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import { runPluginBuild } from '../../../plugins/authoring/build-port'
import { buildDirectToolInstances } from './runtime-tool-instances'
import { buildBrowserOptions } from './browser-options'
import { buildTaskDelegationOptions } from './task-delegation-options'
import { buildForkOptions } from './fork-options'
import { buildAgentsOptions } from './agents-options'
import { buildConfigureOptions } from './configure-options'
import { buildPlanOptions } from './plan-options'
import type { RuntimeToolWiringContext } from './runtime-tools'
import type { buildRunToolRegistry } from './runtime-tools'
import { createContextStoreRepository } from '../../../context-store/repository'

type RegistryParams = Parameters<typeof buildRunToolRegistry>[1]

/**
 * Why a port may be EMPTY, by tool name — the host capability the run turned out not to
 * have. Only host reasons: a tool the profile hides never reaches the port builder's own
 * check, and the ledger's shape layer has already said so.
 */
const EMPTY_PORT_CAPABILITY: Readonly<Record<string, string>> = {
  [TOOL.context_budget]: 'context.budget',
  [TOOL.fork]: 'agents.fork',
  [TOOL.agents]: 'agents.registry',
  [TOOL.browser]: 'preview.control',
  [TOOL.configure]: 'config.proposals',
  [TOOL.tool_output]: 'context.store',
  [TOOL.plugin_build]: 'plugins.authoring',
  [TOOL.plan]: 'plans',
}

export function explainEmptyPorts(optional: OptionalToolPorts): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, capability] of Object.entries(EMPTY_PORT_CAPABILITY)) {
    if ((optional as Record<string, unknown>)[name] === undefined) out[name] = capability
  }
  return out
}

export function buildOptionalToolPorts(
  ctx: RuntimeToolWiringContext,
  params: RegistryParams,
  jobsTool: NonNullable<OptionalToolPorts['jobs']>,
): { optional: OptionalToolPorts; ledgerRef: { current?: ToolLedger } } {
  const { deps, repo, memoryRepo } = ctx
  const { userId, session, defaultCwd, disabledTools, agentProfile, loadedPlugins } = params
  const contextStore = createContextStoreRepository(deps.db)
  // Filled by the caller once the registry (and so the ledger) exists — `configure` reads it
  // at call time.
  const ledgerRef: { current?: ToolLedger } = {}
  const taskDelegation = buildTaskDelegationOptions({
    userId,
    session,
    agentId: params.agentId,
    defaultCwd,
    agentProfile,
    repo,
    deps,
    ccHooks: params.ccHooks,
    subagentWork: { work: ctx.work, actionRegistry: ctx.actionRegistry },
    ...(params.currentMessageId ? { currentMessageId: params.currentMessageId } : {}),
  })

  // browser: OPEN + drive the Browser tabs through the injected probe — and a plugin's own view,
  // which is why `plugin_build` is told whether this run can look.
  const browser = buildBrowserOptions({
    deps,
    userId,
    session,
    defaultCwd,
    agentProfile,
  })

  const optional: OptionalToolPorts = {
    // A budget the model can read before it overflows.
    context_budget: params.readContextBudget
      ? createContextBudgetTool(params.readContextBudget)
      : undefined,
    set_topic: params.setTopic,
    handoff: params.handoff,
    ...buildDirectToolInstances({
      agentProfile,
      disabledTools,
      defaultCwd,
      loadedPlugins,
      repo,
      memoryRepo,
      contextStore,
      session,
      userId,
      agentId: params.agentId,
      skillOverrides: params.skillOverrides,
      memoryScope: params.memoryScope,
      announceCapabilityChange: deps.announceCapabilityChange,
    }),
    jobs: isToolDirect(agentProfile, TOOL.jobs) ? jobsTool : undefined,
    fork: buildForkOptions({ userId, session, agentProfile, taskDelegation }),
    agents: buildAgentsOptions(ctx, params),
    loops: isToolDirect(agentProfile, TOOL.loops)
      ? { userId, sessionId: session.id, agentId: params.agentId }
      : undefined,
    plugin_build:
      deps.pluginAuthoring && isToolDirect(agentProfile, TOOL.plugin_build)
        ? {
            run: (input) =>
              runPluginBuild(deps.pluginAuthoring!, userId, input, {
                // The host port can exist while policy or the model still withholds the tool.
                // Read the final registry verdict when the build is called.
                canLook:
                  browser !== undefined && ledgerRef.current?.get(TOOL.browser)?.state === 'live',
              }),
          }
        : undefined,
    browser,
    configure: buildConfigureOptions({
      deps,
      userId,
      session,
      agentId: params.agentId,
      agentProfile,
      ledgerRef,
    }),
    // The conversation's plan lives on its ROOT, whose mode an approval changes. Absent in a host
    // that did not compose plans; the ledger then names `plans` as what the run lacked.
    plan:
      deps.plans && isToolDirect(agentProfile, TOOL.plan)
        ? buildPlanOptions(deps.plans, repo, {
            userId,
            rootSessionId: session.rootSessionId ?? session.id,
            agentId: params.agentId,
          })
        : undefined,
  }
  return { optional, ledgerRef }
}
