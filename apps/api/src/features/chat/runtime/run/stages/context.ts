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
import type { HookRunOptions } from '../event-handlers'
import { buildRunCcHooks } from '../cc-hooks-build'
import { fireSessionStartHooks } from '../session-start-hooks'
import { createParticipantLaneSnapshotRepository } from '../../../participant-lane-snapshot-repository'
import { consoleWarnLogger } from '../../plugin-hook-logger'
import { prepareRunContext } from '../../prompt-context'
import { capabilitiesInMode } from '../../../../capabilities/permission-mode-policy'
import { DEFAULT_PERMISSION_MODE } from '../../../../capabilities/permission-modes'
import { pluginProblemNotice } from '../../plugin-problem-notice'
import { resolvePluginSessionDataDir } from '../../../../plugins/session-storage'
import { createPluginAgentDirectory } from '../../../../plugins/agent-directory'
import { runHumanMentionedHooks } from '../../../../plugins/hooks'
import type { LoadedPluginHook } from '../../../../plugins/loader'
import { publishHumanMention } from '../handoff'
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
  const mode = capabilitiesInMode(
    turn.admittedAgent.capabilities,
    session.permissionMode ?? DEFAULT_PERMISSION_MODE,
  )
  const human = (user: string, projectId: string | null) =>
    deps.resolveHuman?.(user, projectId) ?? Promise.resolve(undefined)
  // Observer hooks (HITL, subagent stop, `@human`) are fire-and-forget: no loop latency. The
  // plugin hooks are bound once loaded below; a card assigned before then fires none.
  let pluginHooks: readonly LoadedPluginHook[] = []
  const hookRunOptions: HookRunOptions = { sessionId: session.id, logger: consoleWarnLogger }
  const [context, humanProfile] = await Promise.all([
    prepareRunContext(
      {
        memoryRepo: env.memoryRepo,
        projectsRepo: env.projectsRepo,
        pluginRepo: env.pluginRepo,
        contextSnapshots: runtimeState.contextSnapshots,
        laneSnapshots: createParticipantLaneSnapshotRepository(deps.db),
        runScopes: runtimeState.runScopes,
        now,
        logger: env.deps.logger,
        // A plugin hook's user-facing problem rides the same frame a Claude Code hook's
        // non-blocking `systemMessage` does — one inline transcript warning the client renders —
        // marked as a plugin's, so the client also keeps it as a standing Event Center row.
        publishPluginProblem: ({ userId: owner, ...problem }) =>
          deps.streamRegistry.publish(owner, problem.sessionId, pluginProblemNotice(problem)),
        // A tool's session folder, behind the same ownership gate a route's goes through: a
        // session that is gone (or never was the user's) rejects before anything is created. Pure
        // in its arguments — the plugin context it lands on is shared by every run of the scope.
        pluginSessionStorage: (pluginName) => ({
          resolveDataDir: (owner, sessionId) =>
            resolvePluginSessionDataDir({
              pluginName,
              userId: owner,
              sessionId,
              authorize: async (user, session) => {
                if (!(await env.repo.getSession(user, session)))
                  throw new Error('Session not found')
              },
            }),
        }),
        // The agents a plugin tool may name, behind the same ownership gate: the session is read
        // for the user first, then only the enabled agents of its scope are listed.
        pluginAgentDirectory: createPluginAgentDirectory({
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
          human: (user, projectId) => human(user, projectId),
          // A card assigned to `@human` tells the person exactly as an `@human` reply does.
          notifyHuman: (user, sessionId, notice) =>
            publishHumanMention(
              {
                streamRegistry: deps.streamRegistry,
                notifications: deps.notifications,
                onHumanMentioned: (event) =>
                  void runHumanMentionedHooks(pluginHooks, event, hookRunOptions),
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
    ),
    // Volatile, not frozen: it rides `# Conversation participants`, so an edit reaches the next turn.
    human(userId, session.projectId ?? null),
  ])
  const { defaultCwd, loadedPlugins } = context
  frame.teardown.pluginHooks = loadedPlugins.hooks
  frame.teardown.defaultCwd = defaultCwd
  pluginHooks = loadedPlugins.hooks

  // Plugin onSessionStart hooks — once per session, best-effort, non-blocking.
  fireSessionStartHooks({
    hooks: loadedPlugins.hooks,
    sessionId: session.id,
    startedSessions: runtimeState.pluginStartedSessions,
  })

  // Claude Code declarative hooks: the registry, its three evaluators and the once-per-session
  // SessionStart fire are owned by cc-hooks-build.ts.
  const { ccHooks, ccSessionStartContext } = await buildRunCcHooks({
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
  })
  frame.teardown.ccHooks = ccHooks

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
    ...(humanProfile ? { human: humanProfile } : {}),
    humanReachable: mode.humanReachable,
    hookRunOptions,
    ccHooks,
    ccSessionStartContext,
  }
}
