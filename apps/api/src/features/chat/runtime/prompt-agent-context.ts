import type { AgentDefinition } from '@localixai/agent/agents'
import { skillOverridesRevision } from '../../agent-core/skill-overrides'
import type { ResolvedRunAgent } from '../../agents/invocation-service'
import type { KitSession } from '../../plugins/kit'
import { loadMemoryProviderContext } from '../../mini-apps/memory-hooks'
import type { LoadedMiniApps } from '../../mini-apps/loader-contract'
import type { SessionRecord } from '../repository'
import type { PersistedMessage } from '../contracts'
import type { SessionPromptSnapshotRepository } from '../session-prompt-snapshot-repository'
import type { SessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './frozen-session-context'
import { consoleWarnLogger } from './plugin-hook-logger'
import { resolvePromptSnapshot } from './prompt-snapshot'
import { latestUserText as latestUserTextOf, resolveRunSkills } from './run-skills'
import { hostPolicy } from '../policy/session-policy'

/**
 * Memory and the skill listing are frozen per view epoch; memory reloads early only when its folder
 * moves. The skills are read from the chat's plugin session once its SessionStart hooks ran.
 */
export async function resolveAgentPromptContext(input: {
  kitSession: KitSession | undefined
  capabilities: ResolvedRunAgent['capabilities']
  cwd: string
  signal: AbortSignal
  userId: string
  session: SessionRecord
  agentId: string
  skills?: AgentDefinition['skills']
  historyMessages: PersistedMessage[]
  viewEpoch: string
  /** The auto memory folder and its MEMORY.md as loaded; null when the run keeps no memory. */
  memory: { dir: string; index: string; clipped: boolean } | null
  projectInstructions?: string
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
    projectInstructions,
    loadedMiniApps,
    contextSnapshots,
    promptSnapshots,
  } = input
  const runSkills = await resolveRunSkills(input.kitSession, {
    capabilities: input.capabilities,
    session,
    ...(skills ? { agentSkills: skills } : {}),
    history: historyMessages,
    cwd: input.cwd,
    signal: input.signal,
  })
  const { skillsContext, skillOverrides } = runSkills
  const currentSkillOverridesRevision = skillOverridesRevision(skillOverrides)

  // Freeze prompt text per agent lane until its view epoch changes: a checkpoint or `/clear`
  // rewrites the cached prefix anyway, so that is when memory and skills refresh.
  // The user's own latest message, and only that: injected skill content is read as
  // instruction, so triggering on tool output or file contents would let any repository
  // containing the keyword push instructions into the prompt. External memory recalls by it too.
  const latestUserText = latestUserTextOf(historyMessages)
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

  return { ...runSkills, frozenContext }
}
