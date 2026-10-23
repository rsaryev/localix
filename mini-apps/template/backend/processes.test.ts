import { expect, test } from 'bun:test'
import { createProcessService, runCollector, type ProcessSource } from './processes'

function source(platform: NodeJS.Platform, output: string) {
  let now = Date.parse('2026-09-22T08:00:00Z')
  const value: ProcessSource = {
    platform,
    now: () => now,
    totalMemory: () => 10_000_000,
    logicalCores: () => 2,
    run: async () => output,
  }
  return {
    value,
    advance: () => {
      now += 1000
    },
  }
}

test('collects Unix processes with identifiers and sorts by CPU', async () => {
  const fixture = source(
    'darwin',
    [
      '1 0 0.1 1.0 100 launchd',
      '10 1 1.0 2.0 200 supervisor',
      '20 10 2.0 3.0 300 bun',
      '30 20 42.5 4.0 400 worker',
    ].join('\n'),
  )
  const snapshot = await createProcessService(fixture.value).read()
  expect(snapshot.processes.map((row) => row.pid)).toEqual([30, 20, 10, 1])
  expect(snapshot.processes[0]).toMatchObject({
    pid: 30,
    parentPid: 20,
    name: 'worker',
    cpuPercent: 42.5,
    memoryBytes: 409_600,
    memoryPercent: 4,
  })
})

test('calculates Windows CPU from native counter deltas', async () => {
  let cpu = 10_000_000
  const fixture = source('win32', '')
  fixture.value.run = async () =>
    JSON.stringify([
      {
        ProcessId: 40,
        ParentProcessId: 20,
        Name: 'app.exe',
        WorkingSetSize: 2000,
        KernelModeTime: 0,
        UserModeTime: cpu,
      },
    ])
  const service = createProcessService(fixture.value)
  expect((await service.read()).processes[0]?.cpuPercent).toBeNull()
  fixture.advance()
  cpu += 10_000_000
  expect((await service.read()).processes[0]?.cpuPercent).toBe(50)
})

test('a collector that leaves a child holding stdout does not hold the read', async () => {
  // `Promise.all` over the pipes waited here for the grandchild's full 3s — or forever.
  const started = performance.now()
  expect(await runCollector(['bash', '-c', 'echo rows; sleep 3 &'])).toBe('rows\n')
  expect(performance.now() - started).toBeLessThan(1_500)
})

test('a collector runs in the C locale whatever the user’s locale is', async () => {
  // Under de_DE `ps` printed `0,5` for %cpu, and every such row failed the `[\d.]+` parse.
  const saved = { LC_ALL: process.env.LC_ALL, LANG: process.env.LANG }
  process.env.LC_ALL = 'de_DE.UTF-8'
  process.env.LANG = 'ru_RU.UTF-8'
  try {
    expect(await runCollector(['sh', '-c', 'echo "$LC_ALL $LANG"'])).toBe('C C\n')
    if (process.platform !== 'win32') {
      const row = await runCollector(['ps', '-o', 'pcpu=', '-p', String(process.pid)])
      expect(row.trim()).toMatch(/^\d+(?:\.\d+)?$/u)
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('a collector that never exits is killed and reported', async () => {
  const failure = await runCollector(['sleep', '30'], 40).catch((err: unknown) => err)
  expect((failure as Error).message).toBe('Process collector timed out after 40ms')
})
