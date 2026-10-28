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
import { isToolDirect, isToolLive } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import { buildDirectToolInstances } from './runtime-tool-instances'
import { buildBrowserOptions } from './browser-options'
import { buildTaskDelegationOptions } from './task-delegation-options'
import { buildAgentOptions } from './agent-options'
import { agentLaunchPorts } from './catalog-agent'
import { buildWorkflowOptions } from './workflow-options'
import { buildStoreOptions } from './store-options'
import { buildConfigureOptions } from './configure-options'
import { buildPlanOptions } from './plan-options'
import type { RuntimeToolWiringContext } from './runtime-tools'
import type { buildRunToolRegistry } from './runtime-tools'

type RegistryParams = Parameters<typeof buildRunToolRegistry>[1]

/**
 * Why a port may be EMPTY, by tool name — the host capability the run turned out not to
 * have, or the policy decision that withheld it. A tool the profile hides never reaches the
 * port builder's own check, and the ledger's shape layer has already said so.
 */
const EMPTY_PORT_CAPABILITY: Readonly<Record<string, string>> = {
  [TOOL.ContextBudget]: 'context.budget',
  [TOOL.Agent]: 'agents.delegate',
  [TOOL.SendMessage]: 'agents.delegate',
  [TOOL.TaskStop]: 'agents.delegate',
  [TOOL.Store]: 'store.service',
  [TOOL.Browser]: 'preview.control',
  [TOOL.Configure]: 'config.proposals',
  [TOOL.Vault]: 'secrets.vault',
  [TOOL.ExternalAgentSessions]: 'external.agents',
  [TOOL.ToolOutput]: 'context.store',
  [TOOL.Plan]: 'plans',
  // A chat that can create children (`workflow-options.ts`).
  [TOOL.Workflow]: 'plugins.workflows',
}

export function explainEmptyPorts(optional: OptionalToolPorts): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, capability] of Object.entries(EMPTY_PORT_CAPABILITY)) {
    if ((optional as Record<string, unknown>)[name] === undefined) out[name] = capability
  }
  return out
}

/**
 * Whether this run can manage background jobs: `jobs` survives the profile and `disabledTools`, on
 * a host that supervises jobs. Background `Bash` launches one only then, and `TaskStop` stops one
 * only then; a launcher without its manager would leave a process nobody can list or stop.
 */
export function manageableJobs(
  params: Pick<RegistryParams, 'agentProfile' | 'disabledTools' | 'policy'>,
): boolean {
  return (
    params.policy.host.supervisesJobs &&
    isToolLive(params.agentProfile, TOOL.Jobs, params.disabledTools)
  )
}

export function buildOptionalToolPorts(
  ctx: RuntimeToolWiringContext,
  params: RegistryParams,
  jobsTool: NonNullable<OptionalToolPorts[typeof TOOL.Jobs]>,
  stopJob: NonNullable<OptionalToolPorts['TaskStop']>['stopJob'],
): { optional: OptionalToolPorts; ledgerRef: { current?: ToolLedger } } {
  const { deps, repo } = ctx
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
    ...(params.forkLive ? { forkLive: params.forkLive } : {}),
  })

  // browser: OPEN + drive the Browser tabs through the injected probe — and a mini app's own view.
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
  // How `Agent` and a workflow's `agent()` create a child: its route and its worktree.
  const pluginAgents = agentLaunchPorts({
    ...(params.agentModelChoices ? { choices: params.agentModelChoices } : {}),
    defaultCwd,
    rootSessionId: session.rootSessionId ?? session.id,
    ...(params.allowedAgentTypes ? { allowedAgentTypes: params.allowedAgentTypes } : {}),
    ...(worktreeHook ? { worktreeHook } : {}),
  })

  const agentPorts = buildAgentOptions({
    userId,
    session,
    reportsToDelegator: params.policy.lineage.reportsToDelegator,
    agentProfile,
    repo,
    taskDelegation,
    plugins: pluginAgents,
    // Background jobs exist only where `jobs` manages them; elsewhere TaskStop is for subagents.
    ...(manageableJobs(params) ? { stopJob } : {}),
  })
  const startAgent = agentPorts.Agent
  const optional: OptionalToolPorts = {
    // A budget the model can read before it overflows.
    ContextBudget: params.readContextBudget
      ? createContextBudgetTool(params.readContextBudget)
      : undefined,
    // Built by their features in bootstrap and bound here, like every other host port.
    Vault: isToolDirect(agentProfile, TOOL.Vault) ? deps.vaultToolFor?.(userId) : undefined,
    ExternalAgentSessions: isToolDirect(agentProfile, TOOL.ExternalAgentSessions)
      ? deps.externalAgents?.toolFor(session.id)
      : undefined,
    ...buildDirectToolInstances({
      agentProfile,
      disabledTools,
      defaultCwd,
      loadedPlugins,
      loadedMiniApps,
      repo,
      contextStore,
      session,
      userId,
      agentId: params.agentId,
      skillOverrides: params.skillOverrides,
      announceCapabilityChange: deps.announceCapabilityChange,
      globalSearch: deps.globalSearch,
      renderSkill: deps.renderSkill,
      ccHookSessions: ctx.ccHookSessions,
      skillCommandPolicy: params.skillCommandPolicy,
      ...(params.latestUserText ? { latestUserText: params.latestUserText } : {}),
      // A `context: fork` skill the agent loads starts a subagent, as `Agent` does.
      ...(startAgent
        ? {
            forkSkill: (toolCallId, request) =>
              startAgent.start(`skill-fork-${toolCallId}`, { ...request, context: 'none' }),
          }
        : {}),
    }),
    Jobs: isToolDirect(agentProfile, TOOL.Jobs) ? jobsTool : undefined,
    ...agentPorts,
    Store: buildStoreOptions(ctx, params),
    Loops: isToolDirect(agentProfile, TOOL.Loops)
      ? { userId, sessionId: session.id, agentId: params.agentId }
      : undefined,
    Browser: browser,
    Configure: buildConfigureOptions({
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
    Plan:
      deps.plans && isToolDirect(agentProfile, TOOL.Plan)
        ? buildPlanOptions(deps.plans, repo, {
            userId,
            rootSessionId: session.rootSessionId ?? session.id,
            agentId: params.agentId,
          })
        : undefined,
    Workflow: buildWorkflowOptions({
      userId,
      session,
      agentProfile,
      taskDelegation,
      scripts: deps.scripts,
      listWorkflows: params.listWorkflows,
      defaultCwd,
      ...(worktreeHook ? { worktreeHook } : {}),
      pluginAgents,
    }),
  }
  return { optional, ledgerRef }
}
