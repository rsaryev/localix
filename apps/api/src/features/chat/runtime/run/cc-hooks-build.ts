/**
 * Per-run Claude Code declarative-hook runtime.
 *
 * `buildRunCcHooks` is the single semantic call the run backbone makes to get a
 * live `CcHooksRuntime` (plus the once-per-session SessionStart context). It hides
 * what a caller should not have to reason about:
 *
 *  - the REGISTRY: enabled plugins' `hooks/hooks.json`, merged with this run's
 *    SCOPED frontmatter hooks (a skill's or a delegated sub-agent's `hooks` block);
 *  - the per-session `once` tracker, which outlives the per-run runtimes;
 *  - the three hook EVALUATORS (prompt / agent / mcp_tool) — see cc-hook-evaluators.ts;
 *  - the SessionStart fire, which must happen exactly once per session and never on
 *    a continuation segment.
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never
 * features/chat/service*.
 */
import type { AvailabilityReader } from '../../../capabilities/availability'
import type { ResolvedCapabilities } from '../../../capabilities/resolve'
import {
  buildCcHookRegistry,
  createCcHooksRuntime,
  parseScopedHooks,
  mergeCcHookRegistries,
  type CcHooksRuntime,
} from '../../../cc-hooks'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { SessionRecord } from '../../repository'
import { applyHookSessionTitle } from '../hook-session-title'
import {
  createAgentHookRunner,
  createMcpHookCaller,
  createPromptHookEvaluator,
} from './cc-hook-evaluators'
import type { RunCatalog, RunEnv, RunParams } from './types'
import { ccPermissionMode, ccSessionEnvFilesOf, ccSubagentOf } from './cc-hook-session-facts'
import { claudeCodeHome } from '../../../cc-settings/config-dir'
import { claudeCodeSettingsEnv } from '../../../cc-settings/settings-env'
import { readSettingsFileLayers } from '../../../cc-settings/settings-files'
import { settingsHooks } from '../../../cc-settings/settings-hooks'
import { applyHttpHookPolicy } from '../../../cc-hooks/http-policy'
import { claudeCodeTrusts } from '../../../cc-settings/settings-trust'
import { ccBackgroundWork, ccRunFacts } from './cc-hook-run-facts'
import { createCcTranscript } from './cc-transcript'
import { sessionStartSource } from './cc-session-start-source'
import {
  ccHookNoticeEmitter,
  ccHooksConsoleLogger,
  ensureCcHookOnceKeys,
  instructionFilesForHooks,
  isUserInstructionFile,
} from './cc-hooks-build-helpers'

export { instructionFilesForHooks } from './cc-hooks-build-helpers'
import type { PermissionMode } from '../../../../contracts/permission-modes'

export interface BuildRunCcHooksInput {
  signal?: AbortSignal
  env: RunEnv
  userId: string
  session: SessionRecord
  speakerAgentId: string
  params: RunParams
  catalog: RunCatalog
  /** Model this run resolved to — the fallback for a prompt hook that names none. */
  effectiveModelId: string
  defaultCwd: string
  disabledTools: string[]
  /** What the run's rules say about its MCP servers. */
  availability: AvailabilityReader
  capabilities: ResolvedCapabilities
  loadedPlugins: LoadedPlugins
  /** A continuation segment never re-fires SessionStart. */
  isContinuation: boolean
  /** The instruction files this run's prompt carries (InstructionsLoaded, with SessionStart). */
  contextFiles?: readonly { path: string }[]
  /** The run's permission mode (its policy), reported to hooks as `permission_mode`. */
  permissionMode?: PermissionMode
  /** The speaker's reasoning effort, reported to hooks as `effort.level`. */
  effort?: string
  /** Whether a person can answer this run; `false` is Claude Code's non-interactive mode. */
  interactive?: boolean
}

export interface RunCcHooks {
  ccHooks: CcHooksRuntime
  /**
   * SessionStart stdout/additionalContext (once per session), plus what a between-run hook left
   * for the next request (PostModelSwitch) — injected into the model context.
   */
  ccSessionStartContext?: string
  /** A SessionStart `initialUserMessage`, kept only for a run nobody types into. */
  ccInitialUserMessage?: string
  /** A SessionStart hook asked to scan the skill folders again. */
  ccReloadSkills?: boolean
}

