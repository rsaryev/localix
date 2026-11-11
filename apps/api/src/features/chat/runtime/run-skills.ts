import type { AgentDefinition } from '@localixai/agent/agents'
import { GENERAL_PURPOSE_TYPE } from '../../agent-core/tools/agent/agent-type'
import type { SkillOverrides } from '../../agent-core/skill-overrides'
import { skillOverridesOf } from '../../capabilities/resolve'
import type { ResolvedRunAgent } from '../../agents/invocation-service'
import {
  preloadedSkillTexts,
  sessionSkills,
  skillListing,
  skillTexts,
  skillKeywords,
  skillPlugin,
  touchSessionFiles,
  type SkillText,
} from '../../plugins/kit'
import type { PluginSession as KitSession, SessionSkill } from '@rsaryev/llx-plugin'
import type { CatalogAgent } from '@rsaryev/llx-plugin/agents'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import { triggeringKeywords, type TriggeredSkill } from './prompt-skill-triggers'
import { touchedFilesOf } from './touched-files'

/** What a run's prompt and tools take from the chat's skills. */
export interface RunSkills {
  /** Every skill and command of the chat, as the kit lists them. */
  readonly skills: readonly SessionSkill[]
  /** The model's listing, less what the agent's `skill:` rules deny. */
  readonly skillsContext?: string
  /** The agent's `skill:` denials, in the shape the Skill tool takes. */
  readonly skillOverrides: SkillOverrides
  /** The skills the session pinned, or the agent file's `skills` a delegated child preloads. */
  readonly pinnedSkills: SkillText[]
  /** Skills a keyword of the person's latest message put in this turn. */
  readonly triggeredSkills: TriggeredSkill[]
}

const NONE: RunSkills = { skills: [], skillOverrides: {}, pinnedSkills: [], triggeredSkills: [] }

/** The person's own latest message: the one text a keyword may fire on. */
export function latestUserText(history: readonly PersistedMessage[]): string | undefined {
  const content = [...history]
    .reverse()
    .find((message) => message.payload.role === 'user' && !message.payload.isInternal)
    ?.payload.content
  return typeof content === 'string' ? content : undefined
}

/**
 * The chat's skills for one run, read from its plugin session after the SessionStart hooks ran (a
 * skill a hook installed is listed): the folders read again, the files the session worked with
 * touched (a subfolder's skills, `paths` skills), the agent's `skill:` rules applied.
 */
export async function resolveRunSkills(
  kitSession: KitSession | undefined,
  input: {
    capabilities: ResolvedRunAgent['capabilities']
    session: SessionRecord
    agentSkills?: AgentDefinition['skills']
    /** The agent's catalog source: a plugin agent's bare preload finds its own plugin's skill first. */
    agentSource?: CatalogAgent['source']
    history: readonly PersistedMessage[]
    cwd: string
    signal: AbortSignal
  },
): Promise<RunSkills> {
  if (!kitSession) return NONE
  const { session, signal } = input
  await kitSession.reloadSkills({ signal })
  await touchSessionFiles(kitSession, touchedFilesOf([...input.history], input.cwd), signal)
  const skills = sessionSkills(kitSession)
  // A skill its rule denies, and the skills of a plugin the agent may not use (`plugins/narrow.ts`).
  const pluginNames = [...new Set(skills.flatMap((skill) => skillPlugin(skill)?.name ?? []))]
  const deniedPlugins = new Set(input.capabilities.denied('plugin', pluginNames))
  const deniedNames = [
    ...input.capabilities.denied(
      'skill',
      skills.map((skill) => skill.invocable.command),
    ),
    ...skills.flatMap((skill) => {
      const plugin = skillPlugin(skill)
      return plugin && deniedPlugins.has(plugin.name) ? [skill.invocable.command] : []
    }),
  ]
  const denied = new Set(deniedNames)
  const allowed = (text: { name: string }) => !denied.has(text.name)
  const pinnedNames = [...new Set([...(session.pinnedSkills ?? []), ...(input.agentSkills ?? [])])]
  // A child delegated to an agent got its pins from the agent file's `skills`: preloads.
  const preload =
    session.provenance?.kind === 'task-delegation' &&
    !!session.provenance.agentType &&
    session.provenance.agentType !== GENERAL_PURPOSE_TYPE
  const pinned = (
    preload
      ? await preloadedSkillTexts(kitSession, pinnedNames, signal, input.agentSource)
      : await skillTexts(kitSession, pinnedNames, signal)
  ).filter(allowed)
  const pinnedSet = new Set(pinned.map((text) => text.name))
  const hits = triggeringKeywords(
    skills.flatMap((skill) => {
      const name = skill.invocable.command
      return allowed({ name }) && !pinnedSet.has(name)
        ? [{ name, keywords: skillKeywords(skill) }]
        : []
    }),
    latestUserText(input.history),
  )
  const keywordOf = new Map(hits.map((hit) => [hit.name, hit.keyword]))
  const triggered = await skillTexts(
    kitSession,
    hits.map((hit) => hit.name),
    signal,
  )
  const skillsContext = skillListing(kitSession, { denied })
  return {
    skills,
    ...(skillsContext ? { skillsContext } : {}),
    skillOverrides: skillOverridesOf(deniedNames),
    pinnedSkills: pinned,
    triggeredSkills: triggered.map((text) => ({ ...text, keyword: keywordOf.get(text.name)! })),
  }
}
