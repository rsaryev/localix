import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { sessionDataDir } from '../../../mini-apps/session-storage'
import type { SessionRecord } from '../../repository'

/**
 * The `source` a session's SessionStart hooks read (hooks.md): `clear` or `compact` when the view
 * was reset or rewritten, else `startup` for a session's first run ever, `fork` for a forked
 * session's first run, and `resume` for a session that ran before this API process started — it
 * is being taken up again. A marker in the session's data folder remembers that it has started.
 */
export async function sessionStartSource(
  session: Pick<SessionRecord, 'id' | 'provenance'>,
  dataRoot?: string,
  pending?: string,
): Promise<string> {
  const marker = join(sessionDataDir(session.id, dataRoot), '.claude-code', 'session-started')
  const started = Boolean(await fs.stat(marker).catch(() => null))
  if (!started) {
    await fs.mkdir(join(marker, '..'), { recursive: true }).catch(() => undefined)
    await fs.writeFile(marker, new Date().toISOString()).catch(() => undefined)
  }
  if (pending) return pending
  if (started) return 'resume'
  return session.provenance?.kind === 'fork' ? 'fork' : 'startup'
}
