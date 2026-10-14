import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { claudeCodeAdapter } from './claude-code'
import { geminiCliAdapter } from './gemini-cli'
import type { AdapterEnv } from './types'

/**
 * THE identity invariant, for every adapter.
 *
 * `listSources` must be cheap, so the id it derives — from a file name, a directory, a row key — is
 * the id everything else is built on: the roster key, a `@resource` URI, a link, a `wait` target.
 * An adapter that reads a DIFFERENT id out of the file it later parses produces a roster naming
 * something `listSources` never heard of, and `service.findSource` then matches nothing.
 *
 * That is not a hypothetical: Gemini CLI did exactly this. `listSources` used the file name and
 * `readSummaries` replaced it with the document's own `sessionId`, so all 29 discovered sessions
 * listed correctly and every one of them opened empty — no error anywhere, because "no session on
 * disk for that key" is a perfectly ordinary answer.
 */
async function geminiFixture(): Promise<AdapterEnv> {
  const home = await mkdtemp(join(tmpdir(), 'gemini-identity-'))
  const chats = join(home, '.gemini', 'tmp', 'project-a', 'chats')
  await mkdir(chats, { recursive: true })
  await writeFile(
    join(chats, 'session-2026-04-05T04-15-506b955f.json'),
    JSON.stringify({
      // Deliberately different from the file name — the shape that caused the bug.
      sessionId: '506b955f-601a-4265-abdf-d08260f96b77',
      startTime: '2026-04-05T04:15:00.000Z',
      lastUpdated: '2026-04-05T04:20:00.000Z',
      messages: [
        { id: '1', timestamp: '2026-04-05T04:17:23.098Z', type: 'user', content: [{ text: 'hi' }] },
        {
          id: '2',
          timestamp: '2026-04-05T04:17:40.000Z',
          type: 'gemini',
          content: [{ text: 'ok' }],
        },
      ],
    }),
    'utf8',
  )
  return { env: {}, homeDir: home }
}

/**
 * Claude Code nests transcripts under a session directory, and not every `.jsonl` down there is a
 * transcript. A workflow writes its own `journal.jsonl` — `{type, key, agentId, result}` rows, no
 * roles and no turns — one per workflow directory, and the id used to be the bare filename stem.
 * In a real local history that put 33 distinct files under the single key `claude-code:journal`.
 */
async function claudeFixture(): Promise<AdapterEnv> {
  const home = await mkdtemp(join(tmpdir(), 'claude-identity-'))
  const project = join(home, '.claude', 'projects', '-Users-dev-work')
  const session = '11111111-2222-3333-4444-555555555555'
  const workflows = join(project, session, 'subagents', 'workflows')
  await mkdir(join(workflows, 'wf_one'), { recursive: true })
  await mkdir(join(workflows, 'wf_two'), { recursive: true })
  await mkdir(join(project, session, 'subagents'), { recursive: true })

  const turn = (role: string, text: string) =>
    `${JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } })}\n`
  await writeFile(join(project, `${session}.jsonl`), turn('user', 'top level'), 'utf8')
  await writeFile(
    join(project, session, 'subagents', 'agent-aaa111.jsonl'),
    turn('user', 'sub agent'),
    'utf8',
  )
  await writeFile(
    join(workflows, 'wf_one', 'agent-bbb222.jsonl'),
    turn('user', 'nested sub agent'),
    'utf8',
  )
  // The two files the bug turned on: same name, different workflows, neither one a conversation.
  for (const wf of ['wf_one', 'wf_two']) {
    await writeFile(
      join(workflows, wf, 'journal.jsonl'),
      `${JSON.stringify({ type: 'started', key: 'v2:abc', agentId: 'a1' })}\n`,
      'utf8',
    )
  }
  return { env: {}, homeDir: home }
}

describe('adapter identity', () => {
  test('two sources can never answer to one id', async () => {
    // An id is half of the `<provider>:<id>` key every link, drag and cache entry is built on, and
    // `findSource` resolves it by taking the FIRST ref that matches. A reused id therefore does not
    // fail — it opens somebody else's file, silently.
    const env = await claudeFixture()
    const refs = await claudeCodeAdapter.listSources(env)
    const ids = refs.map((ref) => ref.nativeSessionId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('a workflow journal is bookkeeping, not a session', async () => {
    const env = await claudeFixture()
    const refs = await claudeCodeAdapter.listSources(env)
    expect(refs.map((ref) => ref.sourcePath).filter((p) => p.endsWith('journal.jsonl'))).toEqual([])
    // The three real transcripts, and their ids are still the plain stems: keys already minted
    // against a session or a sub-agent have to keep resolving.
    expect(refs.map((ref) => ref.nativeSessionId).sort()).toEqual([
      '11111111-2222-3333-4444-555555555555',
      'agent-aaa111',
      'agent-bbb222',
    ])
  })

  test('a summary keeps the id its source ref was discovered under', async () => {
    const env = await geminiFixture()
    const refs = await geminiCliAdapter.listSources(env)
    expect(refs).toHaveLength(1)

    const [summary] = await geminiCliAdapter.readSummaries(refs, env)
    // The whole invariant in one line: everything downstream looks a session up by this.
    expect(summary?.nativeSessionId).toBe(refs[0]!.nativeSessionId)
  })

  test('a transcript is reachable by the id the roster hands out', async () => {
    const env = await geminiFixture()
    const refs = await geminiCliAdapter.listSources(env)
    const [summary] = await geminiCliAdapter.readSummaries(refs, env)

    // Exactly what service.findSource does: parse the roster key, then find the ref by its id.
    const found = refs.find((ref) => ref.nativeSessionId === summary?.nativeSessionId)
    expect(found).toBeDefined()

    const result = await geminiCliAdapter.readTranscript(
      { ref: found!, maxEvents: 50, maxCharsPerEvent: 1_000 },
      env,
    )
    expect(result.events).toHaveLength(2)
    expect(result.events.map((event) => event.role)).toEqual(['user', 'assistant'])
    // And the events name the same session the ref did — not the document's inner id.
    expect(result.events[0]?.nativeSessionId).toBe(found!.nativeSessionId)
  })
})
