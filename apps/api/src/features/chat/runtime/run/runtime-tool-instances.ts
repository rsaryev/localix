/**
 * The tools a run hands to the registry ALREADY BUILT.
 *
 * Most tools reach `createRuntimeToolRegistry` as an options object and are constructed
 * inside it; these cannot, because their constructors need host collaborators the
 * agent-core registry must not know (a chat repository, the memory/user stores, the
 * context-store, the loaded plugin set). Building them here keeps that exception in ONE
 * place and off the assembly path, which is what let `runtime-tools.ts` stay a wiring
 * module rather than a second registry.
 *
 * Every entry is gated by `isToolDirect` first: a profile that does not expose the tool
 * never pays for its construction.
 */
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { TOOL } from '../../../agent-core/tool-names'
import { createSkillTool, type SkillToolPorts } from '../../../agent-core/tools/skill'
import { createMiniAppGuideTool } from '../../../agent-core/tools/mini-app-guide'
import { skillToolPorts, type SkillCommandPolicyRef } from './skill-tool-ports'
import { createToolOutputTool } from '../../../agent-core/tools/context-search/context-search'
import {
  createGlobalSearchTool,
  type GlobalSearchPort,
} from '../../../agent-core/tools/global-search/global-search'
import type { createContextStoreRepository } from '../../../context-store/repository'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { ChatRepository, SessionRecord } from '../../repository'
import type { SkillOverrides } from '../../../agent-core/skill-overrides'
import type { RunnerDeps } from '../agent-runner-types'
import type { CcHookSessions } from '../cc-hook-sessions'
import type { LoadedMiniApps } from '../../../mini-apps/loader-contract'
import { escapeRegExp } from '../../../../lib/regexp'

export interface DirectToolInstanceDeps {
  agentProfile: RunProfile
  /** The run's effective disabled set — decides which halves of `ToolOutput` survive. */
  disabledTools: string[]
  defaultCwd: string
  loadedPlugins: LoadedPlugins
  loadedMiniApps: LoadedMiniApps
  repo: ChatRepository
  contextStore: ReturnType<typeof createContextStoreRepository>
  session: SessionRecord
  userId: string
  agentId: string
  /** Skill visibility for this run, from the capability resolver. */
  skillOverrides?: SkillOverrides
  /** The host's capability announcement, for the skill tool's save/delete (see `createSkillTool`). */
  announceCapabilityChange?: () => void
  /** The search palette's service; absent in hosts built without global search. */
  globalSearch?: GlobalSearchPort
  /** Renders a skill the model loads as a typed `/name` renders it (see `skill-tool-ports.ts`). */
  renderSkill?: RunnerDeps['renderSkill']
  /** Where a loaded skill's hooks are kept for the rest of the session. */
  ccHookSessions?: CcHookSessions
  /** The run's permission inputs, which every command a loaded skill injects must pass. */
  skillCommandPolicy?: SkillCommandPolicyRef
  /** Starts a `context: fork` skill's subagent; absent where this run cannot delegate. */
  forkSkill?: SkillToolPorts['forkSkill']
  /** The person's latest message: a `/name` in it lets the agent run that skill (`skill.ts`). */
  latestUserText?: string
}

/** The pre-built tool slots of `createRuntimeToolRegistry`, ready to spread into it. */
export function buildDirectToolInstances(
  deps: DirectToolInstanceDeps,
): Pick<
  OptionalToolPorts,
  typeof TOOL.Skill | typeof TOOL.MiniAppGuide | typeof TOOL.GlobalSearch | typeof TOOL.ToolOutput
> {
  const {
    agentProfile,
    disabledTools,
    defaultCwd,
    loadedPlugins,
    loadedMiniApps,
    repo,
    contextStore,
    session,
    userId,
  } = deps
  const skillPorts = skillToolPorts({
    userId,
    session,
    defaultCwd,
    renderSkill: deps.renderSkill,
    ccHookSessions: deps.ccHookSessions,
    commandPolicy: deps.skillCommandPolicy,
  })
  return {
    // Plugin-bundled skills are passed in read-only so skill.get/list resolve
    // every name the "# Available skills" prompt section advertises.
    Skill: isToolDirect(agentProfile, TOOL.Skill)
      ? createSkillTool(
          defaultCwd,
          loadedPlugins.skills,
          deps.skillOverrides,
          session.projectId ?? '',
          deps.announceCapabilityChange,
          skillPorts.onSkillLoaded,
          skillPorts.renderSkill,
          {
            ...(deps.forkSkill ? { forkSkill: deps.forkSkill } : {}),
            userNamed: (name) => namesSkill(deps.latestUserText, name),
          },
        )
      : undefined,
    MiniAppGuide:
      loadedMiniApps.guides.length > 0 && isToolDirect(agentProfile, TOOL.MiniAppGuide)
        ? createMiniAppGuideTool(loadedMiniApps.guides)
        : undefined,
    GlobalSearch: isToolDirect(agentProfile, TOOL.GlobalSearch)
      ? createGlobalSearchTool({
          ...(deps.globalSearch ? { port: deps.globalSearch } : {}),
          history: repo,
          userId,
          sessionId: session.id,
          projectId: session.projectId ?? null,
        })
      : undefined,
    // Search + exact-recovery halves of context externalization. The final
    // disabledTools filter may remove the consolidated tool like any built-in.
    ToolOutput: (() => {
      if (!isToolDirect(agentProfile, TOOL.ToolOutput)) return undefined
      const actions = [
        ...(!disabledTools.includes('context_search') ? (['search'] as const) : []),
        ...(!disabledTools.includes('retrieve_output') ? (['get'] as const) : []),
      ]
      return actions.length > 0
        ? createToolOutputTool(contextStore, repo, userId, session.id, actions)
        : undefined
    })(),
  }
}

/** `go ahead and /deploy to staging`: the name as its own word, no punctuation attached. */
export function namesSkill(text: string | undefined, name: string): boolean {
  if (!text) return false
  const escaped = escapeRegExp(name)
  return new RegExp(`(^|\\s)/${escaped}(?=\\s|$)`, 'i').test(text)
}
