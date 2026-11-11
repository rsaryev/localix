import { mkdir, stat, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { CLAUDE_CODE_BASE_VERSION } from '../../cc-settings/claude-code-version'
import { claudeCodeHome } from '../../cc-settings/config-dir'
import { addAdditionalDirectory } from '../../cc-settings/settings-directories'
import {
  readClaudeSettingsSync,
  settingsAdditionalDirectories,
  formatHookEntries,
} from '../../plugins/kit'
import { localixHome } from '../../../lib/env'
import { parsePermissionMode } from '../../../contracts/permission-modes'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { runAddDir } from './command-add-dir'
import { gitIn } from '../../../lib/git-in'
import { runDiff } from './command-diff'
import { commandFolder } from './command-folder'
import { runExport } from './command-export'
import { INIT_INSTRUCTION } from './command-init'
import { formatStatus } from './command-status'
import type { CommandHandlerContext, DirectReply } from './command-handlers-context'
import { commandRemainder } from './slash-commands'

/** The Claude Code built-ins that call what Localix already has (`slash-catalog-claude-code-commands.ts`). */
const CLAUDE_CODE_CONTROLS = [
  'compact',
  'init',
  'status',
  'hooks',
  'diff',
  'add-dir',
  'export',
] as const
export type ClaudeCodeControl = (typeof CLAUDE_CODE_CONTROLS)[number]

export const isClaudeCodeControl = (control: string): control is ClaudeCodeControl =>
  (CLAUDE_CODE_CONTROLS as readonly string[]).includes(control)

/**
 * `/compact [instructions]`: Localix compacts with a checkpoint (`context-checkpoints.md`), taken
 * when the next turn builds its view, without a model call. So the command arms the agent of the
 * chat for that turn and says what will happen; Claude Code's PreCompact hooks hear the
 * instructions as `custom_instructions` (trigger `manual`). The instructions cannot steer the
 * epoch cards, which are rendered from the evicted turns, and the reply says so.
 */
function handleCompact(
  ctx: Pick<CommandHandlerContext, 'runner'>,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
) {
  const instructions = commandRemainder(prompt)
  ctx.runner.requestCheckpoint(session.id, instructions)
  const hooks = instructions
    ? ' Your instructions go to `PreCompact` hooks; the cards are written without a model, so they do not steer them.'
    : ''
  return directReply(
    'The next message starts from a compacted view: old tool output is masked, long answers are folded, and the oldest turns become short cards, down to about 30% of the context limit. A conversation already below that is left whole, and the transcript keeps everything.' +
      hooks,
  )
}

async function statusReply(ctx: CommandHandlerContext, userId: string, session: SessionRecord) {
  const homeDir = claudeCodeHome()
  const cwd = await ctx.resolveSessionWorkingDir(userId, session)
  const settings = readClaudeSettingsSync({ homeDir, cwd })
  const catalog = await ctx.buildSessionPluginCatalog(userId, session).catch(() => undefined)
  return formatStatus({
    title: session.title,
    sessionId: session.id,
    cwd,
    permissionMode: parsePermissionMode(session.permissionMode),
    agent: session.agent
      ? {
          name: session.agent.name,
          modelId: session.agent.modelId,
          reasoningEffort: session.agent.reasoningEffort,
        }
      : undefined,
    addedDirs: settingsAdditionalDirectories(settings),
    plugins: catalog?.enabled.map((entry) => entry.plugin.manifest.name) ?? [],
    claudeCodeVersion: CLAUDE_CODE_BASE_VERSION,
  })
}

/** The hooks of the folder's settings files and enabled plugins, as a run would load them. */
/**
 * `/hooks`: what the chat's kit session runs (its settings', its plugins', its skills'). The
 * session opens with the chat's first run in this process; before it, none is listed.
 */
function hooksReply(ctx: CommandHandlerContext, session: SessionRecord) {
  const kit = ctx.deps.pluginSessions?.get(session.id)
  return kit
    ? formatHookEntries(kit.hookEntries())
    : 'The hooks of this chat are listed once it has run in this folder.'
}

const isDirectory = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  )

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

export async function handleClaudeCodeControlCommand(
  ctx: CommandHandlerContext,
  control: ClaudeCodeControl,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  switch (control) {
    case 'compact':
      return handleCompact(ctx, session, prompt, directReply)
    case 'init':
      return ctx.runMacroCommand(
        userId,
        session.id,
        session,
        () => ctx.repo.listMessages(userId, session.id),
        prompt,
        INIT_INSTRUCTION,
        ctx.now(),
        { commandOrigin: { command: '/init', label: 'Init' } },
      )
    case 'status':
      return directReply(await statusReply(ctx, userId, session))
    case 'hooks':
      return directReply(hooksReply(ctx, session))
    case 'diff':
      return directReply(await runDiff({ git: gitIn(await commandFolder(ctx, userId, session)) }))
    case 'add-dir': {
      const cwd = await commandFolder(ctx, userId, session)
      return directReply(
        await runAddDir(
          {
            cwd,
            homeDir: claudeCodeHome(),
            isDirectory,
            add: (directory) => addAdditionalDirectory({ cwd, directory }),
          },
          commandRemainder(prompt),
        ),
      )
    }
    case 'export':
      return directReply(
        await runExport(
          {
            title: session.title,
            cwd: await ctx.resolveSessionWorkingDir(userId, session),
            exportsDir: join(localixHome(), 'exports'),
            now: () => new Date(),
            messages: () => ctx.repo.listMessages(userId, session.id),
            exists,
            write: async (path, text) => {
              await mkdir(dirname(path), { recursive: true })
              await writeFile(path, text, { flag: 'wx' })
            },
          },
          commandRemainder(prompt),
        ),
      )
  }
}
