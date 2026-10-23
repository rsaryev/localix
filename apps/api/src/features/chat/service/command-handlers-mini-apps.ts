import { errorMessage } from '../../../lib/errors'
import { formatMiniAppCheck } from '../../mini-apps/authoring/check'
import type { MiniAppRecord } from '../../mini-apps/contracts'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import { handleMiniAppCreateSubcommand } from './command-handlers-mini-apps-create'

/** The slice of {@link CommandHandlerContext} the `/mini-app` sub-commands need. */
type MiniAppsCommandContext = Pick<
  CommandHandlerContext,
  'miniAppService' | 'repo' | 'runner' | 'now' | 'runMacroCommand'
>

/** Every accepted sub-command, in menu order — the reply to an unrecognized one. */
const MINI_APP_SUBCOMMAND_USAGE = [
  '/mini-app list',
  '/mini-app create <what it should do>',
  '/mini-app enable <name>',
  '/mini-app disable <name>',
  '/mini-app remove <name>',
  '/mini-app reload',
] as const

/** One row of the listing: its state first, so what holds an app back is what the eye meets. */
function listLine(app: MiniAppRecord): string {
  const state = app.error
    ? 'error'
    : app.awaitingConsent
      ? 'waiting for your yes'
      : app.enabled
        ? 'enabled'
        : 'disabled'
  const version = app.version ? ` · v${app.version}` : ''
  const scope = app.scope === 'project' ? ' _(project)_' : ''
  const error = app.error ? ` — ${app.error}` : ''
  return `- ${state} \`${app.name}\`${version}${scope}${error}`
}

/**
 * `/mini-app …`: the person's mini apps from the chat — list, create, switch on and off, remove,
 * reload. Every write goes through the mini apps feature, which announces it; nothing here
 * re-converges a host.
 */
export async function handleMiniAppsControlCommand(
  ctx: MiniAppsCommandContext,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { miniAppService } = ctx
  const tokens = prompt.trim().split(/\s+/)
  const sub = tokens[1]?.toLowerCase() ?? 'list'
  const name = tokens.slice(2).join(' ').trim()
  const projectId = session.projectId ?? null

  if (sub === 'create') {
    return handleMiniAppCreateSubcommand(ctx, userId, session, prompt, directReply)
  }

  if (sub === 'reload') {
    let rebuilt: Awaited<ReturnType<typeof miniAppService.reload>> = []
    let rebuildError: string | null = null
    try {
      rebuilt = await miniAppService.reload(userId)
    } catch (err) {
      rebuildError = errorMessage(err)
    }
    const failed = rebuilt.filter(({ report }) => !report.ok)
    return directReply(
      [
        'Mini apps reloaded. Their tools, screens and commands take effect on the next turn.',
        ...(rebuilt.length
          ? [`Rebuilt ${rebuilt.map(({ name }) => `\`${name}\``).join(', ')}.`]
          : []),
        ...(rebuildError ? [`Your mini apps could not be rebuilt: ${rebuildError}`] : []),
        ...failed.map(({ name, report }) => '```\n' + formatMiniAppCheck(name, report) + '\n```'),
      ].join('\n\n'),
    )
  }

  if (sub === 'enable' || sub === 'disable') {
    if (!name) return directReply(`Usage: \`/mini-app ${sub} <name>\``)
    try {
      await miniAppService.setEnabled(userId, { name, projectId, enabled: sub === 'enable' })
      return directReply(
        `${sub === 'enable' ? 'Enabled' : 'Disabled'} \`${name}\`. Start a new turn for it to take effect.`,
      )
    } catch (err) {
      return directReply(`${sub === 'enable' ? 'Enable' : 'Disable'} failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'remove') {
    if (!name) return directReply('Usage: `/mini-app remove <name>`')
    try {
      await miniAppService.remove(userId, { name, projectId })
      return directReply(`Removed \`${name}\`.`)
    } catch (err) {
      return directReply(`Remove failed: ${errorMessage(err)}`)
    }
  }

  if (tokens.length > 1 && sub !== 'list') {
    return directReply(
      [
        `Unknown sub-command \`${sub}\`. Available actions:`,
        '',
        ...MINI_APP_SUBCOMMAND_USAGE.map((line) => `- \`${line}\``),
      ].join('\n'),
    )
  }

  const { miniApps } = await miniAppService.list(userId, { projectId })
  return directReply(
    miniApps.length === 0
      ? 'No mini apps yet. Add one from the catalog in Settings → Mini apps, or describe one with `/mini-app create <what it should do>`.'
      : [
          '**Mini apps** — manage them in Settings → Mini apps:',
          '',
          ...miniApps.map(listLine),
        ].join('\n'),
  )
}
