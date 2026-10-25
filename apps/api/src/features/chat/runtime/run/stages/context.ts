/**
 * Stage 3 — context: everything the prompt is built FROM, and the hooks that watch the run.
 *
 * Memory, persona, skills, plugins, context files and the frozen prompt snapshot all resolve
 * against one cwd and one plugin set, so they are assembled in one call (`prepareRunContext`)
 * rather than stage by stage — two stages reading the project separately could disagree about
 * which plugins are loaded. The hooks and the LSP subscription acquired here are recorded on
 * the frame the moment they exist, because teardown must release exactly what was acquired
 * even when a later stage throws.
 */
import { subagentRunOptions, withSubagentRunOptions } from '../subagent-file-options'
import { userHome } from '../../../../../lib/env'
import type { HookRunOptions } from '../event-handlers'
import { buildRunCcHooks } from '../cc-hooks-build'
import { createModRunScope, NO_MODS } from '../../../../mods/run-scope'
import { fireSessionStartHooks } from '../session-start-hooks'
import { createParticipantLaneSnapshotRepository } from '../../../participant-lane-snapshot-repository'
import { consoleWarnLogger } from '../../plugin-hook-logger'
import { prepareRunContext } from '../../prompt-context'
import { capabilitiesInMode } from '../../../../capabilities/permission-mode-policy'
import { miniAppProblemNotice } from '../../mini-app-problem-notice'
import { resolveMiniAppSessionDataDir } from '../../../../mini-apps/session-storage'
import { createMiniAppAgentDirectory } from '../../../../mini-apps/agent-directory'
import { runHumanAssignedHooks } from '../../../../mini-apps/hooks'
import type { LoadedMiniAppHook } from '../../../../mini-apps/loader-contract'
import { publishHumanAssignment } from '../human-assignment'
import { applyMainAgent, runToolsAgent } from '../plugin-main-agent'
import { applySpeakerAgent, contextFilesFor } from '../speaker-agent'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { adoptPluginAgentModel } from '../plugin-main-agent-model'
import { reloadedSkillsNote } from '../cc-reload-skills'
import type { ModelView } from '../../model-view/view'
import type { RunFrame } from './frame'
import type { ResolvedTurn } from './turn'

export type RunInputs = Awaited<ReturnType<typeof prepareRunInputs>>

