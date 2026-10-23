import { pluginLabel } from '@localixai/mini-app-sdk/manifest'
import type { ComposerTip } from './contracts'
import type { CapabilitySnapshot } from '../../contracts/capability-snapshot'
import type { SlashCommandSpec } from '../chat/slash-command-catalog'
import { CURATED_TIPS, TEACHABLE_COMMANDS } from './tips-curated'
import { SESSION_TIPS } from './tips-session'
import { capabilityAction, insertAction, settingsAction } from './tips-actions'
import { tipKeywordPattern } from './tips-keywords'

/**
 * The composer's tip pool for ONE scope, derived from that scope's own catalogs.
 *
 * Tips are the last place in the product where the client was still describing the
 * workspace from memory: a hardcoded list naming three plugins, two tool names and a
 * settings page. Every one of those is a fact this document already holds, and holds
 * correctly — a plugin that is installed but off, a tool the rules deny, a skill
 * saved a minute ago. Deriving the pool from the document is therefore not a move for
 * its own sake: it is the difference between advertising a plugin the user has and
 * advertising one the client's author happened to know about.
 *
 * This is the ONLY author of a tip. The client used to write some of them — the ones
 * about the product's own slash commands, on the argument that only the composer knows
 * its menu. It does not: `SLASH_COMMANDS` is a shared leaf, so those are derived here
 * too, and the pool has one origin rather than two halves free to disagree.
 *
 * Pure. Input is the rest of the snapshot, output is the `tips` field of it — so a
 * new catalog field becomes a tip source here and nowhere else.
 */

/** Long enough to say one thing; short enough for a single composer line. */
const MAX_TIP_TEXT = 110
/**
 * How many tips one catalog may contribute. The client picks randomly, weighted by
 * how often a tip has been seen, so a 60-skill install would otherwise drown the
 * curated pool in its own skill list — and pay for it on every snapshot fetch.
 */
const MAX_PER_SOURCE = 12

function clip(text: string): string {
  return text.length > MAX_TIP_TEXT ? `${text.slice(0, MAX_TIP_TEXT - 1).trimEnd()}…` : text
}

/** First sentence of a manifest description — the rest is rarely one composer line. */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  const stop = trimmed.search(/[.!?](\s|$)/)
  return stop === -1 ? trimmed : trimmed.slice(0, stop)
}

/**
 * Installed, not switched on — the one plugin state a tip can actually resolve.
 *
 * Its trigger comes from the plugin's own name and description (see
 * `tipKeywordPattern`), so the host never decides which plugin is "the browser one".
 * A plugin whose prose yields no keyword still ships as a generic tip: it is worth
 * knowing it is sitting there uninstalled-in-effect.
 */
function inactivePluginTips(plugins: CapabilitySnapshot['plugins']): ComposerTip[] {
  return plugins
    .filter((plugin) => !plugin.enabled && !plugin.error)
    .slice(0, MAX_PER_SOURCE)
    .map((plugin) => {
      const label = pluginLabel(plugin)
      const summary = firstSentence(plugin.description)
      const pattern = tipKeywordPattern(`${plugin.name} ${plugin.displayName ?? ''}`, summary)
      return {
        id: `plugin:${plugin.name}`,
        text: clip(
          summary
            ? `${summary} — the "${label}" plugin does that, and it is installed but off.`
            : `The "${label}" plugin is installed but off.`,
        ),
        // Straight to that plugin's row, not to the list: the tip's whole value is the
        // one switch it is talking about.
        actions: [capabilityAction('plugin', plugin.name, plugin.projectId, `Open ${label}`)],
        ...(pattern ? { when: { textPattern: pattern } } : {}),
      }
    })
}

/**
 * The product's OWN slash commands, read from the catalog that defines them.
 *
 * These were the last tips still written on the client, on the argument that only the
 * composer knows its commands. It does not: `SLASH_COMMANDS`, handed in by the composition
 * root, is the leaf the parser,
 * the menu and `/help` all derive from, so the tip is derived from it too — and the
 * pool has ONE origin instead of a server half and a client half that could disagree
 * about what a command does.
 */
