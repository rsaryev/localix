import type { AgentDefinition } from '@localixai/agent/agents'
import type { ResolvedRunAgent } from '../../agents/invocation-service'
import {
  NO_ROSTERS,
  projectCapabilities,
  skillOverridesOf,
  type ToolDenial,
} from '../../capabilities/resolve'
import { narrowLoadedPlugins } from '../../plugins/narrow'
import { BUILTIN_TOOL_NAMES } from '../../agent-core/tool-names'
import { safeJsonParse } from '../../../lib/json'
import type { CapabilitySourceRepository } from '../../capabilities/source-repository'
import {
  PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS,
  type PermissionRule,
} from '../../projects/contracts'
import { resolveEffectiveAgentConfig } from '../../effective-config/effective-config'
import { createEnvironment } from '../../agent-core/tools/environments'
import type { ExecutionEnvironmentConfig } from '../../agent-core/tools/environment'
import { discoverFilesystemSkills } from '../../agent-core/skill-discovery'
import { discoverContextFiles } from '../../agent-core/context-files'
import { resolveTriggeredSkills, type TriggeredSkill } from './prompt-skill-triggers'
import { loadEnabledPlugins, type LoadedPlugins } from '../../plugins/loader'
import { emptyLoadedPlugins } from '../../plugins/loader-contract'
import { availabilityOf, type AvailabilityReader } from '../../capabilities/availability'
import { loadMemoryProviderContext } from '../../plugins/hooks'
import type { loadUserProfileContext } from '../../agent-core/tools/memory/user-profile'
import { consoleWarnLogger, prefixedWarnLogger } from './plugin-hook-logger'
import { buildSkillsContext } from './prompt-skills'
import { agentRoute } from '../session-route'
import { resolvePromptSnapshot } from './prompt-snapshot'
import { recordPluginCatalogLoad } from '../../notifications/conditions/plugins'
import type { ParticipantLaneSnapshotRepository } from '../participant-lane-snapshot-repository'
import { resolvePinnedSkills } from './prompt-pinned-skills'
import type { FrozenSessionContext } from './agent-runner-types'
import type { RuntimeState } from './agent-runner-state'
import type { SessionRecord } from '../repository'
import { resolveBaseSessionCwd } from '../session-cwd'
import { userHome } from '../../../lib/env'
import type { PersistedMessage } from '../contracts'
import type { createMemoryRepository } from '../../memory/repository'
import type { createProjectsRepository } from '../../projects/repository'
import type { SkillDiscoveryLogger } from '../../agent-core/skill-discovery'
import {
  filterDisabledSkills,
  skillOverridesRevision,
  type SkillOverrides,
} from '../../agent-core/skill-overrides'
import { loadProjectStructureSnapshot } from '../../agent-core/project-structure'

type UserProfileContext = Awaited<ReturnType<typeof loadUserProfileContext>>

export interface PromptContextDeps {
  memoryRepo: ReturnType<typeof createMemoryRepository>
  projectsRepo: ReturnType<typeof createProjectsRepository>
  pluginRepo: CapabilitySourceRepository
  contextSnapshots: RuntimeState['contextSnapshots']
  laneSnapshots: ParticipantLaneSnapshotRepository
  /**
   * Scope-level discovery cache (plugins / skills / providers / context files), shared by
   * a parent and every child that inherits its scope. See run-scope.ts.
   */
  runScopes: RuntimeState['runScopes']
  now: () => string
  logger?: SkillDiscoveryLogger
  /**
   * Deliver a plugin's user-facing problem onto a session's firehose.
   *
   * A pure function of its arguments on purpose: the plugin CONTEXT it ends up on is
   * cached per scope (`runScopes`) and reused by every child run, so anything this
   * closure captured from one particular run would go stale. It captures nothing.
   */
  publishPluginProblem?: (input: {
    userId: string
    sessionId: string
    pluginName: string
    message: string
    detail?: string
    source?: string
  }) => void
  /** Per-plugin session storage (`plugins/session-storage.ts`); pure, like `publishPluginProblem`. */
  pluginSessionStorage?: Parameters<typeof loadEnabledPlugins>[0]['sessionStorageFor']
  /** The agents a plugin may name (`plugins/agent-directory.ts`); pure, like the storage. */
  pluginAgentDirectory?: Parameters<typeof loadEnabledPlugins>[0]['agentDirectory']
}

