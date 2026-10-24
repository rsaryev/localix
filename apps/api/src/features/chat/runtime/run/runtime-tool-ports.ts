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
import { runMiniAppBuild } from '../../../mini-apps/authoring/build-port'
import { buildDirectToolInstances } from './runtime-tool-instances'
import { buildBrowserOptions } from './browser-options'
import { buildTaskDelegationOptions } from './task-delegation-options'
import { buildDelegateOptions } from './delegate-options'
import { delegatePluginPorts } from './plugin-subagent'
import { withBuiltinSubagentTypes } from './builtin-subagent-types'
import { buildWorkflowOptions } from './workflow-options'
import { buildAgentsOptions } from './agents-options'
import { buildConfigureOptions } from './configure-options'
import { buildPlanOptions } from './plan-options'
import type { RuntimeToolWiringContext } from './runtime-tools'
import type { buildRunToolRegistry } from './runtime-tools'
import { createSkipAnswerTool } from '../../../agent-core/tools/skip-answer'

type RegistryParams = Parameters<typeof buildRunToolRegistry>[1]

/**
 * Why a port may be EMPTY, by tool name — the host capability the run turned out not to
 * have, or the policy decision that withheld it. A tool the profile hides never reaches the
 * port builder's own check, and the ledger's shape layer has already said so.
 */
const EMPTY_PORT_CAPABILITY: Readonly<Record<string, string>> = {
  [TOOL.context_budget]: 'context.budget',
  [TOOL.delegate]: 'agents.delegate',
  [TOOL.agents]: 'agents.registry',
  [TOOL.browser]: 'preview.control',
  [TOOL.configure]: 'config.proposals',
  [TOOL.tool_output]: 'context.store',
  [TOOL.mini_app_build]: 'mini-apps.authoring',
  [TOOL.plan]: 'plans',
  [TOOL.codemode]: 'scripts',
  // Children and a workflow command that activated it (`workflow-options.ts`).
  [TOOL.workflow]: 'plugins.workflows',
  // Seat-bound protocol ports (`chat/policy`): a pass needs a colleague, a topic needs its owner.
  [TOOL.skip_answer]: 'conversation.colleagues',
  [TOOL.set_topic]: 'conversation.topic-owner',
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
  const {
    userId,
    session,
    defaultCwd,
    disabledTools,
    agentProfile,
    loadedPlugins,
    loadedMiniApps,
  } = params
  const { ccHooks } = params
  const contextStore = deps.ports.contextStore
  // Filled by the caller once the registry (and so the ledger) exists — `configure` reads it
  // at call time.
  const ledgerRef: { current?: ToolLedger } = {}
  const taskDelegation = buildTaskDelegationOptions({
    userId,
    session,
    lineage: params.policy.lineage,
    agentId: params.agentId,
    defaultCwd,
    agentProfile,
    repo,
    deps,
    ccHooks: params.ccHooks,
    subagentWork: { work: ctx.work, actionRegistry: ctx.actionRegistry },
    ...(params.currentMessageId ? { currentMessageId: params.currentMessageId } : {}),
  })

  // browser: OPEN + drive the Browser tabs through the injected probe — and a mini app's own view,
  // which is why `mini_app_build` is told whether this run can look.
  const browser = buildBrowserOptions({
    deps,
    userId,
    session,
    defaultCwd,
    agentProfile,
    decisionsAvailable: params.decisionsAvailable,
  })

  // The run's WorktreeCreate hooks make an isolated agent's worktree when it has any (CC).
  const worktreeHook = ccHooks?.hasHooks('WorktreeCreate')
    ? (name: string) => ccHooks.runWorktreeCreate(name)
    : undefined
  // A plugin's agents are subagent types for `delegate` and a workflow's `agent()` alike.
  const pluginAgents = delegatePluginPorts({
    agents: withBuiltinSubagentTypes(loadedPlugins.agents),
    ...(params.chatModel ? { chatModel: params.chatModel } : {}),
    catalog: params.catalog?.models ?? [],
    defaultCwd,
    rootSessionId: session.rootSessionId ?? session.id,
    ...(worktreeHook ? { worktreeHook } : {}),
  })

  const optional: OptionalToolPorts = {
    // A budget the model can read before it overflows.
    context_budget: params.readContextBudget
      ? createContextBudgetTool(params.readContextBudget)
      : undefined,
    set_topic: params.setTopic,
    // Only a colleague can name this participant without asking it anything.
    skip_answer: params.policy.conversation.canPass ? createSkipAnswerTool() : undefined,
    ...buildDirectToolInstances({
      agentProfile,
      disabledTools,
      defaultCwd,
      loadedPlugins,
      loadedMiniApps,
      repo,
      memoryRepo,
      contextStore,
      session,
      userId,
      agentId: params.agentId,
      skillOverrides: params.skillOverrides,
      memoryScope: params.memoryScope,
      announceCapabilityChange: deps.announceCapabilityChange,
      globalSearch: deps.globalSearch,
      renderSkill: deps.renderSkill,
      ccHookSessions: ctx.ccHookSessions,
      skillCommandPolicy: params.skillCommandPolicy,
    }),
    jobs: isToolDirect(agentProfile, TOOL.jobs) ? jobsTool : undefined,
    delegate: buildDelegateOptions({
      userId,
      session,
      agentProfile,
      taskDelegation,
      plugins: pluginAgents,
    }),
    agents: buildAgentsOptions(ctx, params),
    loops: isToolDirect(agentProfile, TOOL.loops)
      ? { userId, sessionId: session.id, agentId: params.agentId }
      : undefined,
    mini_app_build:
      deps.miniAppAuthoring && isToolDirect(agentProfile, TOOL.mini_app_build)
        ? {
            run: (input) =>
              runMiniAppBuild(deps.miniAppAuthoring!, userId, input, {
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
      ccHooks: params.ccHooks,
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
    // Scripts run in the engine's sandbox; an engine without one has no `codemode`.
    codemode: deps.scripts,
    workflow: buildWorkflowOptions({
      userId,
      session,
      agentProfile,
      taskDelegation,
      scripts: deps.scripts,
      listWorkflows: params.listWorkflows,
      ...(params.chatModel ? { chatModel: params.chatModel } : {}),
      catalog: params.catalog?.models ?? [],
      defaultCwd,
      ...(worktreeHook ? { worktreeHook } : {}),
      pluginAgents,
    }),
  }
  return { optional, ledgerRef }
}
