import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { EnvFileStore } from '@rsaryev/llx-plugin'
import type { PathResolver } from '@rsaryev/llx-plugin/rules'
import type { WorkspaceTrust } from '@rsaryev/llx-plugin/loading'
import { errorMessage } from '../../../../lib/errors'
import { ccSessionEnvFiles } from '../../../cc-hooks'
import { trustedFolders } from '../settings/trust'

/**
 * Trust, a session's `CLAUDE_ENV_FILE` files and real paths. Localix keeps no trust of its own: it
 * reads Claude Code's state file (`~/.claude.json`) at each question, so a dialog accepted in
 * Claude Code counts here at once.
 */

export interface ClaudeTrustDeps {
  readonly homeDir: string
  env(): Record<string, string | undefined>
}

/** The kit names the key (`workspaceTrustKey`); the state file answers for exactly that key. */
export function claudeTrust(deps: ClaudeTrustDeps): WorkspaceTrust {
  return { isFolderTrusted: async (key) => trustedFolders(deps.homeDir, deps.env())(key) }
}

/** Each session's files, in the folder `dirOf` names for it, by the names Localix's Bash tool sources. */
export function sessionEnvFiles(dirOf: (sessionId: string) => string): EnvFileStore {
  const fileOf = (sessionId: string, kind: 'session' | 'cwd') => {
    const files = ccSessionEnvFiles(dirOf(sessionId))
    return kind === 'session' ? files.sessionStart : files.cwd
  }
  return {
    async path(sessionId, kind) {
      const file = fileOf(sessionId, kind)
      await fs.mkdir(dirname(file), { recursive: true })
      return file
    },
    read: (path) => fs.readFile(path, 'utf8').catch(() => undefined),
    async clear(sessionId, kind) {
      const file = fileOf(sessionId, kind)
      if (await fs.stat(file).catch(() => undefined)) await fs.writeFile(file, '')
    },
  }
}

export const realPathResolver: PathResolver = {
  async realpath(path) {
    try {
      return await fs.realpath(path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
      return { failure: code === 'ELOOP' ? 'loop' : 'unresolved', message: errorMessage(error) }
    }
  },
}
