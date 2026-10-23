import { isPathWithin } from '@localixai/path-containment'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { AGENT_ALLOWED_ROOTS, isInsideWorkspace } from './tools/workspace'

/**
 * Is one resolved path outside the workspace, for THIS tool?
 *
 * Its own module because the answer is not uniform: a mutation must be inside the root both
 * lexically and once its existing folders are resolved, while a reader — whose output enters model context — is judged against the canonical
 * root and may also draw from the session scratch tree. Two rules living inside the fact
 * extractor read as one function with an exception; here the exception is the subject.
 */

const WORKSPACE_CONFINED_READERS = new Set(['read', 'search'])

/**
 * Resolve symlinks for a containment DECISION only.
 *
 * `@localixai/path-containment` is lexical by contract — it states outright that it does no
 * realpath and no symlink following, and that "callers that need symlink safety must resolve
 * first". This is such a caller: a reader auto-approves anything the workspace contains, so a
 * symlink sitting INSIDE the workspace and pointing out of it read as contained. Measured: a
 * link at `<root>/key` targeting a file outside produced `outsideWorkspace: false`, so the
 * read was silently approved and the target's contents entered model context with no prompt.
 * A repo that legitimately contains such a link is enough — no attacker required.
 *
 * BOTH sides are resolved, because resolving only the candidate would break the common case:
 * on macOS `/tmp` is itself a symlink to `/private/tmp`, so a canonical candidate compared
 * against an unresolved root would look outside and prompt for ordinary workspace files.
 *
 * A path that does not exist yet (or that cannot be resolved) falls back to the lexical form —
 * for readers that failure is about to surface as ENOENT anyway, and guessing is worse.
 * Deliberately NOT applied to `facts.paths`: those feed the user's own pattern rules and the
 * prompt text, and silently substituting a link's target would change what an existing rule
 * matches.
 */
function canonical(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return value
  }
}

/**
 * A mutation's target usually does not exist yet, so its own realpath fails — but the folders
 * it will be created in do, and the OS follows a linked folder among them. Measured: a write to
 * `<root>/link/new.txt`, `link` pointing outside, was judged inside and landed outside. So the
 * deepest EXISTING ancestor is resolved and the rest of the path re-attached to it.
 */
function canonicalAncestor(value: string): string {
  const rest: string[] = []
  let head = path.resolve(value)
  for (;;) {
    try {
      return path.join(realpathSync.native(head), ...rest)
    } catch {
      const parent = path.dirname(head)
      if (parent === head) return value
      rest.unshift(path.basename(head))
      head = parent
    }
  }
}

/**
 * The derived half of the facts — every named CLASS the rule grammar can ask about, answered
 * once so the two return sites below cannot answer them differently.
 *
 * `insideWorkspace` requires paths to EXIST and all be contained. A shell line naming no file
 * is neither inside nor outside, and a rule allowing "inside" must not cover it by accident.
 * `readOnly` is likewise false with no command: nothing to judge is not proof of safety.
 */

export function isOutsideWorkspace(
  toolName: string,
  root: string | undefined,
  candidate: string,
): boolean {
  if (!root || root === '/' || root === '') return false
  if (!WORKSPACE_CONFINED_READERS.has(toolName)) {
    // Mutations: lexically inside AND inside once linked folders are followed, both sides
    // resolved (macOS `/tmp` is itself a link), against the same roots a write may touch.
    if (!isInsideWorkspace(root, candidate)) return true
    const target = canonicalAncestor(candidate)
    return ![root, ...AGENT_ALLOWED_ROOTS].some((allowed) =>
      isPathWithin(canonicalAncestor(allowed), target),
    )
  }
  // Readers are judged on canonical paths (a link inside may point out), against the workspace
  // and the agent-authored roots — the same roots a write may touch, so a plugin an agent was
  // asked to build is as readable as it is writable.
  const target = canonical(candidate)
  return ![root, ...AGENT_ALLOWED_ROOTS].some((allowed) => isPathWithin(canonical(allowed), target))
}
