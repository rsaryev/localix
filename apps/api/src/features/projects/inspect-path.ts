import { InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import { homedir } from 'node:os'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { normalizeProjectDir } from './default-project'

/**
 * Classify a path WITHOUT creating or reviving a project. A file open uses this to decide whether
 * the path needs a project at all: a FILE opens in the chat on screen, only a DIRECTORY resolves one.
 */
export const inspectPathRequestSchema = z.object({
  path: z.string().min(1),
})

export const inspectPathResponseSchema = z.object({
  kind: z.enum(['file', 'directory']),
  /** Normalized absolute path that was classified. */
  path: z.string(),
  /**
   * A directory too broad to become a project from a link: a filesystem root or the home folder.
   * The UI refuses it; the client cannot tell which folder is home on its own.
   */
  broad: z.boolean().optional(),
})

export type InspectPathResponse = z.infer<typeof inspectPathResponseSchema>

/**
 * Refuse a relative path. `normalizeProjectDir` collapses `..` without making a path absolute,
 * and every caller (the trusted CLI and an untrusted URL handler alike) needs one that means the
 * same thing in every process.
 */
export function assertAbsolutePath(inputPath: string): void {
  if (!path.isAbsolute(inputPath.trim())) {
    throw new InvalidRequestError('project_path_not_absolute', 'Project path must be absolute')
  }
}

/**
 * Classify an absolute path as a file or a directory. It stats the path and nothing else: no
 * project is minted, revived or read, so an OS file open cannot grow the project list.
 */
export async function inspectPath(
  inputPath: string,
  home: string = homedir(),
): Promise<InspectPathResponse> {
  assertAbsolutePath(inputPath)
  const normalized = normalizeProjectDir(inputPath)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(normalized)
  } catch {
    throw new NotFoundError('project_path_not_found', 'Path does not exist or cannot be read')
  }
  if (info.isFile()) return { kind: 'file', path: normalized }
  if (info.isDirectory()) {
    const broad =
      path.parse(normalized).root === normalized || normalized === normalizeProjectDir(home)
    return { kind: 'directory', path: normalized, broad }
  }
  throw new InvalidRequestError(
    'project_path_not_regular',
    'Path is neither a file nor a directory',
  )
}
