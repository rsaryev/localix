import type { ResolvedRunAgent } from '../../agents/invocation-service'
import { NO_ROSTERS, projectCapabilities, skillOverridesOf } from '../../capabilities/resolve'
import { narrowLoadedPlugins } from '../../plugins/narrow'
import { narrowLoadedMiniApps } from '../../mini-apps/narrow'
import { BUILTIN_TOOL_NAMES } from '../../agent-core/tool-names'
import { safeJsonParse } from '../../../lib/json'
import {
  PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS,
  type PermissionRule,
} from '../../projects/contracts'
import { resolveEffectiveAgentConfig } from '../../effective-config/effective-config'
import { createEnvironment, executionConfigFor } from '../../agent-core/tools/environments'
import { resolveAgentPromptContext } from './prompt-agent-context'
import type { LoadedMiniApps } from '../../mini-apps/loader'
import type { LoadedPlugins } from '../../plugins/loader'
import { loadScopeDiscovery } from './prompt-context-discovery'
import { availabilityOf } from '../../capabilities/availability'
import type { loadUserSettingsContext } from '../../user/runtime-settings'
import { skillsMatchingFiles } from './prompt-skill-paths'
import { withWorkspaceExtensions } from './prompt-context-extensions'
import { buildSkillsContext } from './prompt-skills'
import { agentRoute } from '../../../contracts/session-route'
import type { SessionRecord } from '../repository'
import { resolveBaseSessionCwd } from '../session-cwd'
import type { PersistedMessage } from '../contracts'
import { loadProjectStructureSnapshot } from '../../agent-core/project-structure'
import { autoMemoryDir, readMemoryIndex } from '../../memory/auto-memory'
import { claudeCodeHome } from '../../cc-settings/config-dir'
import type { PromptContextDeps, PreparedRunContext } from './prompt-context-contracts'

type UserSettingsContext = Awaited<ReturnType<typeof loadUserSettingsContext>>

export type { PromptContextDeps, PreparedRunContext } from './prompt-context-contracts'

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
    agentId: string
    historyMessages: PersistedMessage[]
    /** The model view's epoch; the prompt snapshot is frozen per epoch. */
    viewEpoch: string
    globalAgentSettings: UserSettingsContext['agentSettings']
  },
): Promise<PreparedRunContext> {
  const { projectsRepo, contextSnapshots } = ctx
  const { userId, session, agentId, historyMessages, viewEpoch, globalAgentSettings } = params
  const route = agentRoute(session)
  if (!route) throw new Error(`Agent is unavailable: ${agentId}`)

  // Independent loads — fetch concurrently to cut time-to-first-token.
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
  const [project, defaultCwd] = await Promise.all([projectPromise, defaultCwdPromise])
  // Claude Code's auto memory folder for the run's repository, shared with Claude Code itself. A
  // run on another machine or in a container has no such folder its file tools can reach.
  const memoryDir =
    (session.executionBackend ?? 'local') === 'local'
      ? autoMemoryDir({ cwd: defaultCwd, homeDir: ctx.claudeHome ?? claudeCodeHome() })
      : null
  const memory = memoryDir ? { dir: memoryDir, ...(await readMemoryIndex(memoryDir)) } : null
  const resolvedAgent = params.agent
  if (resolvedAgent.definition.id !== route.agentId) {
    throw new Error(`Agent is unavailable: ${route.agentId}`)
  }
  const env = createEnvironment(executionConfigFor(session))

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
  const [[fileSkills, rawPlugins, rawMiniApps, contextFiles], projectStructure] = await Promise.all(
    [
      ctx.runScopes.resolve(
        {
          userId,
          projectId: session.projectId ?? '',
          cwd: defaultCwd,
          agentId: resolvedAgent.definition.id,
        },
        () =>
          loadScopeDiscovery(ctx, {
            userId,
            projectId: session.projectId ?? '',
            cwd: defaultCwd,
            availability: scopeAvailability,
          }),
      ),
      loadProjectStructureSnapshot(env, defaultCwd),
    ],
  )

  // The load answered for the whole scope. This agent's own rules are applied here, on the
  // cheap side of that cache: a plugin it may not reach contributes nothing to its turn.
  //
  // Only a DENIAL subtracts here. Everything in `loaded` already passed the trust question
  // once, when the load decided to import it; asking again with no trust class would answer
  // for a dropped-in plugin as if it were bundled, and asking with one would re-litigate a
  // question already settled. What is left for the role to say is "not this one".
  const narrowed: LoadedPlugins = narrowLoadedPlugins(
    rawPlugins,
    rawPlugins.loaded
      .filter((entry) => scopeAvailability.effectFor('plugin', entry.name) === 'deny')
      .map((entry) => entry.name),
  )
  // What the session's work reached (a subfolder's skills, `paths:` skills) and the agent files.
  const { touched, loadedPlugins } = await withWorkspaceExtensions(
    narrowed,
    fileSkills,
    historyMessages,
    defaultCwd,
  )
  // Project skills first (closer to the working dir), then global. Mirrors CC's
  // scope-priority: nearest SKILL.md definition wins, so listing in that order
  // surfaces the most relevant skills at the top of the model's attention window.
  const sortedFileSkills = [...fileSkills].sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === 'project' ? -1 : 1,
  )
  const allSkills = [...sortedFileSkills, ...loadedPlugins.skills]
  const loadedMiniApps: LoadedMiniApps = narrowLoadedMiniApps(
    rawMiniApps,
    rawMiniApps.loaded
      .filter((entry) => scopeAvailability.effectFor('mini-app', entry.name) === 'deny')
      .map((entry) => entry.name),
  )

  // NOW the rules are projected, and not before: a projection can only subtract from the
  // roster it is handed, so doing this above — where the plugin tools and the skill list are
  // still unknown — answered "nothing is denied" for every kind but the built-in tools. That
  // is how a `skill:` rule could read as off in Settings and still load into the turn.
  const policy = projectCapabilities(resolvedAgent.capabilities, {
    ...NO_ROSTERS,
    tool: [...BUILTIN_TOOL_NAMES, ...loadedMiniApps.tools.map((tool) => tool.name)],
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
  const skillsContext = buildSkillsContext(
    allSkills,
    skillOverrides,
    defaultCwd,
    skillsMatchingFiles(allSkills, defaultCwd, touched),
  )
  const { frozenContext, pinnedSkills, triggeredSkills } = await resolveAgentPromptContext({
    userId,
    session,
    agentId,
    skills: resolvedAgent.definition.skills,
    historyMessages,
    viewEpoch,
    memory,
    skillsContext,
    projectInstructions: boundedProjectInstructions,
    allSkills,
    skillOverrides,
    loadedMiniApps,
    contextSnapshots,
    promptSnapshots: ctx.promptSnapshots,
  })

  return {
    agent: resolvedAgent.definition,
    capabilities: resolvedAgent.capabilities,
    env,
    defaultCwd,
    disabledTools,
    toolDenials: policy.toolDenials,
    // The RUN's own answer, agent scope included — the discovery cache above is the only
    // consumer that has to stop at the scope ceiling.
    availability: scopeAvailability,
    permissionRules,
    loadedPlugins,
    loadedMiniApps,
    contextFiles,
    allSkills,
    frozenContext,
    pinnedSkills,
    triggeredSkills,
    skillOverrides,
    projectStructure,
  }
}