export interface PreparedRunContext {
  agent: AgentDefinition
  env: ReturnType<typeof createEnvironment>
  defaultCwd: string
  disabledTools: string[]
  /** The denying scope+rule behind each `disabledTools` entry — the ledger's `policy` reason. */
  toolDenials: ToolDenial[]
  /**
   * What this run's rules say, as the three-way answer. Carried on the prepared context
   * rather than re-read downstream: the chain was resolved once here, for this run's
   * (project, agent), and a second read could only answer differently.
   */
  availability: AvailabilityReader
  permissionRules: PermissionRule[]
  loadedPlugins: LoadedPlugins
  contextFiles: Awaited<ReturnType<typeof discoverContextFiles>>
  allSkills: Array<Awaited<ReturnType<typeof discoverFilesystemSkills>>[number]>
  frozenContext: FrozenSessionContext
  pinnedSkills: Array<{ name: string; content: string }>
  /** Skills a keyword in the latest user message forced in for this turn. */
  triggeredSkills: TriggeredSkill[]
  skillOverrides: SkillOverrides
  projectStructure?: string
}

/**
 * Load every prompt-context input for a run: native definition and policy, memory, execution
 * environment + workspace cwd, project setting overrides, skills, plugins,
 * agent providers, project context files, the frozen per-session snapshot
 * and pinned-skill expansion. Native behavior and policy are refreshed on every preparation.
 */
