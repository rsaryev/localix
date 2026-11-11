import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { SessionIndex } from './index-cache'
import type { AdapterEnv, ProviderAdapter, SourceRef } from '../adapters/types'

/**
 * The index is one document: on a real history 7 MB. A running agent changes its transcript every
 * few seconds, and every History refresh that saw the change rewrote the whole document — about
 * 5 GB an hour of disk writes for one busy session. The in-memory index is the truth while the
 * process runs; the document only spares the next start a re-read, so it is written at most once
 * per interval, the last change trailing.
 */
const dir = tempDirPerTest('ea-index-persist')
const ENV: AdapterEnv = { env: {}, homeDir: '/nonexistent' }

function fake(refs: SourceRef[]) {
  const state = { refs }
  const adapter: ProviderAdapter = {
    command: 'fixture-agent',
    id: 'fake',
    displayName: 'Fake',
    sourceFormat: 'fake',
    verified: false,
    probeRoots: async () => [],
    listSources: async () => state.refs,
    readSummaries: async (wanted) =>
      wanted.map((ref) => ({
        key: `fake:${ref.nativeSessionId}`,
        provider: 'fake',
        nativeSessionId: ref.nativeSessionId,
        title: ref.revision,
        updatedAt: 1_000,
        sourcePath: ref.sourcePath,
      })),
    readTranscript: async () => ({ events: [], total: 0 }),
  }
  return { adapter, state }
}

const ref = (revision: string): SourceRef => ({
  nativeSessionId: 'a',
  sourcePath: '/tmp/a',
  revision,
})

/** A clock the test moves, and a delay the test releases. */
function controls() {
  let clock = 0
  const pending: (() => void)[] = []
  return {
    now: () => clock,
    advance: (ms: number) => (clock += ms),
    delay: () => new Promise<void>((resolve) => pending.push(resolve)),
    release: () => {
      for (const resolve of pending.splice(0)) resolve()
    },
    get waiting() {
      return pending.length
    },
  }
}

function stored(): string[] {
  const doc = JSON.parse(readFileSync(join(dir(), 'index.json'), 'utf8'))
  return Object.values(doc.providers.fake as Record<string, { title: string }>).map((s) => s.title)
}

describe('the index document is not rewritten on every change', () => {
  test('changes inside the interval share one trailing write of the latest state', async () => {
    const { adapter, state } = fake([ref('r1')])
    const time = controls()
    const index = new SessionIndex([adapter], ENV, dir(), () => {}, time)

    await index.scan(adapter)
    expect(stored()).toEqual(['r1'])

    for (const revision of ['r2', 'r3']) {
      time.advance(5_000)
      state.refs = [ref(revision)]
      expect((await index.scan(adapter)).summaries.map((s) => s.title)).toEqual([revision])
    }
    // The memory has the change at once; the document has not been rewritten for it yet.
    expect(stored()).toEqual(['r1'])
    expect(time.waiting).toBe(1)

    time.release()
    await index.settled()
    expect(stored()).toEqual(['r3'])
  })

  test('a change after the interval has passed is written at once', async () => {
    const { adapter, state } = fake([ref('r1')])
    const time = controls()
    const index = new SessionIndex([adapter], ENV, dir(), () => {}, time)
    await index.scan(adapter)

    time.advance(60_000)
    state.refs = [ref('r2')]
    await index.scan(adapter)
    expect(stored()).toEqual(['r2'])
    expect(time.waiting).toBe(0)
  })
})

describe('shutting down', () => {
  test('a write that is due lands at shutdown rather than with the next start', async () => {
    const { adapter, state } = fake([ref('r1')])
    const time = controls()
    const index = new SessionIndex([adapter], ENV, dir(), () => {}, time)
    await index.scan(adapter)
    time.advance(5_000)
    state.refs = [ref('r2')]
    await index.scan(adapter)

    await index.close()
    expect(stored()).toEqual(['r2'])
  })
})
