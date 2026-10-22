import {
  createRuntimeToolRegistry,
  type RuntimeToolRegistry,
} from '../../../agent-core/tool-registry'
import type { FileMtimeStore } from '../../../agent-core/tools/file/file-utils'
import type { ContextBudgetReading } from '../../../agent-core/tools/context-budget'
import { isToolLive, type RunProfile } from '../../../agent-core/run-shape'
import type { PolicyDenial } from '../../../agent-core/tool-ledger'
import type { ToolLedger } from '../../../agent-core/tool-ledger'
import type { loadUserSettingsContext } from '../../../user/runtime-settings'
import type { SpawnTerminalJob } from '../../../agent-core/tools/terminal/terminal-job'
import { announcePtyOpen } from './pty-announce'
import { buildTerminalToolOptions } from './terminal-tool-options'
import { buildJobsTool } from './jobs-tool'
import { buildOptionalToolPorts, explainEmptyPorts } from './runtime-tool-ports'
import { ccSessionEnvScripts, type CcHooksRuntime } from '../../../cc-hooks'
import { ccSessionEnvFilesOf } from './cc-hook-session-facts'
import type { createEnvironment } from '../../../agent-core/tools/environments'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { RunnerDeps } from '../agent-runner-types'
import { buildFileToolPorts } from './file-tool-ports'
import { parseLspServersConfig, configuredLspServer, withoutBuiltinOverlap } from '../../../lsp'
import type { RuntimeState } from '../agent-runner-state'
import type { ChatRepository, SessionRecord } from '../../repository'
import type { createMemoryRepository } from '../../../memory/repository'
import type { ToolSurface } from '@localixai/agent/agents'
import type { SkillOverrides } from '../../../agent-core/skill-overrides'
import type { ToolDenial } from '../../../capabilities/resolve'
import type { SetTopicPort } from '../../../agent-core/tools/set-topic'
import type { MemoryScope } from '../../../agent-core/memory-scope-policy'
import type { RunPolicy } from '../../policy/run-policy'
import type { WorkflowEntry } from '../../../agent-core/tools/workflow/workflow'
import type { ChatModel } from '../../../agent-core/tools/workflow/agent-route'
import type { SkillCommandPolicyRef } from './skill-tool-ports'

export interface RuntimeToolWiringContext {
  deps: RunnerDeps
  repo: ChatRepository
  memoryRepo: ReturnType<typeof createMemoryRepository>
  work: RuntimeState['work']
  /** Where a detached sub-agent registers its Stop — the same owner-gated map as a job's kill. */
  actionRegistry: RuntimeState['actionRegistry']
  terminalWaits: RuntimeState['terminalWaits']
  executeToolAction: (toolCallId: string, actionName: string, payload?: unknown) => boolean
  /** Where a skill the model loads registers its hooks for the rest of the session. */
  ccHookSessions?: RuntimeState['ccHookSessions']
}

// Small plugin surfaces stay direct. Larger workbench stacks are indexed and
// activated on demand so unrelated schemas do not tax every request.

/**
 * Assemble the per-run tool registry: the core bag here, the optional ports in
 * `runtime-tool-ports.ts`, and the ledger that says why anything is missing.
 */
