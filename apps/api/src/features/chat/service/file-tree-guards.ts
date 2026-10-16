import path from 'node:path'
import { ApiError } from '../../../lib/errors'
import type { TreeFs } from './fs-mutations'

/** The explorer mutates entries UNDER its root, never the session workspace itself. */
export const assertNotWorkspaceRoot = (root: string, target: string): void => {
  if (path.resolve(target) === path.resolve(root))
    throw new ApiError(400, 'refused', 'Refusing to mutate the session workspace root')
}

/**
 * Run one tree primitive, turning its failure into the typed 500 the UI shows. The
 * port throws the backend's own reason (stderr, or the errno message) so the
 * person sees why, not just that, it failed.
 */
export const attempt = async (
  code: string,
  fallback: string,
  op: () => Promise<void>,
): Promise<void> => {
  try {
    await op()
  } catch (error) {
    throw new ApiError(500, code, (error instanceof Error && error.message) || fallback)
  }
}

/** The entry's kind, or a 404 when it is gone. */
export const requireKind = async (tree: TreeFs, target: string): Promise<'dir' | 'file'> => {
  const kind = await tree.kind(target)
  if (!kind) throw new ApiError(404, 'not_found', `${target} does not exist`)
  return kind
}
