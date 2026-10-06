import { describe, expect, test } from 'bun:test'
import { closeSync, openSync, writeSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentSessionsService } from './service'

/**
 * `TranscriptSlice.sourceTruncated` is assigned by the SERVICE from the adapter's result, and a
 * mutation sweep showed that deleting the assignment left every other test in this plugin green —
 * every fixture set the field itself. This drives the whole path instead: a real oversized file, the
 * real registry, the real adapter, the real slice.
 *
 * The fixture is SPARSE. Real JSONL at both ends of a 33 MB file with a hole between costs 32 KB of
 * disk and reads in 76 ms forward, 5 ms backward — measured — so a test can cross the 32 MB cap
 * without carrying 33 MB in the repository or in memory.
 */
const APPARENT_BYTES = 33 * 1024 * 1024
const UUID = '5f1c0b9e-1111-4222-8333-444455556666'

function line(kind: string, index: number, at: string): string {
  return `${JSON.stringify({
    type: kind === 'head' ? 'user' : 'assistant',
    timestamp: at,
    sessionId: UUID,
    cwd: '/work/app',
    message: { role: kind === 'head' ? 'user' : 'assistant', content: `${kind} ${index}` },
  })}\n`
}

async function oversized(): Promise<AgentSessionsService> {
  const home = await mkdtemp(join(tmpdir(), 'trunc-home-'))
  const dir = join(home, '.claude', 'projects', '-work-app')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${UUID}.jsonl`)

  const head = [0, 1, 2].map((i) => line('head', i, `2026-08-01T10:0${i}:00.000Z`)).join('')
  const tail = [0, 1, 2].map((i) => line('tail', i, `2026-08-01T20:0${i}:00.000Z`)).join('')
  const fd = openSync(path, 'w')
  writeSync(fd, head)
  // Written at an offset, leaving a hole: the file is 33 MB to every reader and 32 KB on disk.
  writeSync(fd, tail, APPARENT_BYTES - Buffer.byteLength(tail), 'utf8')
  closeSync(fd)

  return new AgentSessionsService(await mkdtemp(join(tmpdir(), 'trunc-state-')), () => {}, {
    env: {},
    homeDir: home,
  })
}

describe('a session larger than the adapter cap is reported as cut, not as complete', () => {
  test('a head read says the source was truncated and holds the opening', async () => {
    const slice = await (await oversized()).transcript(`claude-code:${UUID}`, 10, 4000)

    expect(slice?.sourceTruncated).toBe(true)
    expect(slice?.readFrom).toBe('head')
    // The front of the file, which is all a forward read of a capped file can reach.
    expect(slice?.events.map((event) => event.text)).toEqual(['head 0', 'head 1', 'head 2'])
  })

  test('a tail read says the same and holds the END instead', async () => {
    const slice = await (await oversized()).transcript(`claude-code:${UUID}`, 10, 4000, true)

    expect(slice?.sourceTruncated).toBe(true)
    expect(slice?.readFrom).toBe('tail')
    // The boundary line of a backward window starts mid-record and is dropped by design, so the
    // first of the three tail records is the documented cost of reading backwards.
    expect(slice?.events.map((event) => event.text)).toEqual(['tail 1', 'tail 2'])
  })

  test('a session inside the cap is not marked, so the flag means something', async () => {
    const home = await mkdtemp(join(tmpdir(), 'small-home-'))
    const dir = join(home, '.claude', 'projects', '-work-app')
    await mkdir(dir, { recursive: true })
    const fd = openSync(join(dir, `${UUID}.jsonl`), 'w')
    writeSync(fd, line('head', 0, '2026-08-01T10:00:00.000Z'))
    closeSync(fd)
    const svc = new AgentSessionsService(await mkdtemp(join(tmpdir(), 'small-state-')), () => {}, {
      env: {},
      homeDir: home,
    })

    const slice = await svc.transcript(`claude-code:${UUID}`, 10, 4000, true)

    expect(slice?.sourceTruncated).toBeUndefined()
    expect(slice?.withheld).toBe(0)
  })
})
