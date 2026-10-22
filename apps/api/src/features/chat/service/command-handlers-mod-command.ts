import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import type { CommandHandlerContext } from './command-handlers-context'

/**
 * A mod's command (`$.command.register`): `/<name>`, or `/<plugin>:<name>` when two mods or a
 * built-in share the name. It runs through `command.run`, which only the mod's hooks answer: their
 * `{ text }` is the command's output, shown under the mod's name as Claude Code shows it. Returns
 * null when the first token is not a mod's command, so skills and the rest still resolve.
 */
export async function handleModCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
): Promise<MessageMutationResponse | null> {
  const mods = ctx.deps?.mods
  if (!mods) return null
  const firstToken = prompt.trim().split(/\s+/)[0] ?? ''
  const token = firstToken.match(/^\/([A-Za-z0-9_-]+)(?::([A-Za-z0-9_-]+))?$/)
  if (!token) return null
  const [, first, second] = token
  const command = mods.registry
    .commands()
    .find((entry) =>
      second ? entry.plugin === first && entry.name === second : entry.name === first,
    )
  if (!command) return null
  const ts = ctx.now()
  const cwd = await ctx.resolveSessionWorkingDir(userId, session)
  const result = await mods.runCommand(
    { command: command.name, args: prompt.trim().slice(firstToken.length).trim() },
    { userId, sessionId, cwd },
    new Set([command.plugin]),
  )
  const text = result.text?.trim()
  return ctx.insertDirectReply(
    userId,
    sessionId,
    prompt,
    text ? `${command.plugin}: ${text}` : `${command.plugin}: /${command.name} ran.`,
    ts,
    'neutral',
  )
}
