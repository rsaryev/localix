/** Type-only ports and prepared values for per-run prompt-context composition. */
import type { AgentDefinition } from '@localixai/agent/agents'
import type { ResolvedRunAgent } from '../../agents/invocation-service'
import type { ToolDenial } from '../../capabilities/resolve'
import type { CapabilitySourceRepository } from '../../capabilities/source-repository'
import type { PermissionRule } from '../../projects/contracts'
import type { createEnvironment } from '../../agent-core/tools/environments'
import type {
  discoverFilesystemSkills,
  SkillDiscoveryLogger,
} from '../../agent-core/skill-discovery'
import type { discoverContextFiles } from '../../agent-core/context-files'
import type { TriggeredSkill } from './prompt-skill-triggers'
import type { LoadedPlugins } from '../../plugins/loader'
import type { LoadedMiniApps, LoadMiniAppsOptions } from '../../mini-apps/loader'
import type { AvailabilityReader } from '../../capabilities/availability'
import type { SessionPromptSnapshotRepository } from '../session-prompt-snapshot-repository'
import type { FrozenSessionContext } from './agent-runner-types'
import type { RuntimeState } from './agent-runner-state'
import type { createProjectsRepository } from '../../projects/repository'
import type { SkillOverrides } from '../../agent-core/skill-overrides'

export interface PromptContextDeps {
  /** Where Claude Code's files are read from; the process's home by default (`claudeCodeHome`). */
  claudeHome?: string
  projectsRepo: ReturnType<typeof createProjectsRepository>
  pluginRepo: CapabilitySourceRepository
  /** The `mini-app` rows of `capability_source`: each mini app's stored settings. */
  miniAppRepo: CapabilitySourceRepository
  contextSnapshots: RuntimeState['contextSnapshots']
  promptSnapshots: SessionPromptSnapshotRepository
  /**
   * Scope-level discovery cache (plugins / skills / providers / context files), shared by
   * a parent and every child that inherits its scope. See run-scope.ts.
   */
  runScopes: RuntimeState['runScopes']
  now: () => string
  logger?: SkillDiscoveryLogger
  /**
   * Deliver a mini app's user-facing problem onto a session's firehose.
   *
   * A pure function of its arguments on purpose: the mini app CONTEXT it ends up on is
   * cached per scope (`runScopes`) and reused by every child run, so anything this
   * closure captured from one particular run would go stale. It captures nothing.
   */
  publishMiniAppProblem?: (input: {
    userId: string
    sessionId: string
    app: string
    message: string
    detail?: string
    source?: string
  }) => void
  /** Per-app session storage (`mini-apps/session-storage.ts`); pure, like the problem sink. */
  miniAppSessionStorage?: LoadMiniAppsOptions['sessionStorageFor']
  /** The agents a mini app may name (`mini-apps/agent-directory.ts`); pure, like the storage. */
  miniAppAgentDirectory?: LoadMiniAppsOptions['agentDirectory']
  /** The decision model per mini app (`decisions/mini-app-host.ts`); pure, like the storage. */
  miniAppDecisions?: LoadMiniAppsOptions['decisionsFor']
}

export interface PreparedRunContext {
  agent: AgentDefinition
  capabilities: ResolvedRunAgent['capabilities']
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
  loadedMiniApps: LoadedMiniApps
  contextFiles: Awaited<ReturnType<typeof discoverContextFiles>>
  allSkills: Array<Awaited<ReturnType<typeof discoverFilesystemSkills>>[number]>
  frozenContext: FrozenSessionContext
  pinnedSkills: Array<{ name: string; content: string }>
  /** Skills a keyword in the latest user message forced in for this turn. */
  triggeredSkills: TriggeredSkill[]
  skillOverrides: SkillOverrides
  projectStructure?: string
}
