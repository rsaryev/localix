import {
  listingLine,
  type PluginSession,
  type ScanScope,
  type SessionSkill,
} from '@rsaryev/llx-plugin'
import { skillLookup } from '@rsaryev/llx-plugin/skills'

/** `keywords: a, b c` or a YAML list, as the frontmatter record holds it. */
function keywordsOf(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return items.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
}

/**
 * Frontmatter `keywords`, which only Localix reads: phrases of the person's message that put the
 * skill's text in the prompt (`chat/runtime/prompt-skill-triggers.ts`). Comma-separated, so a
 * phrase may hold spaces.
 */
export function skillKeywords(skill: SessionSkill): string[] {
  return keywordsOf(skill.invocable.frontmatter.keywords)
}

/** The plugin that ships it: the kit finds its folder by the id (`CLAUDE_PLUGIN_ROOT`). */
export function skillPlugin(
  skill: SessionSkill,
): { readonly id: string; readonly name: string } | undefined {
  const { source } = skill
  const { origin } = skill.invocable
  return source.kind === 'plugin' && origin.kind === 'plugin'
    ? { id: source.pluginId, name: origin.plugin }
    : undefined
}

const PROJECT_SCOPES: ReadonlySet<ScanScope> = new Set(['project', 'nested', 'additional'])

/** `global`: the personal, managed and synced folders and the plugins; `project`: the rest. */
export function skillScope(skill: SessionSkill): 'global' | 'project' {
  return skill.source.kind === 'folder' && PROJECT_SCOPES.has(skill.source.scope)
    ? 'project'
    : 'global'
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
