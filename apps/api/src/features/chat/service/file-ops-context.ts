import { createHash } from 'node:crypto'
import path from 'node:path'

import { createEnvironment } from '../../agent-core/tools/environments'
import type { ExecutionEnvironmentConfig } from '../../agent-core/tools/environment'
import type { SessionRecord } from '../repository'

/**
 * The shared preamble every session file operation starts from. Owning it in one
 * place keeps the three operation families (content I/O, tree mutations, search)
 * independent of HOW a session resolves into an execution environment.
 */

/** Closure values the session file-browser operations need from createChatService. */
export interface FileOpsContext {
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  resolveSessionWorkingDir: (userId: string, session: SessionRecord) => Promise<string>
  /** The wall clock a snapshot is judged against; tests move it forward. */
  now?: () => number
}

/** The execution environment a file op runs in — local, or the session's ssh/docker backend. */
const execConfigFor = (session: SessionRecord): ExecutionEnvironmentConfig =>
  session.executionBackend === 'ssh'
    ? { kind: 'ssh', sshHost: session.executionTarget ?? '', sshPort: 22 }
    : session.executionBackend === 'docker'
      ? { kind: 'docker', containerName: session.executionTarget ?? '' }
      : { kind: 'local' }

/**
 * Shared per-op preamble: load the session, build its backend-aware execution
 * environment, and resolve its working dir. Every file operation starts from this
 * same triple.
 */
export const openSessionEnv = async (ctx: FileOpsContext, userId: string, sessionId: string) => {
  const session = await ctx.requireSession(userId, sessionId)
  const env = createEnvironment(execConfigFor(session))
  const dir = await ctx.resolveSessionWorkingDir(userId, session)
  return { session, env, dir }
}

/** Resolve a possibly-relative path against the session's working dir. */
export const resolveAgainst = (dir: string, p: string): string =>
  path.isAbsolute(p) ? p : path.resolve(dir, p)

/** sha256 hex of a UTF-8 string — the optimistic-concurrency token for edits. */
export const contentHash = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')
