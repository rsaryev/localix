/**
 * `exportRequests` — that it WRITES what is safe and REFUSES what is not.
 *
 * `format.test.ts` proves `gitSafetyProblem` returns a string. That is not the same claim: nothing
 * proved the action reads it. The refusal is called "the POINT of this action", and until this file
 * existed, deleting the check would have left every test green while a credential went into the
 * repo — the one place it can never be taken back out.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EXPORT_DIR, exportDirFor, exportRequests, readExportedFiles } from './action'
import type { RequestSpec } from '../request-spec'
import type { CollectionRequest, CollectionStore } from '../collection/store'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
async function tmpRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rest-export-'))
  dirs.push(dir)
  return dir
}

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.github.com/user',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

const saved = (id: string, over: Partial<RequestSpec> = {}): CollectionRequest => ({
  name: id,
  createdAt: 0,
  updatedAt: 0,
  spec: spec(over),
})

/** Only `list` is exercised — the exporter reads the whole collection and writes files. */
function stubStore(rows: CollectionRequest[]): CollectionStore {
  return {
    root: () => '/memory',
    list: async () => rows,
    get: async (name) => rows.find((r) => r.name === name) ?? null,
    save: async () => ({ ok: false, problem: 'not used by the exporter' }),
    remove: async () => false,
    rename: async () => ({ ok: false, problem: 'not used by the exporter' }),
  }
}

const run = (
  cwd: string,
  rows: CollectionRequest[],
  opts: { subdir?: string; names?: string[] } = {},
) => exportRequests({ store: stubStore(rows), userId: 'u', cwd, ...opts })

describe('the refusal is HONOURED, not merely computed', () => {
  test('a request with a literal credential produces NO file', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [saved('leaky', { auth: { type: 'bearer', token: 'ghp_CANARY' } })])
    expect('problem' in out).toBe(false)
    if ('problem' in out) return
    expect(out.written).toEqual([])
    expect(out.refused).toEqual(['leaky'])
    // The claim that matters: nothing on disk.
    expect(await readdir(path.join(cwd, EXPORT_DIR)).catch(() => [])).toEqual([])
  })

  test('the canary reaches no byte of the tree', async () => {
    const cwd = await tmpRepo()
    await run(cwd, [
      saved('leaky', { auth: { type: 'bearer', token: 'ghp_CANARY' } }),
      saved('fine'),
    ])
    const files = await readdir(path.join(cwd, EXPORT_DIR))
    const all = await Promise.all(files.map((f) => readFile(path.join(cwd, EXPORT_DIR, f), 'utf8')))
    expect(all.join('')).not.toContain('ghp_CANARY')
  })

  test('a literal credential HEADER is refused too — a HAR import puts it there', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [
      saved('har', { headers: [{ name: 'Cookie', value: 'session=abc' }] }),
    ])
    if ('problem' in out) return
    expect(out.written).toEqual([])
    expect(out.problems.join(' ')).toContain('git history')
  })

  test('the SAFE sibling is still exported — one refusal does not fail the batch', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [
      saved('leaky', { auth: { type: 'bearer', token: 'x' } }),
      saved('fine'),
    ])
    if ('problem' in out) return
    expect(out.written).toEqual(['fine.json'])
    expect(out.refused).toEqual(['leaky'])
  })

  test('a ${secret:} reference exports — a pointer is shareable by construction', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [saved('gh', { auth: { type: 'bearer', token: '${secret:GH}' } })])
    if ('problem' in out) return
    expect(out.written).toEqual(['gh.json'])
    const file = await readFile(path.join(cwd, EXPORT_DIR, 'gh.json'), 'utf8')
    expect(file).toContain('${secret:GH}')
  })

  test('EVERY request refused means nothing written and an error, not a silent success', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [saved('leaky', { auth: { type: 'bearer', token: 'x' } })])
    if ('problem' in out) return
    expect(out.written).toEqual([])
    expect(out.problems).toHaveLength(1)
  })
})

describe('what it writes', () => {
  test('one file per request, named after it', async () => {
    const cwd = await tmpRepo()
    await run(cwd, [saved('github-user'), saved('stripe-charge')])
    expect((await readdir(path.join(cwd, EXPORT_DIR))).sort()).toEqual([
      'github-user.json',
      'stripe-charge.json',
    ])
  })

  test('the file round-trips through the importer chain', async () => {
    const cwd = await tmpRepo()
    await run(cwd, [saved('gh')])
    const texts = await readExportedFiles(cwd)
    expect(Array.isArray(texts)).toBe(true)
    if (!Array.isArray(texts)) return
    expect(texts).toHaveLength(1)
    expect(JSON.parse(texts[0]).name).toBe('gh')
  })

  test('`names` exports only those', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [saved('a'), saved('b')], { names: ['b'] })
    if ('problem' in out) return
    expect(out.written).toEqual(['b.json'])
  })

  test('an unknown name is a problem, not an empty success', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [saved('a')], { names: ['nope'] })
    expect('problem' in out).toBe(true)
  })

  test('nothing saved is a problem, not an empty directory', async () => {
    expect('problem' in (await run(await tmpRepo(), []))).toBe(true)
  })

  test('two names that slug to ONE file: the second is refused, not silently overwritten', async () => {
    const cwd = await tmpRepo()
    const out = await run(cwd, [saved('my request'), saved('my/request')])
    if ('problem' in out) return
    expect(out.written).toEqual(['my-request.json'])
    expect(out.problems.join(' ')).toContain('both map to the file')
  })
})

describe('the export directory cannot escape the working tree', () => {
  test.each(['../evil', '../../tmp/evil', '/etc', '../'])('%p is refused', async (subdir) => {
    // `subdir` arrives from a tool argument. A mini app that writes wherever a model asks is a
    // mini app that writes to ~/.ssh.
    const cwd = await tmpRepo()
    expect(exportDirFor(cwd, subdir)).toBeNull()
    expect('problem' in (await run(cwd, [saved('a')], { subdir }))).toBe(true)
  })

  test.each(['.localix/rest', 'api/requests', './x'])('%p is allowed', async (subdir) => {
    const cwd = await tmpRepo()
    expect(exportDirFor(cwd, subdir)).not.toBeNull()
  })

  test('the default lands inside the tree', async () => {
    const cwd = await tmpRepo()
    expect(exportDirFor(cwd)).toBe(path.join(cwd, EXPORT_DIR))
  })
})

describe('reading back', () => {
  test('a missing directory is a problem, not a crash', async () => {
    expect('problem' in (await readExportedFiles(await tmpRepo()))).toBe(true)
  })

  test('a foreign file in the directory is SKIPPED, not fatal — it is a repo', async () => {
    const cwd = await tmpRepo()
    await run(cwd, [saved('gh')])
    await writeFile(path.join(cwd, EXPORT_DIR, 'README.json'), '{"not":"ours"}')
    await writeFile(path.join(cwd, EXPORT_DIR, 'notes.txt'), 'ignore me')
    const texts = await readExportedFiles(cwd)
    if (!Array.isArray(texts)) throw new Error('expected files')
    expect(texts).toHaveLength(1)
  })

  test('an escaping dir is refused on the way in too', async () => {
    expect('problem' in (await readExportedFiles(await tmpRepo(), '../evil'))).toBe(true)
  })

  test('a subdir that exists but holds nothing of ours is empty, not an error', async () => {
    const cwd = await tmpRepo()
    await mkdir(path.join(cwd, 'empty'), { recursive: true })
    expect(await readExportedFiles(cwd, 'empty')).toEqual([])
  })
})
