import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionIndex } from './index-cache'
import type { AdapterEnv, ProviderAdapter, SourceRef } from '../adapters/types'
import type { SessionSummary } from '../../shared/contracts'

/**
 * The index is what makes this plugin openable: on a large history a cold scan costs hundreds of
 * milliseconds and a warm one a few, and the whole difference is here. Its claims are strong —
 * invalidation on a real change signal rather than a clock, concurrent scans coalescing, deleted
 * revisions evicted rather than accumulating — and none of them were witnessed.
 */
const ENV: AdapterEnv = { env: {}, homeDir: '/nonexistent' }

function summaryOf(ref: SourceRef): SessionSummary {
  return {
    key: `fake:${ref.nativeSessionId}`,
    provider: 'fake',
    nativeSessionId: ref.nativeSessionId,
    title: `title@${ref.revision}`,
    updatedAt: 1_000,
    sourcePath: ref.sourcePath,
  }
}

/** An adapter that counts what it was asked to parse — the cost the cache exists to avoid. */
function counting(refs: SourceRef[]) {
  const state = { refs, parsed: [] as string[][], scans: 0 }
  const adapter: ProviderAdapter = {
    command: 'fixture-agent',
    id: 'fake',
    displayName: 'Fake',
    sourceFormat: 'fake',
    verified: false,
    async probeRoots() {
      return []
    },
    async listSources() {
      state.scans += 1
      return state.refs
    },
    async readSummaries(wanted) {
      state.parsed.push(wanted.map((ref) => ref.nativeSessionId))
      return wanted.map(summaryOf)
    },
    async readTranscript() {
      return { events: [], total: 0 }
    },
  }
  return { adapter, state }
}

const ref = (id: string, revision: string): SourceRef => ({
  nativeSessionId: id,
  sourcePath: `/tmp/${id}`,
  revision,
})

async function stateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ea-index-'))
}

