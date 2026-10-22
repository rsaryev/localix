import { monitorSkillTrigger } from './contracts-monitors'
import type { LoadedPluginMonitor } from './loader-contract'

/**
 * WHICH `on-skill-invoke:<skill>` MONITORS A SKILL INVOCATION STARTS.
 *
 * Claude Code starts such a monitor "the first time that skill runs" in the session, and its
 * lines reach that session. Localix runs a skill when a person sends `/<skill>` and when the
 * agent loads one with the skill tool; both announce it (`agent-core/skill-invocations.ts`),
 * and the monitor host starts each matching monitor once and points it at the chat.
 *
 * A plugin's skills are named without their plugin in Localix (`deploy`, with `pluginName`
 * beside it), while Claude Code addresses them as `<plugin>:deploy`. So a trigger matches the
 * qualified name of any plugin's skill, and a bare name matches only a skill of the monitor's
 * own plugin: `on-skill-invoke:deploy` in plugin `ops` waits for `ops`'s `deploy`, not for a
 * personal skill or another plugin's skill that happens to share the name.
 */
export interface SkillInvocationInput {
  userId: string
  /** The chat the skill ran in: the monitor's lines go there. */
  sessionId: string
  skillName: string
  /** The plugin that ships the skill; absent for a personal or project skill. */
  pluginName?: string
}

export function monitorWaitsForSkill(
  loaded: LoadedPluginMonitor,
  skill: Pick<SkillInvocationInput, 'skillName' | 'pluginName'>,
): boolean {
  const trigger = monitorSkillTrigger(loaded.monitor)?.trim().toLowerCase()
  if (!trigger) return false
  const name = skill.skillName.trim().toLowerCase()
  const plugin = skill.pluginName?.toLowerCase()
  if (plugin && trigger === `${plugin}:${name}`) return true
  return trigger === name && plugin === loaded.pluginName.toLowerCase()
}
