import { afterAll, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { HfClient, HfRepoInfo } from './hf-client'
import { startLlamaServer } from './llama-server'
import type { RuntimeBuild } from './runtime'
import type { LocalModelSpec } from './contracts'
import { profileFrom } from './machine'
import { createLocalModelsService } from './service'

const run = promisify(execFile)
const FAKE = path.join(import.meta.dir, 'testing', 'fake-llama-server.ts')
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
const temps: string[] = []
const temp = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'localix-local-models-'))
  temps.push(dir)
  return dir
}

// A runtime archive with one top folder holding `llama-server`, like llama.cpp's releases.
const archiveDir = await temp()
await mkdir(path.join(archiveDir, 'llama-b1'), { recursive: true })
await writeFile(path.join(archiveDir, 'llama-b1', 'llama-server'), '#!/bin/sh\n')
await run('tar', ['-czf', path.join(archiveDir, 'rt.tar.gz'), '-C', archiveDir, 'llama-b1'], {
  timeout: 10_000,
  killSignal: 'SIGKILL',
  windowsHide: true,
})
const archive = new Uint8Array(await readFile(path.join(archiveDir, 'rt.tar.gz')))
const weights = new TextEncoder().encode('gguf weights '.repeat(500))
/** When set, model files stream in slow pieces so a test can stop a download part-way. */
let slow = false
const ranges: string[] = []

function weightsResponse(req: Request): Response {
  const range = req.headers.get('range')
  if (range) ranges.push(range)
  const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
  const body = weights.slice(from)
  if (!slow) return new Response(body, { status: from ? 206 : 200 })
  const piece = 500
  let at = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await Bun.sleep(40)
      if (at >= body.length) return controller.close()
      controller.enqueue(body.slice(at, at + piece))
      at += piece
    },
  })
  return new Response(stream, { status: from ? 206 : 200 })
}

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/rt.tar.gz') return new Response(archive)
    if (pathname.endsWith('.gguf')) return weightsResponse(req)
    return new Response('missing', { status: 404 })
  },
})
afterAll(async () => {
  await server.stop(true)
  for (const d of temps) await rm(d, { recursive: true, force: true })
})

const build: RuntimeBuild = {
  tag: 'b1',
  archive: {
    name: 'rt.tar.gz',
    url: `http://127.0.0.1:${server.port}/rt.tar.gz`,
    bytes: archive.byteLength,
    sha256: sha(archive),
    format: 'tar.gz',
  },
  executable: 'llama-server',
}

function hfWith(fileSha: string): HfClient {
  const info: HfRepoInfo = {
    id: 'google/compact-GGUF',
    sha: 'rev1',
    pipeline_tag: 'text-generation',
    gguf: { context_length: 4096, total: 1e9 },
    siblings: [{ rfilename: 'tiny-Q4_0.gguf', size: weights.byteLength, lfs: { sha256: fileSha } }],
  }
  // A list row carries file names, not sizes or hashes: the catalog estimates until it reads the repo.
  const row = { ...info, siblings: [{ rfilename: 'tiny-Q4_0.gguf' }] }
  return {
    repo: async () => info,
    meta: async () => info,
    // The drafters' publisher lists nothing; the catalog's own listing and a search find the model.
    models: async ({ author }) => (author === 'magnitudedev' ? [] : [row]),
  }
}

/** Wait until the model's file is half-way on disk (progress events are per megabyte). */
async function midDownload(root: string) {
  const part = path.join(root, 'models', 'google--compact-GGUF--Q4_0', 'tiny-Q4_0.gguf.part')
  for (let i = 0; i < 200; i++) {
    const size = (await stat(part).catch(() => null))?.size ?? 0
    if (size >= 1500) return
    await Bun.sleep(10)
  }
  throw new Error('the download never got under way')
}

/** A roomy computer, so every test model fits. */
const machine = profileFrom({
  platform: 'darwin',
  arch: 'arm64',
  memoryBytes: 64 * 2 ** 30,
  cpu: 'Apple M4 Max',
  devices: null,
})

async function setup(fileSha = sha(weights), requiredModels: readonly LocalModelSpec[] = []) {
  const root = await temp()
  const service = createLocalModelsService({
    root,
    requiredModels,
    hf: hfWith(fileSha),
    runtimeBuild: build,
    detect: async () => machine,
    // The router is started for real, over a stand-in that speaks the same contract.
    startServer: (options) =>
      startLlamaServer({
        ...options,
        executable: process.execPath,
        args: (port, key) => [FAKE, ...options.args(port, key)],
      }),
  })
  await service.boot()
  return { root, service }
}

