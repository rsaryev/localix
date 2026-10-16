import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { publishRuntimeEndpoint, readRuntimeEndpoint } from './runtime-endpoint'
import { LOCALIX_API_PROTOCOL_VERSION } from './runtime-protocol'
import { computeRuntimeBuildId, isSameBuild } from './runtime-build'

/**
 * After an update the relaunched shell attached to the PREVIOUS build's runtime, because
 * the only thing compared was the protocol version, which does not move between builds.
 */
let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'runtime-build-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('runtime build identity', () => {
  test('a rebuilt entry is a different build; the same file is the same one', () => {
    const entry = join(dir, 'server.js')
    writeFileSync(entry, 'console.log("build one")')
    utimesSync(entry, 1_700_000_000, 1_700_000_000)
    const first = computeRuntimeBuildId(entry)
    expect(computeRuntimeBuildId(entry)).toBe(first)

    writeFileSync(entry, 'console.log("build two, longer")')
    utimesSync(entry, 1_700_000_500, 1_700_000_500)
    expect(computeRuntimeBuildId(entry)).not.toBe(first)
  })

  test('the path is not part of it: an AppImage remounts at a new path every launch', () => {
    const a = join(dir, 'mount-a.js')
    const b = join(dir, 'mount-b.js')
    for (const file of [a, b]) {
      writeFileSync(file, 'same bytes')
      utimesSync(file, 1_700_000_000, 1_700_000_000)
    }
    expect(computeRuntimeBuildId(a)).toBe(computeRuntimeBuildId(b))
  })

  test('only the same build may be attached to; a pre-field runtime never is', () => {
    expect(isSameBuild({ buildId: 'abc' }, 'abc')).toBe(true)
    expect(isSameBuild({ buildId: 'abc' }, 'def')).toBe(false)
    expect(isSameBuild({}, 'abc')).toBe(false)
  })

  test('the descriptor carries the build and rejects a malformed one', async () => {
    const file = join(dir, 'api-runtime.json')
    const endpoint = {
      pid: 42,
      baseUrl: 'http://127.0.0.1:5050',
      startedAt: 'now',
      protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
      buildId: 'abc123',
    }
    await publishRuntimeEndpoint(endpoint, file)
    expect((await readRuntimeEndpoint(file))?.buildId).toBe('abc123')
    await publishRuntimeEndpoint({ ...endpoint, buildId: 7 as unknown as string }, file)
    expect(await readRuntimeEndpoint(file)).toBeNull()
  })
})