export async function prepareRunContext(
  ctx: PromptContextDeps,
  params: {
    userId: string
    agent: ResolvedRunAgent
    session: SessionRecord
    speakerAgentId: string
    historyMessages: PersistedMessage[]
    /** The model view's epoch; the prompt snapshot is frozen per epoch. */
    viewEpoch: string
    userProfile: UserProfileContext['profileText']
    responseDefaults: UserProfileContext['responseDefaults']
    globalAgentSettings: UserProfileContext['agentSettings']
  },
): Promise<PreparedRunContext> {
  const { memoryRepo, projectsRepo, pluginRepo, contextSnapshots, now } = ctx
  const {
    userId,
    session,
    speakerAgentId,
    historyMessages,
    viewEpoch,
    userProfile,
    responseDefaults,
    globalAgentSettings,
  } = params
  const speakerRoute = agentRoute(session, speakerAgentId)
  if (!speakerRoute) throw new Error(`Agent is unavailable: ${speakerAgentId}`)

  // Memory scopes: this session, the current project, and global ('').
  const memorySessionScope = `session:${session.rootSessionId ?? session.id}`
  const memoryScopes = [memorySessionScope, ...(session.projectId ? [session.projectId] : []), '']

  // Independent loads — fetch concurrently to cut time-to-first-token.
  // Memory ordering is stable ('key') on purpose: 'recent' reorders the
  // "# Memory context" system-prompt section whenever any note is touched,
  // busting the prompt cache.
  // (user profile + agent settings were already loaded by the caller, before
  // provider resolution — the fallback chain needs them.)
  const projectPromise = session.projectId
    ? projectsRepo.getProject(userId, session.projectId)
    : Promise.resolve(null)
  // Single source of truth for the run cwd — the project working dir (when one is
  // provisioned) wins over the project working_dir, which wins over the session
  // sandbox. Shared with the platform path (session-workspace.ts) so SCM, terminal
  // and file browser all root at the same directory. Never the filesystem root '/'.
  const defaultCwdPromise = resolveBaseSessionCwd(
    {
      // Reuse the project row already being loaded for capability settings instead
      // of repeating the same repository read inside the cwd resolver.
      getProjectWorkingDir: async () => (await projectPromise)?.workingDir ?? null,
    },
    userId,
    session,
  )
  const [memory, project, defaultCwd] = await Promise.all([
    // Notes + usage in a single scope-file load (was two separate reads/parses).
    memoryRepo.listWithUsage(userId, memoryScopes, 'key'),
    projectPromise,
    defaultCwdPromise,
  ])
  const resolvedAgent = params.agent
  if (resolvedAgent.definition.id !== speakerRoute.agentId) {
    throw new Error(`Agent is unavailable: ${speakerRoute.agentId}`)
  }
  const memoryNotes = memory.notes
  const memoryUsage = memory.usage

  const memoryContext =
    memoryNotes.length > 0 ? memoryNotes.map((n) => `${n.key}: ${n.value}`).join('\n') : undefined

  const execConfig: ExecutionEnvironmentConfig =
    session.executionBackend === 'ssh'
      ? {
          kind: 'ssh',
          sshHost: session.executionTarget ?? '',
          sshPort: 22,
        }
      : session.executionBackend === 'docker'
        ? { kind: 'docker', containerName: session.executionTarget ?? '' }
        : { kind: 'local' }
  const env = createEnvironment(execConfig)

  // Malformed project settings degrade to built-in defaults (safeJsonParse → null).
  const projectSettings = safeJsonParse<unknown>(project?.settings)
  // One resolver owns the strict boundary used by diagnostics and runtime:
  // project capability policy never inherits the independent no-project policy.
  const capabilityConfig = resolveEffectiveAgentConfig({
    userSettings: globalAgentSettings,
    projectSettings,
    projectScoped: Boolean(session.projectId),
  }).settings
  const projectInstructions = capabilityConfig.customSystemPrompt?.trim()
  const boundedProjectInstructions = projectInstructions
    ? projectInstructions.slice(0, PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS)
    : undefined

  // What this agent may use — its rules are the whole policy, and the discovery cache below
  // keys on the agent for exactly that reason.
  const scopeAvailability = availabilityOf(resolvedAgent.capabilities)

  // Skills (filesystem walk), plugins, and agent providers (manifest scan +
  // dynamic import) all depend only on defaultCwd — load them concurrently.
  //
  // …and then SHARE the result across the scope. Every input below is decided by
  // (userId, projectId, cwd) alone, which is exactly what a spawned child inherits from
  // its parent — a child shares the parent's directory by design, so its surface is
  // byte-identical. Without this each run redid the whole thing: one session ran the
  // filesystem walk and `register()`-ed every enabled plugin 1267 times, once per run.
  // `runScopes` keys on the capability revision too, so enabling a plugin is visible to
  // the very next run without anyone clearing anything. See run-scope.ts for why the
  // role- and turn-shaped inputs stay OUT of this.
  const [[fileSkills, rawPlugins, contextFiles], projectStructure] = await Promise.all([
    ctx.runScopes.resolve(
      {
        userId,
        projectId: session.projectId ?? '',
        cwd: defaultCwd,
        agentId: resolvedAgent.definition.id,
      },
      () => loadScopeDiscovery(),
    ),
    loadProjectStructureSnapshot(env, defaultCwd),
  ])
  async function loadScopeDiscovery() {
    return Promise.all([
      // Merge portable filesystem SKILL.md skills (project + home) into the
      // prompt's skill list, so the agent knows it can invoke them by name.
      discoverFilesystemSkills(defaultCwd, undefined, ctx.logger).catch(() => []),
      // Plugins: discover + load the user's ENABLED plugins for this scope. The
      // enable-state is the trust gate — only enabled plugins' native code is
      // imported. Their bundled skills, MCP servers and native tools fold into the
      // same pipelines built-ins use. Failures are isolated per-plugin and never
      // block the turn.
      loadEnabledPlugins({
        homeDir: userHome(),
        repo: pluginRepo,
        availability: scopeAvailability,
        userId,
        projectId: session.projectId ?? '',
        cwd: defaultCwd,
        now,
        logger: prefixedWarnLogger('plugin'),
        // The user is the host's to bind (it is part of this scope's key); the session
        // is the plugin's to state, because one scope serves a parent and its children.
        ...(ctx.publishPluginProblem
          ? {
              reportProblem: (pluginName, problem) =>
                ctx.publishPluginProblem!({ userId, pluginName, ...problem }),
            }
          : {}),
        ...(ctx.pluginSessionStorage ? { sessionStorageFor: ctx.pluginSessionStorage } : {}),
        ...(ctx.pluginAgentDirectory ? { agentDirectory: ctx.pluginAgentDirectory } : {}),
      })
        // The load as a whole is a standing condition of this scope
        // (`notifications/conditions/plugins.ts`): raised when it throws, settled when it works.
        .then((loaded) => {
          recordPluginCatalogLoad(userId, session.projectId ?? '')
          return loaded
        })
        .catch((err) => {
          console.warn('[agent-runner] plugin load failed', err)
          recordPluginCatalogLoad(userId, session.projectId ?? '', err)
          return emptyLoadedPlugins()
        }),
      // Localix context files (`.localix/context.md` + `.localix/rules/`) —
      // auto-loaded into the
      // session-stable "# Project context" prompt section. Never throws.
      discoverContextFiles(defaultCwd),
    ])
  }

  // The load answered for the whole scope. This agent's own rules are applied here, on the
  // cheap side of that cache: a plugin it may not reach contributes nothing to its turn.
  //
  // Only a DENIAL subtracts here. Everything in `loaded` already passed the trust question
  // once, when the load decided to import it; asking again with no trust class would answer
  // for a dropped-in plugin as if it were bundled, and asking with one would re-litigate a
  // question already settled. What is left for the role to say is "not this one".
  const runAvailability = availabilityOf(resolvedAgent.capabilities)
  const loadedPlugins: LoadedPlugins = narrowLoadedPlugins(
    rawPlugins,
    rawPlugins.loaded
      .filter((entry) => runAvailability.effectFor('plugin', entry.name) === 'deny')
      .map((entry) => entry.name),
  )
  // Project skills first (closer to the working dir), then global. Mirrors CC's
  // scope-priority: nearest SKILL.md definition wins, so listing in that order
  // surfaces the most relevant skills at the top of the model's attention window.
  const sortedFileSkills = [...fileSkills].sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === 'project' ? -1 : 1,
  )
  const allSkills = [...sortedFileSkills, ...loadedPlugins.skills]

  // NOW the rules are projected, and not before: a projection can only subtract from the
  // roster it is handed, so doing this above — where the plugin tools and the skill list are
  // still unknown — answered "nothing is denied" for every kind but the built-in tools. That
  // is how a `skill:` rule could read as off in Settings and still load into the turn.
  const policy = projectCapabilities(resolvedAgent.capabilities, {
    ...NO_ROSTERS,
    tool: [...BUILTIN_TOOL_NAMES, ...loadedPlugins.tools.map((tool) => tool.name)],
    skill: allSkills.map((skill) => skill.name),
  })
  // The scope's own answer, and the only one. A session-level "economy mode" used to add a
  // second trim here, which meant a tool could be ON in Capabilities and absent from the turn.
  const disabledTools = policy.denied.tool
  // The agent's rules, in order, and nothing else. The workspace and dangerous-command
  // confirmations that used to be prepended here are rows in that list now
  // (`builtin-agent-presets.ts`), so there is one place to read and one order to reason about.
  const permissionRules: PermissionRule[] = policy.permissions
  const skillOverrides = skillOverridesOf(policy.denied.skill)
  const skillsContext = buildSkillsContext(allSkills, skillOverrides, defaultCwd)
  const currentSkillOverridesRevision = skillOverridesRevision(skillOverrides)

  // Freeze prompt text per agent lane until its view epoch changes: a checkpoint or `/clear`
  // rewrites the cached prefix anyway, so that is when memory and skills refresh.
  const snapshotAddress = { sessionId: session.id, agentId: speakerRoute.agentId }
  // The user's own latest message, and only that: injected skill content is read as
  // instruction, so triggering on tool output or file contents would let any repository
  // containing the keyword push instructions into the prompt. External memory recalls by it too.
  const latestUserContent = [...historyMessages]
    .reverse()
    .find((message) => message.payload.role === 'user' && !message.payload.isInternal)
    ?.payload.content
  const latestUserText = typeof latestUserContent === 'string' ? latestUserContent : undefined
  const freshContext: FrozenSessionContext = {
    userProfile,
    responseDefaults,
    memoryContext,
    memoryUsage,
    skillsContext,
    projectInstructions: boundedProjectInstructions,
    skillOverridesRevision: currentSkillOverridesRevision,
    // Output-style files now live under `.localix/output-styles`, but no native
    // selection setting exists yet. Keep the prompt neutral until one does rather
    // than importing the selected name from another application's settings.
  }
  let frozenContext = freshContext
  if (session.sessionKind === 'chat') {
    frozenContext = await resolvePromptSnapshot({
      cache: contextSnapshots,
      store: ctx.laneSnapshots,
      userId,
      address: snapshotAddress,
      boundary: viewEpoch,
      fresh: freshContext,
      initialize: async () => {
        // Resolve external memory once per snapshot boundary.
        if (loadedPlugins.memory) {
          freshContext.memoryContext =
            (await loadMemoryProviderContext(
              loadedPlugins.memory,
              {
                sessionId: session.id,
                projectId: session.projectId,
                prompt: latestUserText ?? '',
                builtinContext: memoryContext ?? '',
              },
              { logger: consoleWarnLogger },
            )) || undefined
        }
      },
    })
  }

  // Pinned skills are "applied" to the session — their full content is
  // warmed into the system prompt so the agent follows them this whole session.
  const pinnedSkills = resolvePinnedSkills(allSkills, session.pinnedSkills ?? [], skillOverrides)
  const triggeredSkills = resolveTriggeredSkills(
    filterDisabledSkills(allSkills, skillOverrides),
    latestUserText,
    session.pinnedSkills ?? [],
  )

  return {
    agent: resolvedAgent.definition,
    env,
    defaultCwd,
    disabledTools,
    toolDenials: policy.toolDenials,
    // The RUN's own answer, agent scope included — the discovery cache above is the only
    // consumer that has to stop at the scope ceiling.
    availability: runAvailability,
    permissionRules,
    loadedPlugins,
    contextFiles,
    allSkills,
    frozenContext,
    pinnedSkills,
    triggeredSkills,
    skillOverrides,
    projectStructure,
  }
}
