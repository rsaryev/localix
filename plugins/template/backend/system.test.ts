import { expect, test } from 'bun:test'
import { createSystemReader, cpuPercent, type SystemSource } from './system'
import { createTemplateRoutes } from './routes'
import type { SystemMarksService } from './system-marks'
import { createSystemResourceProvider } from './context'
import { SYSTEM_URI, formatSystemSnapshot, systemSnapshotSchema } from '../shared/system'
import { systemMessageContext } from '../ui/system/bindings'

const cpu = (idle: number, user: number) => ({
  model: 'Example CPU',
  speed: 2400,
  times: { idle, user, nice: 0, sys: 0, irq: 0 },
})
function fixture(platform = 'darwin') {
  let now = 1000
  let counters = [cpu(100, 100), cpu(100, 100)]
  const source: SystemSource = {
    platform: () => platform,
    release: () => '1.0',
    arch: () => 'arm64',
    uptime: () => 90000,
    cpus: () => counters,
    totalmem: () => 8192,
    freemem: () => 2048,
    now: () => now,
    runtimeVersion: () => '1.3.14',
    runtimeUptime: () => 90,
    residentMemory: () => 1024,
  }
  return {
    read: createSystemReader(source),
    advance: () => {
      now += 1000
      counters = [cpu(150, 150), cpu(175, 125)]
    },
  }
}
test('native platform mappings and validated snapshots', () => {
  for (const [platform, name] of [
    ['darwin', 'macOS'],
    ['win32', 'Windows'],
    ['linux', 'Linux'],
  ]) {
    const snapshot = fixture(platform).read()
    expect(systemSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.os.name).toBe(name)
    expect(snapshot.memory.usedBytes).toBe(6144)
    expect(snapshot.cpu.usagePercent).toBeNull()
    expect(JSON.stringify(snapshot)).not.toMatch(/hostname|username|network|homedir/)
  }
})
test('caches reads and computes portable CPU deltas', () => {
  const { read, advance } = fixture()
  expect(read()).toBe(read())
  advance()
  expect(read().cpu.cores).toEqual([50, 25])
  expect(read().cpu.usagePercent).toBe(37.5)
  expect(cpuPercent(cpu(100, 100), cpu(100, 100))).toBeNull()
  expect(cpuPercent(cpu(100, 100), cpu(0, 0))).toBeNull()
})
test('routes are read-only, uncached and sanitize failures', async () => {
  const processes = {
    read: async () => ({ capturedAt: '2026-09-22T08:00:00.000Z', processes: [] }),
  }
  const marks = {} as SystemMarksService
  const app = createTemplateRoutes({ read: fixture().read, processes, marks })
  const result = await app.request('/system')
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(systemSnapshotSchema.safeParse(await result.json()).success).toBe(true)
  expect((await app.request('/processes')).status).toBe(200)
  expect((await app.request('/system', { method: 'POST' })).status).toBe(404)
  const failing = createTemplateRoutes({
    read: () => {
      throw new Error('private path')
    },
    processes: {
      read: async () => {
        throw new Error('/usr/bin/secret --token')
      },
    },
    marks,
  })
  for (const path of ['/system', '/processes']) {
    const failed = await failing.request(path)
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toMatch(/private path|secret|token/)
  }
})
test('resource and binding share the visible timestamped sample', async () => {
  const { read } = fixture()
  const provider = createSystemResourceProvider(read)
  expect(await provider.expand('user', SYSTEM_URI)).toEqual({
    ok: true,
    content: formatSystemSnapshot(read()),
    language: 'text',
  })
  expect(await provider.expand('user', `${SYSTEM_URI}/unknown`)).toEqual({ ok: false })
  expect(await provider.listChildren('user', null)).toHaveLength(1)
  expect(await provider.listChildren('user', SYSTEM_URI)).toEqual([])
  const context = systemMessageContext(read())
  expect(context.strategy).toBe('replace')
  expect(JSON.stringify(context)).toContain(read().capturedAt)
  expect(JSON.stringify(context)).toContain('not the browser device')
  expect(JSON.stringify(systemMessageContext(read(), true))).toContain('STALE:')
})
test('a failed process read still expands the system snapshot', async () => {
  // One optional section that could not be collected used to fail the whole expansion.
  const { read } = fixture()
  const processes = {
    read: async () => {
      throw new Error('ps: not found')
    },
  }
  const provider = createSystemResourceProvider(read, processes)
  expect(await provider.expand('user', SYSTEM_URI)).toEqual({
    ok: true,
    content: formatSystemSnapshot(read()),
    language: 'text',
  })
})
