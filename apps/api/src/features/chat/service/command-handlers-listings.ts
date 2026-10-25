import { MemoryBudgetError } from '../../memory/repository'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import { filterDisabledSkills } from '../../agent-core/skill-overrides'
import { commandRemainder } from './slash-commands'
import {
  commandUsage,
  groupCommandsByCategory,
  resolveCommandSpec,
  suggestCommands,
  describeCommand,
  type CommandDetail,
} from '../slash-catalog'

/**
 * Handles `/help [command]`: with no argument, renders the built-in slash commands
 * as a scannable reference grouped into the catalog's ordered categories; with a
 * command name (`/help commit`, `/help /cost`), renders that command's full detail —
 * usage signature, description, category, aliases, and per-argument option sets. An
 * unknown name yields a "did you mean" hint. Catalog-derived so it never drifts from
 * the composer menu; hidden power-user commands are omitted. Pure — no session state.
 */
export function handleHelpControlCommand(
  directReply: DirectReply,
  arg?: string,
): Promise<MessageMutationResponse> {
  const query = commandRemainder(arg ?? '')
  if (query) return directReply(renderHelpDetail(query))

  const groups = groupCommandsByCategory()
  const reply = [
    "**Slash commands** — type `/` in the composer to run any of these. `/help <command>` for one command's details.",
    '',
    ...groups.flatMap((g) => [
      `**${g.category.label}**`,
      ...g.commands.map((c) => `- \`${commandUsage(c)}\` — ${c.description}`),
      '',
    ]),
    'Your own skills run as `/<name>` (see `/skills`); plugin commands as `/<plugin>:<command>`.',
  ].join('\n')
  return directReply(reply)
}

/** Markdown detail for `/help <command>` — or a "did you mean" hint when unknown. */
function renderHelpDetail(query: string): string {
  const spec = resolveCommandSpec(query)
  if (!spec) {
    const suggestions = suggestCommands(query)
    const hint = suggestions.length
      ? `Did you mean ${suggestions.map((s) => `\`/${s.name}\``).join(', ')}?`
      : 'Run `/help` to see all commands.'
    return `No command \`/${query.replace(/^\/+/, '')}\`. ${hint}`
  }

  const d: CommandDetail = describeCommand(spec)
  const lines: string[] = [`**\`${d.usage}\`** — ${d.title}`, '', d.description]
  const meta = [`_${d.categoryLabel}_`]
  if (d.aliases.length) meta.push(`aliases: ${d.aliases.map((a) => `\`/${a}\``).join(', ')}`)
  if (d.argless) meta.push('takes no arguments')
  lines.push('', meta.join(' · '))

  for (const a of d.args) {
    lines.push('', `**\`${a.signature}\`**${a.placeholder ? ` — ${a.placeholder}` : ''}`)
    // `equals` accepts a LIST (one argument serving several sub-commands), so spell the
    // alternatives out. Interpolating the array would render JS's own comma-join —
    // readable by luck, and wrong the moment a value contains a comma.
    if (a.when) {
      // `typeof` and not `Array.isArray`: the latter guards `any[]`, so it leaves a
      // `readonly string[]` unnarrowed and the string branch still a union.
      const { arg, equals } = a.when
      const accepted =
        typeof equals === 'string'
          ? `\`${equals}\``
          : equals.map((value) => `\`${value}\``).join(' · ')
      lines.push(`_only after ${arg} = ${accepted}_`)
    }
    for (const o of a.options) {
      lines.push(`- \`${o.value}\`${o.description ? ` — ${o.description}` : ''}`)
    }
  }
  return lines.join('\n')
}

/**
 * Handles `/memory [fact]`: bare lists stored memories; with a fact, saves it
 * deterministically (no agent run) scoped to the session's project. Extracted
 * verbatim from handleControlCommand.
 */
export async function handleMemoryControlCommand(
  ctx: Pick<CommandHandlerContext, 'memoryRepo'>,
  userId: string,
  session: SessionRecord,
  prompt: string,
  ts: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { memoryRepo } = ctx
  const arg = commandRemainder(prompt)
  const memScopes = session.projectId ? [session.projectId, ''] : ['']
  if (!arg) {
    const rows = await memoryRepo.list(userId, memScopes, 'recent')
    const reply =
      rows.length === 0
        ? 'No memories stored yet. Save one with `/memory <fact>`.'
        : [
            '**Stored memories:**',
            '',
            ...rows.map((r) => `- **${r.key}**${r.projectId ? '' : ' _(global)_'}: ${r.value}`),
          ].join('\n')
    return directReply(reply)
  }
  // Save a memory directly (deterministic — no agent run needed), scoped to the project.
  const key =
    arg
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `note-${Date.now()}`
  const memScope = session.projectId ?? ''
  try {
    await memoryRepo.set(userId, memScope, key, arg, ts)
  } catch (error) {
    if (error instanceof MemoryBudgetError) {
      return directReply(`Memory save failed: ${error.message}`)
    }
    throw error
  }
  return directReply(`Saved to ${memScope ? 'project' : 'global'} memory as \`${key}\`.`)
}

/**
 * Handles `/skills`: lists skills visible to the session with their scope/source
 * and any per-skill visibility override. Pure listing. Extracted verbatim from
 * handleControlCommand.
 */
export async function handleSkillsControlCommand(
  ctx: Pick<CommandHandlerContext, 'gatherSessionSkills' | 'loadSkillOverrides'>,
  userId: string,
  session: SessionRecord,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const discoveredSkills = await ctx.gatherSessionSkills(userId, session)
  const overrides = await ctx.loadSkillOverrides(
    userId,
    session.projectId,
    discoveredSkills.map((s) => s.name),
  )
  const skills = filterDisabledSkills(discoveredSkills, overrides)
  const reply =
    skills.length === 0
      ? 'No skills yet. Create one in the Store (Skills), drop a `SKILL.md` in `.claude/skills/`, or ask me to save a procedure as a skill.'
      : [
          '**Available skills** — run with `/<name>`:',
          '',
          ...skills.map((s) => {
            const tags = [
              s.scope === 'global' ? 'global' : 'project',
              s.source === 'file' ? 'file' : null,
            ]
              .filter(Boolean)
              .join(', ')
            return `- \`/${s.name}\` _(${tags})_ — ${s.description || 'No description'}`
          }),
          '',
          'Switch a skill on or off from its page in the Store.',
        ].join('\n')
  return directReply(reply)
}

export { handleMcpControlCommand } from './command-handlers-mcp'
