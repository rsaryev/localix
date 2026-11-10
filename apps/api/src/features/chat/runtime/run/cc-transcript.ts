import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { CcTranscript } from '../../../cc-hooks'
import { sessionDataDir } from '../../../mini-apps/session-storage'
import type { ChatRepository, SessionRecord } from '../../repository'
import { ccTranscriptText } from './cc-transcript-lines'

/**
 * The files a session's Claude Code hooks read at `transcript_path` and `agent_transcript_path`,
 * laid out as Claude Code lays them out: the conversation at `<session id>.jsonl`, each subagent's
 * at `subagents/agent-<id>.jsonl` beside it. They live in the root session's data folder (with its
 * `CLAUDE_ENV_FILE`s), so they go when the session does.
 *
 * The database stays the record: a file is rewritten from the stored messages before a hook that
 * can read it runs, only when its text changed, and atomically, so a hook never reads half a file.
 * A delegated child's hooks get the root conversation as `transcript_path`, as a subagent's hooks
 * get the main session's in Claude Code.
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
/** Where the session's conversation file is: the root session's data folder, `<root id>.jsonl`. */
export function ccTranscriptPath(
  session: Pick<SessionRecord, 'id' | 'rootSessionId'>,
  dataRoot?: string,
): string {
  const rootId = session.rootSessionId ?? session.id
  return join(sessionDataDir(rootId, dataRoot), '.claude-code', `${rootId}.jsonl`)
}

export function createCcTranscript(input: {
  repo: Pick<ChatRepository, 'listMessages'>
  userId: string
  session: Pick<SessionRecord, 'id' | 'rootSessionId'>
  cwd: string
  /** The session data root (`RunnerDeps.sessionDataRoot`); the default one if absent. */
  dataRoot?: string
  warn?: (message: string) => void
}): CcTranscript {
  const rootId = input.session.rootSessionId ?? input.session.id
  const path = ccTranscriptPath(input.session, input.dataRoot)
  const dir = dirname(path)
  const agentPath = (agentId: string) => join(dir, 'subagents', `agent-${agentId}.jsonl`)

  const write = async (file: string, sessionId: string, agentId?: string) => {
    const messages = await input.repo.listMessages(input.userId, sessionId)
    const text = ccTranscriptText(messages, {
      sessionId: rootId,
      cwd: input.cwd,
      ...(agentId ? { agentId } : {}),
    })
    if ((await readFile(file, 'utf8').catch(() => null)) === text) return
    await mkdir(dirname(file), { recursive: true })
    // Hooks of one event refresh at once: each write stages its own file, and the last rename wins.
    const staged = `${file}.${randomUUID()}.tmp`
    await writeFile(staged, text, { mode: 0o600 })
    await rename(staged, file)
  }
  const attempt = (work: Promise<void>, file: string) =>
    work.catch((error: unknown) =>
      input.warn?.(`[cc-hooks] transcript ${file} not written: ${String(error)}`),
    )

  return {
    path,
    agentPath,
    async refresh(agentId) {
      await attempt(write(path, rootId), path)
      if (agentId) await attempt(write(agentPath(agentId), agentId, agentId), agentPath(agentId))
    },
  }
}
