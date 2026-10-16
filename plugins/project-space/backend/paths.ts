import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isPathWithin, resolveWithin } from '@localixai/path-containment'
import type { SpaceDocument } from '../shared/format/document'
import { BOARD_DIR, BOARD_FILE, PASTED_DIR } from '../shared/resource'

/**
 * Where the board lives in a project, and which paths its routes may read.
 *
 * One board per project, inside it: `.localix/project-space/space.json`, with pasted files beside
 * it in `files/`. A reference on the board is project-relative with `/` separators when the file
 * is in the project — so the board still works when the repository is cloned elsewhere — and
 * absolute only for a file dropped from outside it.
 *
 * The board's file routes serve a path only when it is inside the project OR the board itself
 * references it. Without the second rule an absolute path dropped from the desktop could not be
 * previewed; without the first, the route would read anything on the disk it was asked for.
 */
export function spacePaths(root: string) {
  return {
    dir: join(root, BOARD_DIR),
    file: join(root, BOARD_FILE),
    files: join(root, PASTED_DIR),
  }
}

/** The absolute path a board reference points at, or null for one that escapes the project. */
export function resolveReference(root: string, reference: string): string | null {
  if (isAbsolute(reference)) return resolve(reference)
  return resolveWithin(root, reference)
}

/** How the board should write a path: relative inside the project, absolute outside it. */
export function toReference(root: string, absolute: string): string {
  const full = resolve(root, absolute)
  if (!isPathWithin(root, full)) return full
  return relative(root, full).split(sep).join('/') || '.'
}

/**
 * Operations as the board stores them: every `props.path` inside the project made relative,
 * whoever wrote it. A drop from the file tree or the desktop carries absolute paths, and so does
 * an agent that read them from a tool; stored as they came, the board would break the moment the
 * repository is cloned anywhere else.
 */
export function withProjectPaths<T extends { op: string; props?: Record<string, unknown> }>(
  root: string,
  ops: readonly T[],
): T[] {
  return ops.map((op) => {
    const path = op.props?.path
    if (typeof path !== 'string' || !isAbsolute(path)) return op
    return { ...op, props: { ...op.props, path: toReference(root, path) } }
  })
}

/** Whether a board route may read `target` (absolute) for this board. */
export function mayRead(root: string, space: SpaceDocument, target: string): boolean {
  if (isPathWithin(root, target)) return true
  return Object.values(space.elements).some((element) => {
    const path = element.props.path
    return typeof path === 'string' && isAbsolute(path) && isPathWithin(resolve(path), target)
  })
}
