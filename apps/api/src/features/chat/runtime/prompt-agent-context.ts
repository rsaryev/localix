import type { AgentDefinition } from '@localixai/agent/agents'
import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { GENERAL_PURPOSE_TYPE } from '../../agent-core/tools/agent/agent-type'
import {
  filterDisabledSkills,
  skillOverridesRevision,
  type SkillOverrides,
} from '../../agent-core/skill-overrides'
import { loadMemoryProviderContext } from '../../mini-apps/hooks'
import type { LoadedMiniApps } from '../../mini-apps/loader-contract'
import type { SessionRecord } from '../repository'
import type { PersistedMessage } from '../contracts'
import type { SessionPromptSnapshotRepository } from '../session-prompt-snapshot-repository'
import type { SessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './frozen-session-context'
import { consoleWarnLogger } from './plugin-hook-logger'
import { resolvePromptSnapshot } from './prompt-snapshot'
import { resolvePinnedSkills } from './prompt-pinned-skills'
import { resolveTriggeredSkills } from './prompt-skill-triggers'
import { hostPolicy } from '../policy/session-policy'

/** Memory and skills are frozen per view epoch; memory reloads early only when its folder moves. */
export async function resolveAgentPromptContext(input: {
  userId: string
  session: SessionRecord
  agentId: string
  skills?: AgentDefinition['skills']
  historyMessages: PersistedMessage[]
  viewEpoch: string
  /** The auto memory folder and its MEMORY.md as loaded; null when the run keeps no memory. */
  memory: { dir: string; index: string; clipped: boolean } | null
  skillsContext?: string
  projectInstructions?: string
  allSkills: DiscoveredSkill[]
  skillOverrides: SkillOverrides
  /** The memory provider, when a mini app's backend registered one. */
  loadedMiniApps: LoadedMiniApps
  contextSnapshots: SessionSnapshotCache<FrozenSessionContext>
  promptSnapshots: SessionPromptSnapshotRepository
}) {
  const {
    userId,
    session,
    skills,
    historyMessages,
    viewEpoch,
    memory,
    skillsContext,
    projectInstructions,
    allSkills,
    skillOverrides,
    loadedMiniApps,
    contextSnapshots,
    promptSnapshots,
  } = input
  const currentSkillOverridesRevision = skillOverridesRevision(skillOverrides)

  // Freeze prompt text per agent lane until its view epoch changes: a checkpoint or `/clear`
  // rewrites the cached prefix anyway, so that is when memory and skills refresh.
  // The user's own latest message, and only that: injected skill content is read as
  // instruction, so triggering on tool output or file contents would let any repository
  // containing the keyword push instructions into the prompt. External memory recalls by it too.
  const latestUserContent = [...historyMessages]
    .reverse()
    .find((message) => message.payload.role === 'user' && !message.payload.isInternal)
    ?.payload.content
  const latestUserText = typeof latestUserContent === 'string' ? latestUserContent : undefined
  const freshContext: FrozenSessionContext = {
    ...(memory
      ? {
          memoryDir: memory.dir,
          memoryContext: memory.index || undefined,
          memoryClipped: memory.clipped,
        }
      : {}),
    skillsContext,
    projectInstructions: projectInstructions,
    skillOverridesRevision: currentSkillOverridesRevision,
    // The output style is not frozen here: the run resolves it every turn
    // (`run/output-style.ts`), so a `/output-style` switch applies from the next message.
  }
  let frozenContext = freshContext
  if (hostPolicy(session).freezesPromptContext) {
    frozenContext = await resolvePromptSnapshot({
      cache: contextSnapshots,
      store: promptSnapshots,
      userId,
      sessionId: session.id,
      boundary: viewEpoch,
      fresh: freshContext,
      initialize: async () => {
        // Resolve external memory once per snapshot boundary: it recalls into the memory
        // section, so a run that keeps no memory asks it nothing.
        if (loadedMiniApps.memory && memory) {
          freshContext.memoryContext =
            (await loadMemoryProviderContext(
              loadedMiniApps.memory,
              {
                sessionId: session.id,
                projectId: session.projectId,
                prompt: latestUserText ?? '',
                builtinContext: memory.index,
              },
              { logger: consoleWarnLogger },
            )) || undefined
        }
      },
    })
  }

  // Pinned skills are "applied" to the session — their full content is
  // warmed into the system prompt so the agent follows them this whole session.
  const pinnedNames = [...new Set([...(session.pinnedSkills ?? []), ...(skills ?? [])])]
  // A child delegated to an agent got its pins from the agent file's `skills`: preloads.
  const preload =
    session.provenance?.kind === 'task-delegation' &&
    !!session.provenance.agentType &&
    session.provenance.agentType !== GENERAL_PURPOSE_TYPE
  const pinnedSkills = resolvePinnedSkills(allSkills, pinnedNames, skillOverrides, { preload })
  const triggeredSkills = resolveTriggeredSkills(
    filterDisabledSkills(allSkills, skillOverrides),
    latestUserText,
    pinnedNames,
  )

  return { frozenContext, pinnedSkills, triggeredSkills }
}
