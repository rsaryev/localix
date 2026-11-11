import type { PluginIssue } from '@rsaryev/llx-plugin'
import type { LocalixPluginHost } from './host'
import { openScopeSession, type PluginScope } from './scope-session'
import type { SessionSkill } from '@rsaryev/llx-plugin'
import { sessionSkills } from './skill-catalog'

/** A scope's skills and commands, and what the kit found wrong reading them. */
export interface ScopeSkills {
  readonly skills: readonly SessionSkill[]
  /** The folders' issues (a frontmatter that does not parse, a refused name), by file. */
  readonly issues: readonly PluginIssue[]
  /**
   * A skill's body as its file holds it now (`session.skillContent`: found by every name it runs
   * by, nothing substituted, no command run); undefined when no skill has the name.
   */
  readonly content: (name: string, signal?: AbortSignal) => Promise<string | undefined>
}

/**
 * The skills and commands of a scope as the kit lists them in a session of its folder
 * (`./scope-session`): the managed, personal, project (the working directory up to the repository
 * root), portable and added folders, and the selected plugins' skills and commands, one row per
 * name in the kit's order. What the Skills list, `/skills`, the composer and the mods' command list
 * read outside a chat; a chat reads its own session (`sessionSkills`).
 */
export async function scopeSkills(
  host: LocalixPluginHost,
  scope: PluginScope,
  signal: AbortSignal = new AbortController().signal,
): Promise<ScopeSkills> {
  const session = await openScopeSession(host, scope, 'skills')
  const reload = await session.reloadSkills({ signal })
  return {
    skills: sessionSkills(session),
    issues: [...reload.issues, ...session.skillCatalog().issues],
    content: async (name, contentSignal = signal) => {
      const read = await session.skillContent(name, { signal: contentSignal })
      return read.ok ? read.skill.body : undefined
    },
  }
}