describe('the session index', () => {
  test('a second scan parses nothing when nothing changed', async () => {
    const { adapter, state } = counting([ref('a', 'r1'), ref('b', 'r1')])
    const dir = await stateDir()
    const index = new SessionIndex([adapter], ENV, dir, () => {})

    const first = await index.scan(adapter)
    expect(first.summaries).toHaveLength(2)
    expect(state.parsed).toEqual([['a', 'b']])

    // A fresh index over the same state dir: this is the warm path, and it must read no file.
    const warm = new SessionIndex([adapter], ENV, dir, () => {})
    const second = await warm.scan(adapter)
    expect(second.summaries).toHaveLength(2)
    expect(state.parsed).toEqual([['a', 'b']])
  })

  test('only the entry whose revision moved is re-parsed', async () => {
    // Invalidation is keyed on a real change signal (`mtime|size`), not a clock — so an unchanged
    // neighbour costs nothing when one file is rewritten.
    const { adapter, state } = counting([ref('a', 'r1'), ref('b', 'r1')])
    const dir = await stateDir()
    await new SessionIndex([adapter], ENV, dir, () => {}).scan(adapter)

    state.refs = [ref('a', 'r1'), ref('b', 'r2')]
    const index = new SessionIndex([adapter], ENV, dir, () => {})
    const result = await index.scan(adapter)

    expect(state.parsed[1]).toEqual(['b'])
    expect(result.summaries.find((s) => s.nativeSessionId === 'b')?.title).toBe('title@r2')
  })

  test('a superseded revision is evicted rather than kept forever', async () => {
    // The cache is REBUILT per scan, not mutated: otherwise every rewrite of a busy transcript
    // leaves its old revision behind and the file grows without bound.
    const { adapter, state } = counting([ref('a', 'r1')])
    const dir = await stateDir()
    await new SessionIndex([adapter], ENV, dir, () => {}).scan(adapter)
    state.refs = [ref('a', 'r2')]
    await new SessionIndex([adapter], ENV, dir, () => {}).scan(adapter)

    const stored = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))
    expect(Object.keys(stored.providers.fake)).toEqual(['a|r2'])
  })

  test('two callers arriving together share one scan', async () => {
    const { adapter, state } = counting([ref('a', 'r1')])
    const index = new SessionIndex([adapter], ENV, await stateDir(), () => {})
    await Promise.all([index.scan(adapter), index.scan(adapter)])
    expect(state.scans).toBe(1)
  })

  test('two sessions sharing a revision do not serve each other', async () => {
    // A revision is only unique WITHIN a session — `mtime|size` for a file, a millisecond
    // `time_updated` for an opencode row — so keying the cache on it alone made one session's
    // summary answer under the other's name.
    const { adapter, state } = counting([ref('a', 'same'), ref('b', 'same')])
    const dir = await stateDir()
    await new SessionIndex([adapter], ENV, dir, () => {}).scan(adapter)

    const warm = await new SessionIndex([adapter], ENV, dir, () => {}).scan(adapter)
    expect(warm.summaries.map((s) => s.nativeSessionId).sort()).toEqual(['a', 'b'])
    // Both were parsed once and neither was re-parsed on the warm pass.
    expect(state.parsed).toEqual([['a', 'b']])
  })

  test('a cache written by an older version is a cold start, not a wrong answer', async () => {
    // The reason CACHE_VERSION exists: a parser change does not move a row's revision, so without
    // it the cache keeps serving summaries the current parser would never produce.
    const dir = await stateDir()
    await writeFile(
      join(dir, 'index.json'),
      JSON.stringify({ version: 0, providers: { fake: { 'a|r1': summaryOf(ref('a', 'r1')) } } }),
      'utf8',
    )
    const { adapter, state } = counting([ref('a', 'r1')])
    await new SessionIndex([adapter], ENV, dir, () => {}).scan(adapter)
    expect(state.parsed).toEqual([['a']])
  })

  test('a corrupt cache is a cold start, not a crash', async () => {
    const dir = await stateDir()
    await writeFile(join(dir, 'index.json'), '{ this is not json', 'utf8')
    const { adapter, state } = counting([ref('a', 'r1')])
    const result = await new SessionIndex([adapter], ENV, dir, () => {}).scan(adapter)
    expect(result.summaries).toHaveLength(1)
    expect(state.parsed).toEqual([['a']])
  })

  test('a provider that throws reports its own error instead of taking the scan down', async () => {
    const { adapter } = counting([])
    const broken: ProviderAdapter = {
      ...adapter,
      async listSources() {
        throw new Error('EACCES ~/.fake')
      },
    }
    const result = await new SessionIndex([broken], ENV, await stateDir(), () => {}).scan(broken)
    expect(result.summaries).toEqual([])
    expect(result.status.error).toContain('EACCES')
  })

  test('a grown session resumes from the fold it left, even after a restart', async () => {
    const dir = await stateDir()
    const { adapter, state } = counting([ref('a', 'r1'), ref('b', 'r1')])
    const handed: (number | undefined)[] = []
    const folding: ProviderAdapter = {
      ...adapter,
      async foldSummary(source, previous) {
        handed.push(previous?.fold?.offset)
        return {
          summary: summaryOf(source),
          fold: { offset: (previous?.fold?.offset ?? 0) + 10, mark: 'm' },
        }
      },
    }
    await new SessionIndex([folding], ENV, dir, () => {}).scan(folding)
    state.refs = [ref('a', 'r2'), ref('b', 'r1')]
    await new SessionIndex([folding], ENV, dir, () => {}).scan(folding)
    // Both cold, then only `a` again — handed the offset its first fold stopped at.
    expect(handed).toEqual([undefined, undefined, 10])
    expect(state.parsed).toEqual([])
    const stored = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))
    expect(stored.folds.fake).toEqual({
      a: { offset: 20, mark: 'm' },
      b: { offset: 10, mark: 'm' },
    })
  })

  test('providers scanned together after a restart all start from the stored cache', async () => {
    const dir = await stateDir()
    const fakes = ['a', 'b', 'c'].map((id) => {
      const { adapter, state } = counting([ref(`${id}-1`, 'r1')])
      return { adapter: { ...adapter, id } as ProviderAdapter, state }
    })
    const adapters = fakes.map((fake) => fake.adapter)
    await new SessionIndex(adapters, ENV, dir, () => {}).scanAll()
    for (const fake of fakes) fake.state.parsed = []
    await new SessionIndex(adapters, ENV, dir, () => {}).scanAll()
    expect(fakes.map((fake) => fake.state.parsed)).toEqual([[], [], []])
  })
})
