import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installPaths } from './installer'
import type { LlamaServer } from './llama-server'
import type { LocalModelSpec } from './contracts'
import { createModelRouter, presetSection } from './router'

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

describe('model router', () => {
  test('a stop that lands while the server is starting still stops it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'localix-router-'))
    dirs.push(root)
    let release!: () => void
    // Resolves the moment the router asks for a server: the stop below must land mid-start, and
    // waiting on the call itself (not on a guessed delay) is what makes that true on any machine.
    let startCalled!: () => void
    const starting = new Promise<void>((resolve) => (startCalled = resolve))
    let stopped = 0
    const server: LlamaServer = {
      pid: 1,
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'k',
      running: true,
      request: async () => new Response('{}'),
      stop: async () => {
        stopped += 1
      },
    }
    const router = createModelRouter({
      paths: installPaths(root),
      executable: async () => '/bin/true',
      models: async () => [],
      start: () =>
        new Promise((resolve) => {
          release = () => resolve(server)
          startCalled()
        }),
    })
    const ensured = router.ensure()
    await starting
    const stopping = router.stop()
    release()
    await ensured
    await stopping
    expect(stopped).toBe(1)
    expect(router.state().running).toBe(false)
  })
})

const chat: LocalModelSpec = {
  id: 'ggml-org/gemma-4-E2B-it-GGUF:Q4_0',
  repo: 'ggml-org/gemma-4-E2B-it-GGUF',
  revision: 'r',
  variant: 'Q4_0',
  kind: 'chat',
  label: 'Gemma 4 E2B it (Q4_0)',
  license: null,
  architecture: 'gemma4',
  contextLength: 131072,
  vision: true,
  bytes: 3,
  files: [
    { name: 'gemma.gguf', url: 'u', bytes: 1, sha256: 's', role: 'weights' },
    { name: 'mmproj.gguf', url: 'u', bytes: 1, sha256: 's', role: 'projector' },
    { name: 'mtp.gguf', url: 'u', bytes: 1, sha256: 's', role: 'draft' },
  ],
  draft: { method: 'mtp', repo: 'magnitudedev/gemma-4-E2B-it-qat-MTP-GGUF' },
}

describe('preset sections', () => {
  const paths = installPaths('/m')
  const plan = {
    fit: 'good' as const,
    context: 32768,
    kv: 'q8_0' as const,
    memoryBytes: 1,
    shortBytes: 0,
    offloaded: false,
    tokensPerSecond: 50,
  }

  test('a chat model runs at its planned context and cache type, with its projector and drafter', () => {
    const lines = presetSection({ spec: chat, plan }, paths)
    expect(lines).toContain('c = 32768')
    expect(lines).toContain('fa = on')
    expect(lines).toEqual(expect.arrayContaining(['ctk = q8_0', 'ctv = q8_0']))
    expect(lines.some((l) => l.startsWith('mmproj = ') && l.endsWith('mmproj.gguf'))).toBe(true)
    expect(lines.some((l) => l.startsWith('md = ') && l.endsWith('mtp.gguf'))).toBe(true)
    expect(lines).toContain('spec-type = draft-mtp')
  })

  test('without a plan the context is bounded and the cache stays f16', () => {
    const lines = presetSection({ spec: { ...chat, draft: null }, plan: null }, paths)
    expect(lines).toContain('c = 16384')
    expect(lines.some((l) => l.startsWith('ctk'))).toBe(false)
    expect(lines.some((l) => l.startsWith('md'))).toBe(false)
  })
})
