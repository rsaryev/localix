import {
  listingLine,
  type ModelListing,
  type OverrideState,
  type PluginIssue,
  type PluginSession,
  type ScanScope,
  type SessionSkill,
} from '@rsaryev/llx-plugin'
import { skillLookup } from '@rsaryev/llx-plugin/skills'

/**
 * A skill or command of a chat as the kit lists, finds and expands it (`session.skillCatalog`), in
 * the shape Localix's surfaces take: the Skills list, the composer, the `/skills` reply, the
 * capability rosters, the `Skill` tool and the prompt. Its names are the kit's, so what Localix
 * lists is what the kit runs.
 */
export interface ChatSkill {
  /** The name it is listed and typed by: `deploy`, `my-plugin:review`. */
  readonly name: string
  /** Every name that runs it, `name` first (a plugin skill's bare name, unless another has it). */
  readonly names: readonly string[]
  /** Its own name, without a plugin's prefix: what a monitor's `on-skill-invoke` names. */
  readonly ownName: string
  /** A `SKILL.md`, or a command file (or a plugin manifest's command entry). */
  readonly kind: 'skill' | 'command'
  readonly description: string
  readonly argumentHint?: string
  readonly argumentNames: readonly string[]
  /** The person may type it (`user-invocable`, Claude Code's `skillOverrides` applied). */
  readonly userInvocable: boolean
  /** Claude may load it on its own (`disable-model-invocation`, overrides applied). */
  readonly modelInvocable: boolean
  /** The `/` menu offers it. */
  readonly inMenu: boolean
  /** What the model's listing says of it. */
  readonly listed: ModelListing
  /** It sets `paths` and no touched file has activated it yet. */
  readonly dormant: boolean
  /** Claude Code's `skillOverrides` state for it (always `on` for a plugin's). */
  readonly override: OverrideState
  /** The plugin that ships it: the kit finds its folder by the id (`CLAUDE_PLUGIN_ROOT`). */
  readonly plugin?: { readonly id: string; readonly name: string }
  /** `global`: the personal, managed and synced folders and the plugins; `project`: the rest. */
  readonly scope: 'global' | 'project'
  /** The folder scope it was read from; absent for a plugin's. */
  readonly folder?: ScanScope
  /** Its file, absolute; absent for a plugin manifest's inline command. */
  readonly path?: string
  /** A `SKILL.md`'s folder, where its relative references resolve. */
  readonly dir?: string
  /** Frontmatter `hooks`, as written. */
  readonly hooks?: unknown
}

const PROJECT_SCOPES: ReadonlySet<ScanScope> = new Set(['project', 'nested', 'additional'])

function chatSkillOf(row: SessionSkill): ChatSkill {
  const { invocable, source, policy } = row
  const { origin } = invocable
  const plugin =
    source.kind === 'plugin' && origin.kind === 'plugin'
      ? { id: source.pluginId, name: origin.plugin }
      : undefined
  const folder = source.kind === 'folder' ? source.scope : undefined
  return {
    name: invocable.command,
    names: row.names,
    ownName: invocable.name,
    kind: invocable.kind,
    description: invocable.description ?? '',
    ...(invocable.argumentHint ? { argumentHint: invocable.argumentHint } : {}),
    argumentNames: invocable.arguments,
    userInvocable: policy.user,
    modelInvocable: policy.model,
    inMenu: policy.inMenu,
    listed: row.listed,
    dormant: row.dormant,
    override: row.override,
    ...(plugin ? { plugin } : {}),
    scope: folder && PROJECT_SCOPES.has(folder) ? 'project' : 'global',
    ...(folder ? { folder } : {}),
    ...(row.file ? { path: row.file } : {}),
    ...(row.directory ? { dir: row.directory } : {}),
    ...(invocable.hooks ? { hooks: invocable.hooks } : {}),
  }
}

/** The session's skills and commands, in the kit's order (plugins first, then the folders). */
export function sessionSkills(
  session: PluginSession,
  options: { readonly activated?: ReadonlySet<string> } = {},
): ChatSkill[] {
  return session.skillCatalog(options).skills.map(chatSkillOf)
}

/** The skill a name runs, by every name the kit answers to; none when no skill has it. */
export function findSessionSkill(session: PluginSession, name: string): ChatSkill | undefined {
  const row = skillLookup(session.skillCatalog().skills).find(name.trim().replace(/^\//, ''))
  return row && chatSkillOf(row)
}

/** What a typed message asks of the skills, read as the kit reads it; nothing is expanded. */
export interface TypedSkills {
  /** The skill the message starts with and the ones stacked after it, in order. */
  readonly leading: readonly ChatSkill[]
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
      return row ? [chatSkillOf(row)] : []
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

/** The skill folders read again (a skill written since is listed); their issues and watch list. */
export function reloadSessionSkills(
  session: PluginSession,
  signal: AbortSignal,
): Promise<{ readonly issues: readonly PluginIssue[]; readonly watch: readonly string[] }> {
  return session.reloadSkills({ signal })
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