export function buildRunToolRegistry(
  ctx: RuntimeToolWiringContext,
  params: {
    userId: string
    /** The run's policy: which host it runs in, which seat it holds, who may be invited. */
    policy: RunPolicy
    /** Present for the leader or sole participant of a chat. */
    setTopic?: SetTopicPort
    /** The run's live assistant row (a steering split re-points it). */
    currentMessageId?: () => string
    session: SessionRecord
    /** The agent taking this turn — whose rules decided everything below. */
    agentId: string
    env: ReturnType<typeof createEnvironment>
    defaultCwd: string
    disabledTools: string[]
    /** The denying rule behind each `disabledTools` entry — the ledger's policy reason. */
    toolDenials?: readonly ToolDenial[]
    agentProfile: RunProfile
    loadedPlugins: LoadedPlugins
    toolSurface?: ToolSurface
    /** Whether a decision model answers for this user now: the browser offers `goal` only then. */
    decisionsAvailable?: boolean
    /** Resolved user settings for this run — supplies keyless research safety policy. */
    agentSettings?: Awaited<ReturnType<typeof loadUserSettingsContext>>['agentSettings']
    /**
     * Skill visibility for this run, already resolved.
     *
     * Its own parameter rather than a field of `agentSettings`: it is not a setting any more,
     * it is the capability resolver's answer for this scope and agent, and riding on the
     * settings object made it look like something a user profile stores.
     */
    skillOverrides?: SkillOverrides
    memoryScope?: MemoryScope
    /** Already-fetched model catalog, reused by delegated-child route resolution. */
    catalog: Awaited<ReturnType<RunnerDeps['catalogService']['getCatalog']>>
    /** What this run's model reads — the ledger's `model` layer (see ResolvedTurn.modelInput). */
    modelInput?: readonly string[]
    /** Per-run CC-hook runtime → delegate fires SubagentStart/SubagentStop. */
    ccHooks?: CcHooksRuntime
    /** Session-scoped read/write bookkeeping for the file tools' guards. */
    fileMtimes?: FileMtimeStore
    /** The host's live budget frame + last measurement for `context_budget`; read at call time. */
    readContextBudget?: () => ContextBudgetReading | undefined
    /** The enabled plugins' workflows, read when `workflow` runs one. */
    listWorkflows?: () => Promise<WorkflowEntry[]>
    /** The chat's resolved model this turn: a workflow agent's `model` resolves against it. */
    chatModel?: ChatModel
    /** Filled by the run's gate: the rules a skill's injected commands are checked against. */
    skillCommandPolicy?: SkillCommandPolicyRef
  },
): RuntimeToolRegistry & { setLedger?: (ledger: ToolLedger) => void } {
  const { deps, work, terminalWaits } = ctx
  const { userId, session, env, defaultCwd, disabledTools, agentProfile, loadedPlugins } = params

  // Register enabled plugins' Claude Code LSP servers (`lspServers`) with the LSP
  // feature, scoped to this project root. Only ENABLED plugins reach loadedPlugins,
  // so this honors the plugin trust gate. Idempotent per turn — setPluginServers
  // REPLACES the root's set; already-running servers are left untouched.
  if (deps.lspManager) {
    const pluginLspDefs = loadedPlugins.lspServers.flatMap(({ pluginName, servers }) =>
      // A built-in server keeps the extensions it already owns (see lsp-plugin-notes.ts).
      Object.entries(parseLspServersConfig(servers)).flatMap(([id, cfg]) => {
        const own = withoutBuiltinOverlap(cfg)
        return own ? [configuredLspServer(`${pluginName}:${id}`, own)] : []
      }),
    )
    deps.lspManager.setPluginServers(defaultCwd, pluginLspDefs)
  }

  const jobsTool = buildJobsTool({
    deps,
    work,
    userId,
    sessionId: session.id,
    terminalInput: deps.terminalControl != null && isToolLive(agentProfile, 'bash', disabledTools),
    runAction: (toolCallId, action, payload) => ctx.executeToolAction(toolCallId, action, payload),
  })

  // Background bash spawns a long-running job the model can only inspect or kill
  // through the `jobs` tool. So `background` is only safe to expose when `jobs`
  // will actually be in the final registry: the profile must expose it AND it
  // must survive `disabledTools` (a scope can switch `jobs` off). Without this the
  // model could launch a job it can't list, read, or stop — an orphaned,
  // unmanageable process. Pair the launcher with its manager.
  // (A job's own runs never get background regardless — no host is watching.)
  const jobsManageable =
    params.policy.host.supervisesJobs && isToolLive(agentProfile, 'jobs', disabledTools)

  const { optional, ledgerRef } = buildOptionalToolPorts(ctx, params, jobsTool)
  const toolDenials = new Map<string, PolicyDenial>(
    (params.toolDenials ?? []).map((denial) => [denial.name, { rule: denial.rule }]),
  )

  const registry = createRuntimeToolRegistry({
    policy: {
      toolSurface: params.toolSurface,
      disabledTools,
      toolDenials,
      missingCapabilities: explainEmptyPorts(optional),
      withheldByHost: params.policy.human.withheldTools,
      agentProfile,
      modelInput: params.modelInput,
      // Native plugin tools (in-process). They flow through the same disabledTools
      // filtering as built-ins and are available from the first turn. Which SHAPES get
      // them is each tool's own `exposure` (plugin default: chat only), read by the ledger.
      extraTools: [
        ...loadedPlugins.tools,
        ...(deps.externalAgents ? [deps.externalAgents.toolFor(session.id)] : []),
        ...(deps.vaultToolFor ? [deps.vaultToolFor(userId)] : []),
      ],
    },
    core: {
      env,
      defaultCwd,
      // Bind the PTY-job host (when wired) to this user + session so background
      // bash jobs open as interactive terminal panes, and announce each fresh PTY
      // on the stream so the UI reveals its pane without waiting on the registry
      // poll (see announcePtyOpen).
      spawnTerminalJob: deps.spawnTerminalJob
        ? announcePtyOpen(
            ({ cwd, command, wakesAgent }: Parameters<SpawnTerminalJob>[0]) =>
              deps.spawnTerminalJob!({ userId, sessionId: session.id, cwd, command, wakesAgent }),
            (event) => deps.streamRegistry.publish(userId, session.id, event),
            session.id,
          )
        : undefined,
      terminalControl: buildTerminalToolOptions({
        deps,
        userId,
        session,
        agentId: params.agentId,
        agentProfile,
        terminalWaits,
      }),
      // Enabled plugins' `bin/` directories → appended to PATH for bash subprocesses
      // so bundled plugin CLIs resolve by bare name. Shared by the orchestrator AND
      // sub-agent runs because both build the registry here.
      bashPluginBinDirs: loadedPlugins.binDirs,
      // Claude Code's CLAUDE_ENV_FILE: what SessionStart / CwdChanged / FileChanged hooks export
      // reaches every later command of the session.
      bashEnvScripts: ccSessionEnvScripts(ccSessionEnvFilesOf(session)),
      // Research is tokenless. Only its SSRF policy is configurable; every search
      // engine works without secrets and every page/redirect passes the same guard.
      researchConfig: {
        allowPrivate: params.agentSettings?.research?.allowPrivate ?? false,
      },
      // Role profiles further restrict this (subagents hide background/notify at
      // the schema layer). Gated on `jobsManageable` so a run that can't manage a
      // background job (a scope can switch `jobs` off) also can't launch one.
      allowBackgroundBash: jobsManageable,
      // `bash until`: the poll-and-wake engine. Gated on `jobsManageable` for the reason
      // background bash is — a wait the model cannot list or stop is an unmanageable process.
      // Stays available to an orchestrator: waiting on external CI is exactly the
      // event-driven discipline a delegating conversation already runs on.
      bashWaitHost:
        deps.monitors && jobsManageable
          ? {
              start: (toolCallId, spec, hooks) =>
                deps.monitors!.start(
                  { userId, sessionId: session.id, agentId: params.agentId, toolCallId },
                  spec,
                  hooks,
                ),
              stop: (waitId) => deps.monitors!.stop(userId, session.id, waitId),
            }
          : undefined,
      ...buildFileToolPorts({ deps, defaultCwd, userId }),
      fileMtimes: params.fileMtimes,
    },
    optional,
  })
  ledgerRef.current = registry.ledger
  return {
    ...registry,
    setLedger: (ledger: ToolLedger) => {
      ledgerRef.current = ledger
    },
  }
}
