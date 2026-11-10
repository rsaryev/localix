/**
 * A run's Claude Code hooks: the chat's kit session as a turn of this run (`openRunHooks`), the
 * run's scoped frontmatter blocks registered on it (a skill's, a delegated agent's), its models
 * and MCP tools for `prompt`, `agent` and `mcp_tool` hooks, and the SessionStart fire, exactly
 * once per session and never on a continuation segment. The kit selects, gates, runs and merges.
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
import type { AvailabilityReader } from '../../../capabilities/availability'
import type { ResolvedCapabilities } from '../../../capabilities/resolve'
import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../cc-hooks'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { SessionRecord } from '../../repository'
import { applyHookSessionTitle } from '../hook-session-title'
import { createHookModels } from './cc-hook-evaluators'
import type { RunCatalog, RunEnv, RunParams } from './types'
import { ccSubagentOf } from './cc-hook-session-facts'
import { claudeCodeHome } from '../../../cc-settings/config-dir'
import { openRunHooks, readClaudeSettingsSync, type ScopedHooksBlock } from '../../../plugins/kit'
import { ccBackgroundWork, ccRunFacts } from './cc-hook-run-facts'
import { createCcTranscript } from './cc-transcript'
import { publishAgentPhase } from '../session-stream-registry'
import { sessionStartSource } from './cc-session-start-source'
import {
  ccHookNoticeEmitter,
  ccHooksConsoleLogger,
  instructionFilesForHooks,
  isUserInstructionFile,
} from './cc-hooks-build-helpers'
import type { PermissionMode } from '../../../../contracts/permission-modes'
import type { ScopedCcHooks } from '../run-contract'
import { createMcpHookCaller } from './mcp-hook-caller'
import { openChatPluginSession } from './chat-plugin-session'

export interface BuildRunCcHooksInput {
  signal?: AbortSignal
  env: RunEnv
  userId: string
  session: SessionRecord
  agentId: string
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
  /** The agent's reasoning effort, reported to hooks as `effort.level`. */
  effort?: string
  /** Whether a person can answer this run; `false` is Claude Code's non-interactive mode. */
  interactive?: boolean
  /**
   * The frontmatter hooks of the agent this delegated child runs as (`agent-hooks.ts`): scoped to
   * this run like a skill's, and not kept for the session.
   */
  agentHooks?: readonly ScopedCcHooks[]
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
    agentId,
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
  const { ccHooksStartedSessions, ccHooksSessionStartSource, ccHookSessions } = env.state
  // A new turn: the person is back, so no `idle_prompt` is owed for the last reply.
  ccHookSessions.cancelIdle(session.id)
  const emitNotice = ccHookNoticeEmitter(deps.streamRegistry, userId, session.id)
  const settings = readClaudeSettingsSync({ homeDir: claudeCodeHome(), cwd: defaultCwd })
  const transcript = createCcTranscript({
    repo: env.repo,
    userId,
    session,
    cwd: defaultCwd,
    dataRoot: deps.sessionDataRoot,
    warn: ccHooksConsoleLogger.warn,
  })
  // asyncRewake: a background hook that exited 2 wakes this session with its message, as an
  // exit notice delivered once. None is owed after a restart: a hook's silence is its passing case.
  const wake = (text: string) =>
    void env.deps.exitNotices
      ?.arm({ userId, sessionId: session.id, source: 'hook' })
      .then((notice) => notice?.fire(text))
      .catch(() => undefined)
  const kitSession = openChatPluginSession(
    deps.pluginSessions,
    { chatId: session.id, cwd: defaultCwd, settings, plugins: loadedPlugins.kitPlugins },
    transcript.path,
    input.permissionMode,
    wake,
  )
  // No plugin host (a test's runtime): no hooks.
  if (!kitSession) return { ccHooks: INERT_CC_HOOKS }

  // Run-SCOPED frontmatter hooks: a skill's or a delegated sub-agent's `hooks` block, for THIS
  // run (Stop→SubagentStop for a sub-agent, which finalize fires on the child's own completion).
  // A skill's (`lifetime: 'session'`) stays for the session's later runs; the skill tool keeps it
  // the same way (`runtime-tool-instances.ts`).
  for (const scoped of params.scope.ccScopedHooks ?? [])
    if (scoped.lifetime === 'session') ccHookSessions.addSkillHooks(session.id, scoped)
  const scoped = [
    ...ccHookSessions.skillHooks(session.id),
    ...(params.scope.ccScopedHooks ?? []).filter((one) => one.lifetime !== 'session'),
    ...(input.agentHooks ?? []),
  ].map((one) => scopedBlock(one, loadedPlugins))
  const subagent = ccSubagentOf(session)
  const facts = ccRunFacts(params, input.effort, effectiveModelId)
  const run = openRunHooks(kitSession, {
    signal: input.signal,
    cwd: defaultCwd,
    transcript,
    emitNotice,
    backgroundWork: () => ccBackgroundWork(env.state.work, userId, session.id),
    ...(facts.promptId ? { promptId: facts.promptId } : {}),
    ...(facts.effort ? { effort: facts.effort } : {}),
    ...(facts.model ? { model: facts.model } : {}),
    ...(subagent ? { agent: subagent } : {}),
    ...(input.interactive === undefined ? {} : { interactive: input.interactive }),
    models: createHookModels({ env, userId, session, agentId, catalog, effectiveModelId }),
    mcp: createMcpHookCaller({
      env,
      userId,
      session,
      agentId,
      loadedPlugins,
      defaultCwd,
      disabledTools,
      availability,
      capabilities: input.capabilities,
    }),
    // A hook's `statusMessage` is the chat's activity line while it runs.
    onHookStatus: (message, active) =>
      publishAgentPhase(deps.streamRegistry, userId, session.id, 'hook-status', active, message),
    scoped,
    previousScoped: ccHookSessions.scopedPrefixes(session.id),
  })
  ccHookSessions.setScopedPrefixes(session.id, run.scopedPrefixes)
  // The session's own hooks are what its between-run events fire (a model switch, a project
  // move, a watched file). See cc-hook-sessions.ts.
  ccHookSessions.remember(session.id, { runtime: run.betweenRuns, projectDir: defaultCwd })
  const ccHooks: CcHooksRuntime = run.ccHooks

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
  const queued = [ccSessionStartContext, ccHookSessions.takeContext(session.id), run.background]
  ccSessionStartContext = queued.filter(Boolean).join('\n\n') || undefined

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

/** A scoped block as the kit registers it; a plugin's carries its id (`${CLAUDE_PLUGIN_ROOT}`). */
function scopedBlock(scoped: ScopedCcHooks, loadedPlugins: LoadedPlugins): ScopedHooksBlock {
  const pluginId = scoped.plugin
    ? loadedPlugins.kitPlugins.find((one) => one.root === scoped.plugin?.root)?.id
    : undefined
  return {
    raw: scoped.raw,
    source: scoped.source,
    ...(scoped.asSubagent ? { asSubagent: true } : {}),
    ...(scoped.plugin ? { plugin: { name: scoped.plugin.name } } : {}),
    ...(pluginId ? { pluginId } : {}),
    ...(scoped.lifetime ? { lifetime: scoped.lifetime } : {}),
  }
}
