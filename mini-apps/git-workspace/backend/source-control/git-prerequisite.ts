import { resolveExecutable } from '@localixai/mini-app-sdk/backend'
import type { Prerequisite } from '@localixai/mini-app-sdk/prerequisite'

/**
 * Git itself, as the prerequisite a "not a repository" answer may really be.
 *
 * Repository detection runs `git`, so a machine WITHOUT git answers exactly like a directory that
 * is not a repository — and the panel said "Not a git repository", false about the directory and
 * with no way out. The status names the missing program instead.
 */
export const GIT_PREREQUISITE: Prerequisite = {
  id: 'git',
  name: 'Git',
  state: 'missing',
  installUrl: 'https://git-scm.com/downloads',
}

/** A PATH lookup, no spawn — asked only when detection already said "no repository". */
export const defaultGitInstalled = (): boolean => resolveExecutable('git') !== null
