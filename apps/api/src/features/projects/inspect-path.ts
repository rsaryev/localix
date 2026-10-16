import path from 'node:path'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { ApiError } from '../../lib/errors'

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
})

export type InspectPathResponse = z.infer<typeof inspectPathResponseSchema>

/** Normalize a directory path for equality: collapse `.`/`..`/dup separators and
 *  drop any trailing separator (but keep the root). So `/a/b` and `/a/b/` match. */
export const normalizeDir = (p: string): string => {
  const n = path.normalize(p.trim())
  if (n.length > 1 && (n.endsWith(path.sep) || n.endsWith('/'))) return n.slice(0, -1)
  return n
}

/**
 * Refuse a relative path. `normalizeDir` collapses `..` without making a path absolute, and every
 * caller (the trusted CLI and an untrusted URL handler alike) needs one that means the same thing
 * in every process.
 */
export function assertAbsolutePath(inputPath: string): void {
  if (!path.isAbsolute(inputPath.trim())) {
    throw new ApiError(400, 'project_path_not_absolute', 'Project path must be absolute')
  }
}

/**
 * Classify an absolute path as a file or a directory. It stats the path and nothing else: no
 * project is minted, revived or read, so an OS file open cannot grow the project list.
 */
export async function inspectPath(inputPath: string): Promise<InspectPathResponse> {
  assertAbsolutePath(inputPath)
  const normalized = normalizeDir(inputPath)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(normalized)
  } catch {
    throw new ApiError(404, 'project_path_not_found', 'Path does not exist or cannot be read')
  }
  if (info.isFile()) return { kind: 'file', path: normalized }
  if (info.isDirectory()) return { kind: 'directory', path: normalized }
  throw new ApiError(400, 'project_path_not_regular', 'Path is neither a file nor a directory')
}