// Hugging Face file URLs point at huggingface.co; the test serves them locally instead.
const realFetch = globalThis.fetch
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return realFetch(url.replace('https://huggingface.co', `http://127.0.0.1:${server.port}`), init)
}) as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

describe('local models service', () => {
  test('install downloads the runtime and the model, verifies them, and serves the model', async () => {
    const { service, root } = await setup()
    const id = 'google/compact-GGUF:Q4_0'
    expect(
      (await service.catalog.list()).map((e) => [e.spec.id, e.installed, e.plan?.fit]),
    ).toEqual([[id, false, 'good']])
    await service.install(id)
    for (let i = 0; i < 100 && service.job(id); i++) await Bun.sleep(20)
    expect(service.isInstalled(id)).toBe(true)
    const status = await service.status()
    expect(status).toMatchObject({ runtime: { installed: true, tag: 'b1' }, jobs: [] })
    const presets = await readFile(path.join(root, 'router', 'presets.ini'), 'utf8')
    expect(presets).toContain(`[${id}]`)
    expect(presets).toContain('jinja = true')
    const router = await service.router.ensure()
    const res = await router.request('/v1/embeddings', {
      method: 'POST',
      body: JSON.stringify({ model: id, input: ['x'] }),
    })
    expect(res.ok).toBe(true)
    await service.shutdown()
  }, 30_000)

  test('a file that fails its checksum fails the job and installs nothing', async () => {
    const { service } = await setup('0'.repeat(64))
    const id = 'google/compact-GGUF:Q4_0'
    await service.install(id)
    for (let i = 0; i < 100 && service.job(id)?.phase !== 'failed'; i++) await Bun.sleep(20)
    expect(service.job(id)).toMatchObject({ phase: 'failed' })
    expect(service.job(id)!.error).toContain('checksum')
    expect(service.isInstalled(id)).toBe(false)
  }, 30_000)

  test('remove deletes the model and lists it as downloadable again', async () => {
    const { service } = await setup()
    const id = 'google/compact-GGUF:Q4_0'
    await service.install(id)
    for (let i = 0; i < 100 && service.job(id); i++) await Bun.sleep(20)
    let changes = 0
    service.onListChanged(() => (changes += 1))
    await service.remove(id)
    expect(service.isInstalled(id)).toBe(false)
    expect(changes).toBe(1)
  }, 30_000)

  test('an unknown model id is refused before anything downloads', async () => {
    const { service } = await setup()
    await expect(service.install('nobody/none-GGUF:Q4_0')).rejects.toThrow('Unknown local model')
  })

  test('pause keeps what was fetched, survives a restart as paused, and resumes from it', async () => {
    const { service, root } = await setup()
    const id = 'google/compact-GGUF:Q4_0'
    slow = true
    ranges.length = 0
    try {
      await service.install(id)
      await midDownload(root)
      await service.pause(id)
      const paused = (await service.status()).paused
      expect(paused).toHaveLength(1)
      expect(paused[0]!.received).toBeGreaterThan(0)
      expect(paused[0]!.received).toBeLessThan(weights.byteLength)

      // A new service over the same folder (an app restart) still lists it as paused.
      const again = createLocalModelsService({
        root,
        hf: hfWith(sha(weights)),
        runtimeBuild: build,
      })
      await again.boot()
      expect((await again.status()).paused.map((p) => p.modelId)).toEqual([id])

      slow = false
      await again.install(id)
      for (let i = 0; i < 100 && again.job(id); i++) await Bun.sleep(20)
      expect(again.isInstalled(id)).toBe(true)
      expect(ranges.some((r) => r !== 'bytes=0-')).toBe(true)
      expect((await again.status()).paused).toEqual([])
    } finally {
      slow = false
    }
  }, 30_000)

  test('cancel deletes a running or a paused download', async () => {
    const { service, root } = await setup()
    const id = 'google/compact-GGUF:Q4_0'
    slow = true
    try {
      await service.install(id)
      await midDownload(root)
      await service.cancel(id)
      expect(service.job(id)).toBeNull()
      expect((await service.status()).paused).toEqual([])

      await service.install(id)
      await midDownload(root)
      await service.pause(id)
      expect((await service.status()).paused).toHaveLength(1)
      await service.cancel(id)
      expect((await service.status()).paused).toEqual([])
      expect(service.isInstalled(id)).toBe(false)
    } finally {
      slow = false
    }
  }, 30_000)

  test('a chat waits for a model still downloading, and is told why one is not coming', async () => {
    const { service } = await setup()
    const id = 'google/compact-GGUF:Q4_0'
    await expect(service.whenReady(id, 'Compact')).rejects.toThrow(
      'Compact is not downloaded. Pick it in the model picker to download it.',
    )
    slow = true
    try {
      await service.install(id)
      const ready = service.whenReady(id, 'Compact')
      slow = false
      await ready
      expect(service.isInstalled(id)).toBe(true)
    } finally {
      slow = false
    }
    await service.shutdown()
  }, 30_000)

  test('a download cut by quitting goes on by itself at the next start', async () => {
    const { service, root } = await setup()
    const id = 'google/compact-GGUF:Q4_0'
    slow = true
    try {
      await service.install(id)
      await midDownload(root)
      await service.shutdown()
      slow = false
      const again = createLocalModelsService({
        root,
        hf: hfWith(sha(weights)),
        runtimeBuild: build,
        detect: async () => machine,
      })
      await again.boot()
      for (let i = 0; i < 100 && !again.isInstalled(id); i++) await Bun.sleep(20)
      expect(again.isInstalled(id)).toBe(true)
    } finally {
      slow = false
    }
  }, 30_000)

  test('a download queued behind another pauses and cancels at once, not when that one ends', async () => {
    const ahead: LocalModelSpec = {
      id: 'google/ahead-GGUF:Q4_0',
      repo: 'google/ahead-GGUF',
      revision: 'rev1',
      variant: 'Q4_0',
      kind: 'chat',
      label: 'Ahead',
      license: null,
      architecture: null,
      contextLength: 4096,
      vision: false,
      files: [
        {
          name: 'ahead-Q4_0.gguf',
          url: 'https://huggingface.co/google/ahead-GGUF/resolve/rev1/ahead-Q4_0.gguf',
          bytes: weights.length,
          sha256: sha(weights),
          role: 'weights',
        },
      ],
      bytes: weights.length,
    }
    slow = true
    try {
      // The kept model downloads first, slowly; the person's pick waits behind it.
      const { service } = await setup(sha(weights), [ahead])
      const id = 'google/compact-GGUF:Q4_0'
      await service.install(id)
      expect(service.job(id)).toMatchObject({ phase: 'queued' })

      const started = performance.now()
      await service.pause(id)
      expect(performance.now() - started).toBeLessThan(500)
      expect(service.job(id)).toBeNull()

      await service.install(id)
      await service.cancel(id)
      expect(performance.now() - started).toBeLessThan(1_000)
      expect(service.job(id)).toBeNull()
      // The download ahead was never touched.
      expect(service.job(ahead.id)).toMatchObject({ modelId: ahead.id, error: null })
      await service.shutdown()
    } finally {
      slow = false
    }
  }, 30_000)

  test('a model Localix keeps is fetched at start by itself, and cannot be cancelled or removed', async () => {
    const kept: LocalModelSpec = {
      id: 'google/compact-GGUF:Q4_0',
      repo: 'google/compact-GGUF',
      revision: 'rev1',
      variant: 'Q4_0',
      kind: 'chat',
      label: 'Compact',
      license: null,
      architecture: null,
      contextLength: 4096,
      vision: false,
      files: [
        {
          name: 'tiny-Q4_0.gguf',
          url: 'https://huggingface.co/google/compact-GGUF/resolve/rev1/tiny-Q4_0.gguf',
          bytes: weights.length,
          sha256: sha(weights),
          role: 'weights',
        },
      ],
      bytes: weights.length,
    }
    const { service } = await setup(sha(weights), [kept])
    for (let i = 0; i < 100 && !service.isInstalled(kept.id); i++) await Bun.sleep(20)
    expect(service.isInstalled(kept.id)).toBe(true)
    expect((await service.status()).installed[0]).toMatchObject({ id: kept.id, required: true })
    await expect(service.remove(kept.id)).rejects.toMatchObject({ status: 409 })
    await expect(service.cancel(kept.id)).rejects.toMatchObject({ status: 409 })
    expect(service.isInstalled(kept.id)).toBe(true)
    await service.shutdown()
  }, 30_000)
})
