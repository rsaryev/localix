import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { LocalModelSpec } from './contracts'
import { discardDownload, installPaths } from './installer'

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

const spec: LocalModelSpec = {
  id: 'ggml-org/gemma-4-E2B-it-GGUF:Q4_0',
  repo: 'ggml-org/gemma-4-E2B-it-GGUF',
  revision: 'r',
  variant: 'Q4_0',
  kind: 'chat',
  label: 'Gemma 4 E2B it',
  license: null,
  architecture: null,
  contextLength: null,
  vision: false,
  files: [{ name: 'gemma.gguf', url: 'u', bytes: 1, sha256: 's', role: 'weights' }],
  bytes: 1,
}

describe('discarding a download', () => {
  test('cancelling an update keeps the installed model; only what it added goes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'localix-installer-'))
    dirs.push(root)
    const paths = installPaths(root)
    const dir = paths.modelDir(spec.id)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'gemma.gguf'), 'w')
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ spec }))
    // An update fetching a draft model, cancelled part-way.
    await writeFile(path.join(dir, 'mtp.gguf.part'), 'partial')
    await writeFile(path.join(dir, 'pending.json'), '{}')
    await discardDownload(paths, spec.id)
    expect((await readdir(dir)).sort()).toEqual(['gemma.gguf', 'manifest.json'])
  })

  test('a model that was never installed loses its folder', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'localix-installer-'))
    dirs.push(root)
    const paths = installPaths(root)
    const dir = paths.modelDir(spec.id)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'gemma.gguf.part'), 'partial')
    await discardDownload(paths, spec.id)
    expect(await readdir(dir).catch(() => null)).toBeNull()
  })
})
