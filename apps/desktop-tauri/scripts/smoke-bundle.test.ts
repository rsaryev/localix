import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateBundle, parseReadyLine, smokeRuntime } from './smoke-bundle.mjs'

const dir = mkdtempSync(join(tmpdir(), 'smoke-bundle-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A stand-in runtime: serves /health, prints READY, and optionally honors `shutdown`. */
function fakeRuntime(
  name: string,
  { health = 'ok', status = 200, honorShutdown = true, ready = true, exitCode = 0 } = {},
): string {
  const file = join(dir, `${name}.mjs`)
  writeFileSync(
    file,
    `
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => Response.json({ status: ${JSON.stringify(health)}, productId: 'localix-api', protocolVersion: 4 }, { status: ${status} }),
})
if (${ready}) {
  process.stdout.write('noise before the frame\\n')
  process.stdout.write('LOCALIX_RUNTIME_READY ' + JSON.stringify({ baseUrl: 'http://127.0.0.1:' + server.port, startedAt: 'now', protocolVersion: 4 }) + '\\n')
}
if (${honorShutdown}) {
  process.stdin.on('data', (chunk) => { if (String(chunk).includes('shutdown')) process.exit(${exitCode}) })
} else {
  setInterval(() => {}, 1000)
}
`,
  )
  return file
}

const run = (serverJs: string, extra: Record<string, number> = {}) =>
  smokeRuntime({
    bun: process.execPath,
    serverJs,
    readyTimeoutMs: 5_000,
    exitTimeoutMs: 2_000,
    ...extra,
  })

describe('parseReadyLine', () => {
  const frame = (endpoint: unknown) => `LOCALIX_RUNTIME_READY ${JSON.stringify(endpoint)}`

  test('reads the endpoint from a READY frame', () => {
    expect(parseReadyLine(frame({ baseUrl: 'http://127.0.0.1:4100', protocolVersion: 4 }))).toEqual(
      {
        baseUrl: 'http://127.0.0.1:4100',
        protocolVersion: 4,
      },
    )
  })

  test('ignores other output, malformed JSON and a non-loopback address', () => {
    expect(parseReadyLine('[startup] runtime code loaded')).toBeUndefined()
    expect(parseReadyLine('LOCALIX_RUNTIME_READY {not json')).toBeUndefined()
    expect(parseReadyLine(frame({ baseUrl: 'http://example.com:80' }))).toBeUndefined()
    expect(parseReadyLine(frame({ port: 4100 }))).toBeUndefined()
  })
})

describe('smokeRuntime', () => {
  test('passes for a runtime that is healthy and exits cleanly on shutdown', async () => {
    const result = await run(fakeRuntime('healthy'))
    expect(result.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    expect(result.protocolVersion).toBe(4)
  })

  test('fails, with the runtime output, when it exits before READY', async () => {
    const file = join(dir, 'crash.mjs')
    writeFileSync(file, 'console.error("Cannot find package \'kysely\'"); process.exit(1)')
    await expect(run(file)).rejects.toThrow(/exited before READY \(1\)[\s\S]*Cannot find package/u)
  })

  test('fails when no READY frame arrives in time, and does not leave the child running', async () => {
    await expect(
      run(fakeRuntime('silent', { ready: false }), { readyTimeoutMs: 400 }),
    ).rejects.toThrow(/no READY line/u)
  })

  test('fails when /health is not ok', async () => {
    await expect(run(fakeRuntime('draining', { health: 'draining', status: 503 }))).rejects.toThrow(
      /\/health answered 503/u,
    )
  })

  test('fails when the runtime ignores shutdown', async () => {
    await expect(
      run(fakeRuntime('stubborn', { honorShutdown: false }), { exitTimeoutMs: 400 }),
    ).rejects.toThrow(/still running after `shutdown`/u)
  })

  test('fails when the runtime exits non-zero on shutdown', async () => {
    await expect(run(fakeRuntime('dirty', { exitCode: 3 }))).rejects.toThrow(/exited with 3/u)
  })
})

describe('locateBundle', () => {
  /** A tree shaped like a packaged app, with a sparse file standing in for the Bun runtime. */
  function tree(name: string, layout: { bun: string; resources: string; bunBytes?: number }) {
    const root = join(dir, name)
    mkdirSync(join(root, layout.resources, 'plugins'), { recursive: true })
    writeFileSync(join(root, layout.resources, 'server.js'), '')
    mkdirSync(join(root, layout.bun, '..'), { recursive: true })
    writeFileSync(join(root, layout.bun), '')
    truncateSync(join(root, layout.bun), layout.bunBytes ?? 60 * 1024 * 1024)
    return root
  }

  test('finds the sidecar and resources in a macOS app, an AppImage and a Windows install', () => {
    for (const [name, layout] of [
      ['mac', { bun: 'Contents/MacOS/bun', resources: 'Contents/Resources/resources' }],
      ['appimage', { bun: 'usr/bin/bun', resources: 'usr/lib/Localix/resources' }],
      ['windows', { bun: 'bun.exe', resources: 'resources' }],
    ] as const) {
      const root = tree(name, layout)
      expect(locateBundle(root)).toEqual({
        bun: join(root, layout.bun),
        resources: join(root, layout.resources),
      })
    }
  })

  test('does not mistake a small file named bun for the sidecar', () => {
    const root = tree('small-bun', {
      bun: 'usr/bin/bun',
      resources: 'usr/lib/Localix/resources',
      bunBytes: 1024,
    })
    expect(locateBundle(root)).toBeUndefined()
  })

  test('finds nothing when the resources are not staged', () => {
    const root = join(dir, 'unstaged')
    mkdirSync(join(root, 'resources'), { recursive: true })
    writeFileSync(join(root, 'bun'), '')
    truncateSync(join(root, 'bun'), 60 * 1024 * 1024)
    expect(locateBundle(root)).toBeUndefined()
  })
})
