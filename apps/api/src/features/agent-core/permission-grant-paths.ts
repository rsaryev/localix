import path from 'node:path'

import { isPathBelow, isPathWithin } from '../../lib/path-containment'
import { localixHome, userHome } from '../../lib/env'
import { isSecretPath } from './secret-paths'
import type { GrantOption } from './permission-grant-scope'

/**
 * HOW WIDE a path approval may be — the folder levels a card offers.
 *
 * "Allow this file" is the narrowest honest answer to a card about one file, and it is the
 * wrong one for the case that raised the request: an agent reading its way through a sibling
 * project asks once per file, and a person approving thirty cards in a row stops reading them.
 * So a path card offers the file and then each folder above it, nearest first, and the person
 * picks the level below which nothing asks again.
 *
 * The walk stops BEFORE a folder that contains the home directory or Localix's own state
 * (`~/.localix`: the database, the vault). Past that point a folder is not a project any more —
 * `~` is every credential the user owns — and one click must not reach it. A credential path
 * gets no widening at all, the same way a dangerous command gets none.
 *
 * The shape follows the Agent Client Protocol's permission options (`session/request_permission`,
 * e.g. "Yes, and don't ask again for <dir>"): the host enumerates the choices it is prepared to
 * honour and the answer names one, so a client can never widen a grant past what was offered.
 */

/** Nearest folders offered above the file; a deeper tree than this is picked from the top. */
const MAX_FOLDER_LEVELS = 6

export interface PathGrantBounds {
  /** Folders at or above these are never offered. Production: the home and `~/.localix`. */
  protectedRoots: readonly string[]
  /** Shown as `~` in labels. */
  home?: string
}

const defaultBounds = (): PathGrantBounds => ({
  protectedRoots: [userHome(), localixHome()],
  home: userHome(),
})

/**
 * `~/Documents/x` rather than the absolute path, which is the same fact at half the width.
 * "Is it under home" goes through the ONE containment owner, not a `startsWith`, so a sibling
 * like `/home/meg` can never be shown as `~g`.
 */
export function displayPath(target: string, home = userHome()): string {
  if (!home) return target
  if (target === home) return '~'
  return isPathBelow(home, target) ? `~${path.sep}${path.relative(home, target)}` : target
}

/** The deepest folder every target sits in. */
function commonFolder(targets: readonly string[]): string {
  let folder = path.dirname(targets[0]!)
  while (!targets.every((target) => isPathWithin(folder, target))) {
    const parent = path.dirname(folder)
    if (parent === folder) break
    folder = parent
  }
  return folder
}

/**
 * The widening choices for a call over `targets`, narrowest first: the exact path (one target
 * only), then each folder up to the protected bound. Empty when the targets cannot be named as
 * a rule — relative, holding a glob character, or a credential.
 */
export function pathGrants(
  toolName: string,
  targets: readonly string[],
  bounds: PathGrantBounds = defaultBounds(),
): GrantOption[] {
  if (targets.length === 0) return []
  const nameable = targets.every(
    (target) => path.isAbsolute(target) && !/[*\n]/u.test(target) && !isSecretPath(target),
  )
  if (!nameable) return []

  const show = (target: string) => displayPath(target, bounds.home)
  const action = `tool:${toolName}`
  const options: GrantOption[] = []
  if (targets.length === 1) {
    const [only] = targets as [string]
    options.push({
      scope: `${toolName}(${only})`,
      kind: 'path',
      label: path.basename(only) || only,
      covers: show(only),
      target: only,
      rule: { action, resource: only },
    })
  }

  const guarded = (folder: string) =>
    bounds.protectedRoots.some((root) => root && isPathWithin(folder, root))
  let folder = targets.length === 1 ? path.dirname(targets[0]!) : commonFolder(targets)
  for (let level = 0; level < MAX_FOLDER_LEVELS; level += 1) {
    const parent = path.dirname(folder)
    // The filesystem root is never a folder anyone meant, and a guarded folder ends the walk.
    if (parent === folder || guarded(folder)) break
    const glob = `${folder}${path.sep}*`
    options.push({
      scope: `${toolName}(${glob})`,
      kind: 'folder',
      label: path.basename(folder),
      covers: `anything inside ${show(folder)}`,
      target: folder,
      rule: { action, resource: glob },
    })
    folder = parent
  }
  return options
}
