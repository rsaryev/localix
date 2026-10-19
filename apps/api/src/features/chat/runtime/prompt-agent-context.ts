import type { AgentDefinition } from '@localixai/agent/agents'
import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import {
  filterDisabledSkills,
  skillOverridesRevision,
  type SkillOverrides,
} from '../../agent-core/skill-overrides'
import { loadMemoryProviderContext } from '../../plugins/hooks'
import type { LoadedPlugins } from '../../plugins/loader'
import type { SessionRecord } from '../repository'
import type { PersistedMessage } from '../contracts'
import type { ParticipantLaneSnapshotRepository } from '../participant-lane-snapshot-repository'
import type { SessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './frozen-session-context'
import { consoleWarnLogger } from './plugin-hook-logger'
import { resolvePromptSnapshot } from './prompt-snapshot'
import { resolvePinnedSkills } from './prompt-pinned-skills'
import { resolveTriggeredSkills } from './prompt-skill-triggers'
import { hostPolicy } from '../policy/session-policy'

/** Agent-local selection is refreshed; notes stay frozen only while that selection is unchanged. */
export async function resolveAgentPromptContext(input: {
  userId: string
  session: SessionRecord
  speakerAgentId: string
  context?: AgentDefinition['context']
  historyMessages: PersistedMessage[]
  viewEpoch: string
  memoryPolicy: { revision: string }
  memoryContext?: string
  memoryUsage: FrozenSessionContext['memoryUsage']
  skillsContext?: string
  projectInstructions?: string
  allSkills: DiscoveredSkill[]
  skillOverrides: SkillOverrides
  loadedPlugins: LoadedPlugins
  contextSnapshots: SessionSnapshotCache<FrozenSessionContext>
  laneSnapshots: ParticipantLaneSnapshotRepository
}) {
  const {
    userId,
    session,
    speakerAgentId,
    context,
    historyMessages,
    viewEpoch,
    memoryPolicy,
    memoryContext,
    memoryUsage,
    skillsContext,
    projectInstructions,
    allSkills,
    skillOverrides,
    loadedPlugins,
    contextSnapshots,
    laneSnapshots,
  } = input
  const currentSkillOverridesRevision = skillOverridesRevision(skillOverrides)

  // Freeze prompt text per agent lane until its view epoch changes: a checkpoint or `/clear`
  // rewrites the cached prefix anyway, so that is when memory and skills refresh.
  const snapshotAddress = { sessionId: session.id, agentId: speakerAgentId }
  // The user's own latest message, and only that: injected skill content is read as
  // instruction, so triggering on tool output or file contents would let any repository
  // containing the keyword push instructions into the prompt. External memory recalls by it too.
  const latestUserContent = [...historyMessages]
    .reverse()
    .find((message) => message.payload.role === 'user' && !message.payload.isInternal)
    ?.payload.content
  const latestUserText = typeof latestUserContent === 'string' ? latestUserContent : undefined
  const freshContext: FrozenSessionContext = {
    memoryContext,
    memoryUsage,
    memoryScopesRevision: memoryPolicy.revision,
    skillsContext,
    projectInstructions: projectInstructions,
    skillOverridesRevision: currentSkillOverridesRevision,
    // Output-style files now live under `.localix/output-styles`, but no native
    // selection setting exists yet. Keep the prompt neutral until one does rather
    // than importing the selected name from another application's settings.
  }
  let frozenContext = freshContext
  if (hostPolicy(session).freezesPromptContext) {
    frozenContext = await resolvePromptSnapshot({
      cache: contextSnapshots,
      store: laneSnapshots,
      userId,
      address: snapshotAddress,
      boundary: viewEpoch,
      fresh: freshContext,
      initialize: async () => {
        // Resolve external memory once per snapshot boundary.
        // External providers do not declare scope filtering. A selected native scope must
        // never be widened by an unscoped provider's recall.
        if (loadedPlugins.memory && context?.memory?.scope === undefined) {
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
  const pinnedNames = [
    ...new Set([...(session.pinnedSkills ?? []), ...(context?.preloadSkills ?? [])]),
  ]
  const pinnedSkills = resolvePinnedSkills(allSkills, pinnedNames, skillOverrides)
  const triggeredSkills = resolveTriggeredSkills(
    filterDisabledSkills(allSkills, skillOverrides),
    latestUserText,
    pinnedNames,
  )

  return { frozenContext, pinnedSkills, triggeredSkills }
}
