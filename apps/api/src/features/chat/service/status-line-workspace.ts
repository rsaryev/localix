import { basename } from 'node:path'

import { gitIn } from '../../../lib/git-in'

/** What a status line's `workspace` says of the folder's git checkout, when it can be known. */
export interface StatusLineWorkspace {
  /** The `origin` remote's identity. */
  repo?: { host: string; owner: string; name: string }
  /** The linked worktree's name, absent in the main working tree. */
  worktree?: string
}

/**
 * The identity a remote URL names: `git@github.com:o/n.git`, `https://host/o/n`, `ssh://git@host/o/n`.
 * For a project nested in subgroups the owner is the whole namespace path.
 */
export function parseRemote(url: string): StatusLineWorkspace['repo'] | undefined {
  const text = url.trim()
  const scp = /^[\w.-]+@([^:/\s]+):(.+)$/.exec(text)
  let host: string | undefined
  let path: string | undefined
  if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    try {
      const parsed = new URL(text)
      host = parsed.hostname
      path = parsed.pathname
    } catch {
      return undefined
    }
  }
  const parts = (path ?? '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
  const name = parts.pop()
  if (!host || !name || parts.length === 0) return undefined
  return { host, owner: parts.join('/'), name }
}

/** Read the checkout of `cwd` from git; nothing outside a repository. */
export async function readStatusLineWorkspace(cwd: string): Promise<StatusLineWorkspace> {
  const git = gitIn(cwd, { timeoutMs: 3_000 })
  const [dirs, remote] = await Promise.all([
    git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']),
    git(['remote', 'get-url', 'origin']),
  ])
  const [gitDir, commonDir] = (dirs ?? '').split('\n')
  const repo = remote ? parseRemote(remote) : undefined
  return {
    ...(repo ? { repo } : {}),
    ...(gitDir && commonDir && gitDir !== commonDir ? { worktree: basename(gitDir) } : {}),
  }
}