export async function prepareRunInputs(frame: RunFrame, turn: ResolvedTurn, view: ModelView) {
  const { env, params, userId, speakerAgentId, session } = frame
  const { deps, state: runtimeState, now } = env

  if (!frame.isContinuation) frame.publishPhase('preparing-context')
  // The session's mode rewrites the admitted agent's rules before anything reads them, so every
  // consumer below — plugin narrowing, the tool projection, the gate — sees one answer.
  const mode = capabilitiesInMode(turn.admittedAgent.capabilities, turn.policy.permission.mode)
  // Observer hooks (HITL, subagent stop, a card assigned to the person) are fire-and-forget: no loop latency. The
  // plugin hooks are bound once loaded below; a card assigned before then fires none.
  let miniAppHooks: readonly LoadedMiniAppHook[] = []
  const hookRunOptions: HookRunOptions = { sessionId: session.id, logger: consoleWarnLogger }
  const context = await prepareRunContext(
    {
      memoryRepo: env.memoryRepo,
      projectsRepo: env.projectsRepo,
      pluginRepo: env.pluginRepo,
      miniAppRepo: env.miniAppRepo,
      contextSnapshots: runtimeState.contextSnapshots,
      laneSnapshots: createParticipantLaneSnapshotRepository(deps.db),
      runScopes: runtimeState.runScopes,
      now,
      logger: env.deps.logger,
      // A mini app's user-facing problem rides the same frame a Claude Code hook's
      // non-blocking `systemMessage` does — one inline transcript warning the client renders —
      // marked as the app's, so the client also keeps it as a standing Event Center row.
      publishMiniAppProblem: ({ userId: owner, ...problem }) =>
        deps.streamRegistry.publish(owner, problem.sessionId, miniAppProblemNotice(problem)),
      // A tool's session folder, behind the same ownership gate a route's goes through: a
      // session that is gone (or never was the user's) rejects before anything is created. Pure
      // in its arguments — the app context it lands on is shared by every run of the scope.
      miniAppSessionStorage: (app) => ({
        resolveDataDir: (owner, sessionId) =>
          resolveMiniAppSessionDataDir({
            app,
            userId: owner,
            sessionId,
            authorize: async (user, session) => {
              if (!(await env.repo.getSession(user, session))) throw new Error('Session not found')
            },
          }),
      }),
      // The agents a mini app tool may name, behind the same ownership gate: the session is
      // read for the user first, then only the enabled agents of its scope are listed.
      miniAppAgentDirectory: createMiniAppAgentDirectory({
        sessionProject: async (user, session) => {
          const record = await env.repo.getSession(user, session)
          return record ? (record.projectId ?? null) : undefined
        },
        listAgents: async (user, projectId) =>
          ((await deps.listRegistryAgents?.(user, projectId)) ?? []).map((agent) => ({
            id: agent.agentId,
            handle: agent.name,
            description: agent.description,
            enabled: agent.enabled,
          })),
        // A card assigned to the person waits on them: tell them wherever they are.
        notifyHuman: (user, sessionId, notice) =>
          publishHumanAssignment(
            {
              streamRegistry: deps.streamRegistry,
              notifications: deps.notifications,
              onHumanAssigned: (event) =>
                void runHumanAssignedHooks(miniAppHooks, event, hookRunOptions),
            },
            user,
            { sessionId, messageId: notice.key, from: notice.from ?? '', text: notice.text },
          ),
      }),
    },
    {
      userId,
      agent: { ...turn.admittedAgent, capabilities: mode.capabilities },
      session,
      speakerAgentId,
      historyMessages: params.historyMessages,
      // The prompt snapshot is frozen per view epoch (see stages/view.ts).
      viewEpoch: view.epochId,
      globalAgentSettings: turn.globalAgentSettings,
    },
  )
  const { defaultCwd, loadedPlugins, loadedMiniApps } = context
  // The agent the seat is: a file, plugin or shipped agent runs as its definition — its prompt,
  // tool ceiling, instruction files, compaction window and memory — whoever seated it. The default
  // agent has no file; a plugin's `agent` setting is applied below.
  const typed =
    speakerAgentId === DEFAULT_AGENT_ID ? null : applySpeakerAgent(context, turn.admittedAgent.spec)
  // The agent file's own run options: no instruction files, its compaction window, its memory.
  const typeOptions = typed
    ? await subagentRunOptions(typed.subagent, { projectDir: defaultCwd, homeDir: userHome() })
    : null
  const asType = typed && typeOptions ? withSubagentRunOptions(typed, typeOptions) : typed
  if (typeOptions?.contextLimit) {
    const own = turn.contextLimit
    ;(turn as { contextLimit?: typeof own }).contextLimit =
      typeof own === 'number' ? Math.min(own, typeOptions.contextLimit) : typeOptions.contextLimit
  }
  // `omitClaudeMd` (and the built-in Explore and Plan): no workspace instruction files.
  const contextFiles = contextFilesFor(context.contextFiles, asType?.subagent ?? null)
  // The `agent` setting, in Claude Code's order: the person's files, then the plugin's own.
  const run = { speakerAgentId, host: turn.policy.host.kind }
  const chosen =
    asType || speakerAgentId !== DEFAULT_AGENT_ID || run.host !== 'chat'
      ? null
      : ((await deps.resolveMainAgent?.(userId, session.projectId ?? null, defaultCwd ?? null)) ??
        loadedPlugins.mainAgent)
  const main = applyMainAgent(asType ?? context, chosen, run)
  await adoptPluginAgentModel(frame, turn, main.mainAgent)
  frame.teardown.miniAppHooks = loadedMiniApps.hooks
  frame.teardown.defaultCwd = defaultCwd
  miniAppHooks = loadedMiniApps.hooks

  // Mini app onSessionStart hooks — once per session, best-effort, non-blocking.
  fireSessionStartHooks({
    hooks: loadedMiniApps.hooks,
    sessionId: session.id,
    startedSessions: runtimeState.miniAppStartedSessions,
  })

  // Claude Code declarative hooks: the registry, its three evaluators and the once-per-session
  // SessionStart fire are owned by cc-hooks-build.ts.
  const built = await buildRunCcHooks({
    signal: frame.abort.signal,
    env,
    userId,
    session,
    speakerAgentId,
    availability: context.availability,
    capabilities: context.capabilities,
    params,
    catalog: turn.catalog,
    effectiveModelId: turn.model.effectiveModelId,
    defaultCwd,
    disabledTools: context.disabledTools,
    loadedPlugins,
    isContinuation: frame.isContinuation,
    contextFiles,
    permissionMode: turn.policy.permission.mode,
    ...(frame.speakerRoute.reasoningEffort ? { effort: frame.speakerRoute.reasoningEffort } : {}),
    interactive: turn.policy.human.canAnswer,
  })
  const { ccHooks, ccInitialUserMessage } = built
  // `reloadSkills`: a SessionStart hook installed skills after this run's discovery read the folders.
  const reloaded = built.ccReloadSkills
    ? await reloadedSkillsNote({
        cwd: defaultCwd,
        known: context.allSkills.map((skill) => skill.name),
        invalidate: () =>
          runtimeState.runScopes.invalidate({
            userId,
            projectId: session.projectId ?? '',
            cwd: defaultCwd,
            agentId: context.agent.id,
          }),
      })
    : undefined
  const ccSessionStartContext =
    [built.ccSessionStartContext, reloaded].filter(Boolean).join('\n\n') || undefined
  frame.teardown.ccHooks = ccHooks
  // Claude Code mods: the hooks modules of the plugins enabled for this run, in its project.
  const mods = deps.mods
    ? await createModRunScope(
        deps.mods,
        { userId, sessionId: session.id, cwd: defaultCwd },
        new Set(loadedPlugins.loaded.map((plugin) => plugin.name)),
        {
          model: turn.model.rawModelId,
          // A delegated child's turn reaches the mods as Claude Code's subagent turns do: its
          // events carry the child's id as `agentId`.
          ...(session.parentSessionId ? { agentId: session.id } : {}),
        },
      )
    : NO_MODS

  frame.teardown.mods = mods

  if (deps.lspManager && session.projectId) {
    frame.teardown.unsubLsp = deps.lspManager.onUpdate((projectRoot, states) => {
      if (projectRoot !== defaultCwd) return
      deps.streamRegistry.publish(userId, session.id, {
        type: 'lsp.status',
        sessionId: session.id,
        servers: states,
      })
    })
  }

  return {
    ...context,
    contextFiles,
    agent: main.agent,
    disabledTools: main.disabledTools,
    // The plugin agent type a delegated child runs as: its `tools` shape the run's surface, and
    // its `omitClaudeMd` the instruction files it reads.
    pluginSubagent: asType?.subagent ?? null,
    // The plugin agent the chat itself runs as (a plugin's `settings.json` `agent`), if any.
    mainAgent: main.mainAgent,
    // The tools list the run's surface is exact to: the agent type's, or the main agent's.
    toolsAgent: runToolsAgent(asType?.subagent, main.mainAgent),
    hookRunOptions,
    ccHooks,
    ccSessionStartContext,
    ...(ccInitialUserMessage ? { ccInitialUserMessage } : {}),
    mods,
  }
}