export async function buildRunCcHooks(input: BuildRunCcHooksInput): Promise<RunCcHooks> {
  const {
    env,
    userId,
    session,
    speakerAgentId,
    params,
    catalog,
    effectiveModelId,
    defaultCwd,
    disabledTools,
    availability,
    loadedPlugins,
    isContinuation,
  } = input
  const { deps } = env
  const { ccHooksStartedSessions, ccHooksSessionStartSource, ccHookOnceKeys, ccHookSessions } =
    env.state
  const onceKeys = ensureCcHookOnceKeys(ccHookOnceKeys, session.id)
  const emitNotice = ccHookNoticeEmitter(deps.streamRegistry, userId, session.id)
  const envFiles = ccSessionEnvFilesOf(session, deps.sessionDataRoot)
  // Claude Code's settings `env` for this folder reaches every hook process.
  const settingsEnv = claudeCodeSettingsEnv({ homeDir: claudeCodeHome(), cwd: defaultCwd })
  const transcript = createCcTranscript({
    repo: env.repo,
    userId,
    session,
    cwd: defaultCwd,
    dataRoot: deps.sessionDataRoot,
    warn: ccHooksConsoleLogger.warn,
  })
  const subagent = ccSubagentOf(session, speakerAgentId)

  // Claude Code's settings files add their own `hooks`, and may hold plugins' back
  // (`disableAllHooks`, `allowManagedHooksOnly`).
  const settingsInput = { homeDir: claudeCodeHome(), cwd: defaultCwd }
  const fromSettings = settingsHooks(readSettingsFileLayers(settingsInput), {
    projectTrusted: claudeCodeTrusts(settingsInput),
  })
  const { registry: ccHookRegistry } = await buildCcHookRegistry({
    projectDir: defaultCwd,
    pluginHooks: loadedPlugins.ccHooks.filter((plugin) =>
      fromSettings.pluginAllowed(plugin.pluginName),
    ),
    settingsHooks: fromSettings.blocks,
  })
  applyHttpHookPolicy(ccHookRegistry, fromSettings.http)
  // The session's own hooks — before this run's scoped ones merge in — are what its between-run
  // events fire (a model switch, a project move, a watched file). See cc-hook-sessions.ts.
  ccHookSessions.remember(session.id, {
    registry: structuredClone(ccHookRegistry),
    projectDir: defaultCwd,
    onceKeys,
    emitNotice,
    envFiles,
    settingsEnv,
    transcript,
  })
  // Run-SCOPED frontmatter hooks: a skill's or a delegated sub-agent's `hooks`
  // block, active only for THIS run (merged in, converting Stop→SubagentStop for
  // a sub-agent). Same window as `scope.extraDisabledTools`. A converted SubagentStop
  // is fired by finalize on the sub-agent's own completion (`scope.ccScopedHooks`).
  // A skill's hooks (`lifetime: 'session'`) stay for the session's later runs as well; the skill
  // tool registers them the same way (`runtime-tool-instances.ts`).
  for (const scoped of params.scope.ccScopedHooks ?? [])
    if (scoped.lifetime === 'session') ccHookSessions.addSkillHooks(session.id, scoped)
  const scopedHooks = [
    ...ccHookSessions.skillHooks(session.id),
    ...(params.scope.ccScopedHooks ?? []).filter((scoped) => scoped.lifetime !== 'session'),
  ]
  for (const scoped of fromSettings.frontmatterAllowed ? scopedHooks : []) {
    mergeCcHookRegistries(
      ccHookRegistry,
      parseScopedHooks(scoped.raw, scoped.source, {
        projectDir: defaultCwd,
        asSubagent: scoped.asSubagent,
        ...(scoped.plugin ? { plugin: scoped.plugin } : {}),
      }),
    )
  }

  // The http allowlist holds a skill's or an agent's http hooks too.
  applyHttpHookPolicy(ccHookRegistry, fromSettings.http)

  const ccHooks: CcHooksRuntime = createCcHooksRuntime({
    signal: input.signal,
    registry: ccHookRegistry,
    sessionId: session.id,
    projectDir: defaultCwd,
    enabled: true,
    ...(input.permissionMode ? { permissionMode: ccPermissionMode(input.permissionMode) } : {}),
    ...ccRunFacts(params, input.effort, effectiveModelId),
    backgroundWork: () => ccBackgroundWork(env.state.work, userId, session.id),
    // A delegated child's hooks fire inside its subagent (`agent_id`, `agent_type`).
    ...(subagent ? { agent: subagent } : {}),
    envFiles,
    settingsEnv,
    transcript,
    logger: ccHooksConsoleLogger,
    // Per-session `once` tracker (survives across the per-run runtimes).
    onceKeys,
    evaluatePromptHook: createPromptHookEvaluator({
      env,
      userId,
      session,
      agentId: speakerAgentId,
      catalog,
      effectiveModelId,
    }),
    runAgentHook: createAgentHookRunner({ userId, session, agentId: speakerAgentId }),
    callMcpTool: createMcpHookCaller({
      env,
      userId,
      session,
      agentId: speakerAgentId,
      loadedPlugins,
      defaultCwd,
      disabledTools,
      availability,
      capabilities: input.capabilities,
    }),
    // asyncRewake: a background hook that exits 2 wakes this session with the rewake message —
    // an exit notice armed as the hook starts, like a `notify` job's, so the wake is exactly one
    // delivery. None is owed after a restart: a hook's silence is its passing case.
    rewake: async () =>
      (await env.deps.exitNotices?.arm({
        userId,
        sessionId: session.id,
        agentId: speakerAgentId,
        source: 'hook',
      })) ?? null,
    // An `async` hook that exited 0 speaks to Claude on the session's next turn (below).
    onAsyncContext: (text) => ccHookSessions.appendAsyncContext(session.id, text),
    emitNotice,
  })

  // SessionStart CC hooks — once per session (their stdout/additionalContext is
  // injected into the model context alongside the prompt). Continuation runs
  // (for example a checkpoint-recovery rerun) never re-fire it.
  let ccSessionStartContext: string | undefined
  let started: Awaited<ReturnType<CcHooksRuntime['runSessionStart']>> = {}
  if (ccHooks.active && !isContinuation && !ccHooksStartedSessions.has(session.id)) {
    ccHooksStartedSessions.add(session.id)
    // Source of THIS SessionStart: a pending `clear`/`compact` recorded when the view was reset
    // by `/clear` or rewritten by a context checkpoint (consumed once), else `startup`, `fork`
    // or `resume` (the session ran before this process) — `cc-session-start-source.ts`.
    const startSource = await sessionStartSource(
      session,
      deps.sessionDataRoot,
      ccHooksSessionStartSource.get(session.id),
    )
    ccHooksSessionStartSource.delete(session.id)
    started = await ccHooks.runSessionStart(startSource)
    ccSessionStartContext = started.additionalContext
    if (started.watchPaths) ccHookSessions.setWatchPaths(session.id, started.watchPaths)
    await applyHookSessionTitle(deps, userId, session.id, started.sessionTitle)
    // The instruction files load with the session, and again after a checkpoint rewrote the
    // view (CC's `compact`). Observability only: never awaited. An `AGENTS.md` read directly
    // fires nothing, as in Claude Code (hooks.md, InstructionsLoaded).
    const loadReason = startSource === 'compact' ? 'compact' : 'session_start'
    for (const file of instructionFilesForHooks(input.contextFiles))
      void ccHooks.runInstructionsLoaded({
        path: file.path,
        memoryType: isUserInstructionFile(file.path) ? 'User' : 'Project',
        loadReason,
      })
  }
  // A between-run hook's context (PostModelSwitch) and what finished `async` hooks said reach the
  // model with this request.
  const queued = ccHookSessions.takeContext(session.id)
  if (queued) ccSessionStartContext = [ccSessionStartContext, queued].filter(Boolean).join('\n\n')

  return {
    ccHooks,
    ccSessionStartContext,
    // "used as the first user message of the session, in non-interactive mode" (hooks.md).
    ...(started.initialUserMessage && input.interactive === false
      ? { ccInitialUserMessage: started.initialUserMessage }
      : {}),
    ...(started.reloadSkills ? { ccReloadSkills: true } : {}),
  }
}

// ---- What every runtime is constructed with -------------------------------------
