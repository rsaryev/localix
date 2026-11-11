import { assertWorkspaceFolder } from '../../projects/workspace-folder'
import type { SessionRecord } from '../repository'
import type { CommandHandlerContext } from './command-handlers-context'

/**
 * The chat's folder for a slash command that WORKS in it (runs git or a shell there, writes its
 * settings), refused like every other folder-bound operation when it moved: one 409
 * `workspace_folder_*`, not "not a git repository" or `ENOENT posix_spawn`. A command that only
 * names the folder (`/status`, `/memory`) reads the path without asking.
 */
export async function commandFolder(
  ctx: Pick<CommandHandlerContext, 'resolveSessionWorkingDir'>,
  userId: string,
  session: SessionRecord,
): Promise<string> {
  const dir = await ctx.resolveSessionWorkingDir(userId, session)
  await assertWorkspaceFolder(dir)
  return dir
}
