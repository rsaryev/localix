import { resolveWithin } from '@localixai/path-containment'

/** Resolve a repository-relative path only when it remains inside the repository. */
export const confineToDir = resolveWithin
