import { DEFAULT_OUTPUT_STYLE } from '@localixai/claude-plugin'

import { userHome } from '../../../lib/env'
import { claudeCodeOutputStyle } from '../../cc-settings/settings-files'
import { readLocalOutputStyles } from '../../plugins/output-style-files'
import {
  activeOutputStyle,
  findOutputStyle,
  outputStyleCatalog,
  pluginOutputStyles,
  type NamedOutputStyle,
} from '../../plugins/output-styles'
import { readAgentSettings } from './agent-settings'
import { commandRemainder } from './slash-commands'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'

type OutputStyleCommandContext = Pick<
  CommandHandlerContext,
  'repo' | 'publishSession' | 'buildSessionPluginCatalog' | 'resolveSessionWorkingDir'
> & {
  deps: { ports: Pick<CommandHandlerContext['deps']['ports'], 'userProfileRepo'> }
  /** Where the person's own styles live; the user's home unless a test says otherwise. */
  homeDir?: string
}

const SOURCE_NOTE: Record<NamedOutputStyle['source'], string> = {
  builtin: 'built-in',
  user: 'yours',
  project: 'this project',
  plugin: '',
}

function listing(
  styles: readonly NamedOutputStyle[],
  active: NamedOutputStyle | null,
  defaultStyle: string | undefined,
): string {
  const mark = (on: boolean) => (on ? ' — current' : '')
  const row = (entry: NamedOutputStyle) => {
    const notes = [SOURCE_NOTE[entry.source], entry.style.description].filter(Boolean)
    return `- \`${entry.fullName}\`${notes.length ? ` — ${notes.join(' · ')}` : ''}${mark(entry === active)}`
  }
  const rows = [
    `- \`${DEFAULT_OUTPUT_STYLE}\` — no style instructions${mark(!active)}`,
    ...styles.map(row),
  ]
  const notes = [
    active?.style.forceForPlugin
      ? `\`${active.fullName}\` is applied by its plugin while it is enabled.`
      : '',
    defaultStyle ? `Chats without their own choice use \`${defaultStyle}\` (Settings).` : '',
  ].filter(Boolean)
  return `Output styles for this chat — switch with \`/output-style <name>\`:\n\n${rows.join('\n')}${
    notes.length ? `\n\n${notes.join(' ')}` : ''
  }`
}

/** Every style this chat can pick, and the person's default across chats. */
async function chatOutputStyles(
  ctx: OutputStyleCommandContext,
  userId: string,
  session: SessionRecord,
): Promise<{ styles: NamedOutputStyle[]; defaultStyle: string | undefined }> {
  const [catalog, cwd, settings] = await Promise.all([
    ctx.buildSessionPluginCatalog(userId, session),
    ctx.resolveSessionWorkingDir(userId, session).catch(() => null),
    readAgentSettings(ctx.deps.ports.userProfileRepo, userId),
  ])
  const local = await readLocalOutputStyles({ homeDir: ctx.homeDir ?? userHome(), cwd })
  const plugins = catalog.enabled.flatMap(({ plugin }) => pluginOutputStyles(plugin))
  return {
    styles: outputStyleCatalog({ plugins, ...local }),
    defaultStyle:
      settings?.outputStyle ??
      claudeCodeOutputStyle({ homeDir: ctx.homeDir ?? userHome(), cwd: cwd ?? null }),
  }
}

/**
 * `/output-style [name]` — Claude Code's command: with no name it lists the styles the chat can
 * use and marks the current one; with one it switches the chat to it from the next message. The
 * styles are the built-in ones, the person's and the project's `.localix/output-styles/`, and the
 * enabled plugins' `output-styles/`. `default` is stored as an explicit choice of no style, so it
 * also overrides the person's default for this chat.
 */
export async function handleOutputStyleCommand(
  ctx: OutputStyleCommandContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
  ts: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { styles, defaultStyle } = await chatOutputStyles(ctx, userId, session)
  const current = () => activeOutputStyle(styles, session.outputStyle, defaultStyle)
  const query = commandRemainder(prompt)
  if (!query) return directReply(listing(styles, current(), defaultStyle))

  const found = findOutputStyle(styles, query)
  if (found.kind === 'none' || found.kind === 'ambiguous')
    return directReply(
      found.kind === 'ambiguous'
        ? `Several plugins offer "${query}" — name one as \`<plugin>:<name>\`.\n\n${listing(styles, null, defaultStyle)}`
        : `No output style "${query}".\n\n${listing(styles, current(), defaultStyle)}`,
    )
  const outputStyle = found.kind === 'style' ? found.entry.fullName : DEFAULT_OUTPUT_STYLE
  const updated: SessionRecord = { ...session, outputStyle, updatedAt: ts }
  await ctx.repo.updateSession(userId, sessionId, { outputStyle, updatedAt: ts })
  ctx.publishSession(updated)
  const forced = styles.find((entry) => entry.source === 'plugin' && entry.style.forceForPlugin)
  const note =
    forced && forced.fullName !== outputStyle
      ? ` \`${forced.fullName}\` still applies while its plugin is enabled.`
      : ''
  return directReply(
    `Output style set to \`${outputStyle}\`; it applies from your next message.${note}`,
  )
}