function builtinCommandTips(builtinCommands: readonly BuiltinCommand[]): ComposerTip[] {
  return builtinCommands.flatMap((command) =>
    command.hidden || !TEACHABLE_COMMANDS.includes(command.name)
      ? []
      : [
          {
            id: `builtin:${command.name}`,
            text: clip(`Slash command /${command.name}: ${command.description}`),
            actions: [insertAction(`/${command.name}`)],
          },
        ],
  )
}

/** Slash commands enabled plugins contribute — teachable because they are runnable. */
function commandTips(commands: CapabilitySnapshot['commands']): ComposerTip[] {
  return commands
    .filter((command) => command.description)
    .slice(0, MAX_PER_SOURCE)
    .map((command) => ({
      id: `command:${command.fullName}`,
      text: clip(`Try /${command.fullName} — ${command.description}`),
      actions: [insertAction(`/${command.fullName}`)],
    }))
}

/** The user's own skills, which is why these are worth more than a curated line. */
function skillTips(skills: CapabilitySnapshot['skills']): ComposerTip[] {
  return skills
    .filter((skill) => skill.enabled && skill.userInvocable !== false && skill.description)
    .slice(0, MAX_PER_SOURCE)
    .map((skill) => ({
      id: `skill:${skill.name}`,
      text: clip(`You have a "${skill.name}" skill — ${skill.description}`),
      actions: [
        insertAction(`/${skill.name}`),
        capabilityAction('skill', skill.name, skill.projectId, 'Edit skill'),
      ],
    }))
}

/**
 * Tips that exist only because a catalog is EMPTY.
 *
 * "Save reusable instructions as Skills" is advice to someone with no skills and
 * noise to someone with forty of them, who is already being offered their own. An
 * empty catalog is a fact of the scope like any other, so the pool reads it like any
 * other rather than showing the line unconditionally.
 */
function onboardingTips(snapshot: Omit<CapabilitySnapshot, 'tips'>): ComposerTip[] {
  const tips: ComposerTip[] = []
  if (snapshot.skills.length === 0) {
    tips.push({
      id: 'onboarding:skills',
      text: 'Save instructions you repeat as a Skill — the agent then applies them itself.',
      actions: [settingsAction('skills', 'Open Skills')],
    })
  }
  if (snapshot.mcp.length === 0) {
    tips.push({
      id: 'onboarding:mcp',
      text: 'Connect an MCP server to give the agent tools and data from elsewhere.',
      actions: [settingsAction('mcp', 'Open MCP')],
    })
  }
  if (snapshot.commands.length === 0) {
    tips.push({
      id: 'onboarding:plugins',
      text: 'Plugins add tools, skills and slash commands to this workspace.',
      actions: [settingsAction('plugins', 'Open Plugins')],
    })
  }
  return tips
}

/** What a tip needs of one of the product's own slash commands (`SLASH_COMMANDS`). */
export type BuiltinCommand = Pick<SlashCommandSpec, 'name' | 'description' | 'hidden'>

export function composerTips(
  snapshot: Omit<CapabilitySnapshot, 'tips'>,
  builtinCommands: readonly BuiltinCommand[],
): ComposerTip[] {
  const enabledTools = new Set(snapshot.tools.enabled)
  // One filter for both hand-written pools: a tip may only name a capability this
  // scope actually has, whether it talks about the workspace or about the session.
  const curated = [...CURATED_TIPS, ...SESSION_TIPS]
    .filter(
      (tip) => !tip.requiresAnyTool || tip.requiresAnyTool.some((name) => enabledTools.has(name)),
    )
    .map(({ requiresAnyTool: _gate, ...tip }) => tip)

  const tips = [
    ...curated,
    ...builtinCommandTips(builtinCommands),
    ...onboardingTips(snapshot),
    ...inactivePluginTips(snapshot.plugins),
    ...commandTips(snapshot.commands),
    ...skillTips(snapshot.skills),
  ]
  // Ids are prefixed per source, so the only way two entries collide is a name that
  // repeats within one catalog — a project skill shadowing a global one of the same
  // name, the same plugin discovered in both scopes. The client stores seen-counts by
  // id, so a duplicate would make one tip count for two: keep the first, drop the rest.
  const byId = new Map<string, ComposerTip>()
  for (const tip of tips) if (!byId.has(tip.id)) byId.set(tip.id, tip)
  return [...byId.values()]
}
