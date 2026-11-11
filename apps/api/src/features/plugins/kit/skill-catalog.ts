import {
  listingLine,
  skillScope,
  type PluginSession,
  type SessionSkill,
  type SkillScope,
} from '@rsaryev/llx-plugin'
import { skillLookup } from '@rsaryev/llx-plugin/skills'

const PROJECT_SCOPES: ReadonlySet<SkillScope> = new Set(['project', 'nested', 'additional'])

/**
 * Localix's two places for a skill, from the scope the kit says it loaded from (`skillScope`):
 * `project` for a project's folders, `global` for the personal, managed and synced ones and the
 * plugins'.
 */
export function projectOrGlobal(skill: SessionSkill): 'global' | 'project' {
  return PROJECT_SCOPES.has(skillScope(skill)) ? 'project' : 'global'
}

/** The session's skills and commands, in the kit's order (plugins first, then the folders). */
export function sessionSkills(
  session: PluginSession,
  options: { readonly activated?: ReadonlySet<string> } = {},
): readonly SessionSkill[] {
  return session.skillCatalog(options).skills
}

/** The skill a name runs, by every name the kit answers to; none when no skill has it. */
export function findSessionSkill(session: PluginSession, name: string): SessionSkill | undefined {
  return skillLookup(session.skillCatalog().skills).find(name.trim().replace(/^\//, ''))
}

/** What a typed message asks of the skills, read as the kit reads it; nothing is expanded. */
export interface TypedSkills {
  /** The skill the message starts with and the ones stacked after it, in order. */
  readonly leading: readonly SessionSkill[]
  /** The text after the last leading skill: the arguments each of them gets. */
  readonly arguments: string
  /** The skills named after plain text: Claude may run them in this message. */
  readonly permitted: ReadonlySet<string>
}

export function typedSkills(session: PluginSession, message: string): TypedSkills {
  const mentions = session.messageMentions(message)
  const lookup = skillLookup(session.skillCatalog().skills)
  return {
    leading: mentions.leading.flatMap((name) => {
      const row = lookup.find(name)
      return row ? [row] : []
    }),
    arguments: mentions.arguments,
    permitted: mentions.permitted,
  }
}

/**
 * The skill listing the model reads (`session.skills().model`: descriptions cut, the budget, the
 * `paths` skills by name until activated), less the skills the agent's capability rules deny.
 */
export function skillListing(
  session: PluginSession,
  options: { readonly denied?: ReadonlySet<string> } = {},
): string | undefined {
  const denied = options.denied ?? new Set<string>()
  const lines = session
    .skills()
    .model.entries.filter((entry) => !denied.has(entry.name))
    .map(listingLine)
  return lines.length ? lines.join('\n') : undefined
}

/**
 * Files the session worked with: the skills of the folders between the working directory and each
 * load, and the `paths` skills they match activate. The commands activated now.
 */
export async function touchSessionFiles(
  session: PluginSession,
  files: readonly string[],
  signal: AbortSignal,
): Promise<string[]> {
  const activated: string[] = []
  for (const file of files) activated.push(...(await session.touchFile(file, { signal })).activated)
  return activated
}
