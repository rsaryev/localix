import { describe, expect, test } from 'bun:test'
import { createStatsReader } from './api-stats'
import type { RawStatsSample } from './stats-calc'

const sample = (over: Partial<RawStatsSample> = {}): RawStatsSample => ({
  cpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000, online_cpus: 4 },
  precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  memory_stats: { usage: 1_000_000, limit: 8_000_000, stats: { inactive_file: 0 } },
  networks: { eth0: { rx_bytes: 2_050, tx_bytes: 126 } },
  blkio_stats: {
    io_service_bytes_recursive: [
      { op: 'Read', value: 208_000_000 },
      { op: 'Write', value: 35_700_000 },
    ],
  },
  pids_stats: { current: 46 },
  ...over,
})

describe('createStatsReader', () => {
  test('display strings match docker stats exactly — binary memory, decimal I/O', () => {
    // Verified live: `316.8MiB / 17.54GiB`, `2.05kB / 126B`, `208MB / 35.7MB`. The precisions
    // differ between memory (4 significant digits) and I/O (3), which is why one shared
    // formatter would be wrong for one of them.
    const reader = createStatsReader()
    const stats = reader.read(
      'abc',
      sample({ memory_stats: { usage: 332_149_555, limit: 18_832_113_664, stats: {} } }),
    )
    expect(stats.memUsage).toBe('316.8MiB / 17.54GiB')
    expect(stats.netIO).toBe('2.05kB / 126B')
    expect(stats.blockIO).toBe('208MB / 35.7MB')
    expect(stats.pids).toBe(46)
  })

  test('the FIRST read has nothing to diff against, so CPU warms up on the next poll', () => {
    // `one-shot` returns a zeroed `precpu_stats`; diffing against it would report the
    // container's whole lifetime as one interval. Reporting 0 for one tick beats blocking the
    // panel for the two seconds `docker stats` spends hiding this.
    const reader = createStatsReader({ now: () => 1_000 })
    const first = reader.read('abc', sample({ precpu_stats: {} }))
    expect(first.cpuPct).toBe(0)

    const second = reader.read(
      'abc',
      sample({
        cpu_stats: { cpu_usage: { total_usage: 1_200 }, system_cpu_usage: 110_000, online_cpus: 4 },
        precpu_stats: {},
      }),
    )
    // 200/10000 * 4 * 100
    expect(second.cpuPct).toBeCloseTo(8, 6)
  })

  test("a pre-1.41 daemon's own precpu_stats is used when we have no sample yet", () => {
    // There one-shot is ignored and the daemon DOES populate precpu, so the first read is
    // already correct rather than zero.
    const reader = createStatsReader()
    const stats = reader.read(
      'abc',
      sample({
        cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 200_000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 1_800 }, system_cpu_usage: 190_000 },
      }),
    )
    expect(stats.cpuPct).toBeCloseTo(8, 6)
  })

  test('a sample older than the TTL is not used for a delta', () => {
    // Averaging across minutes reads as a flat line straight through a spike.
    let clock = 1_000
    const reader = createStatsReader({ now: () => clock })
    reader.read('abc', sample({ precpu_stats: {} }))
    clock += 120_000
    const stale = reader.read(
      'abc',
      sample({
        cpu_stats: { cpu_usage: { total_usage: 9_000 }, system_cpu_usage: 900_000, online_cpus: 4 },
        precpu_stats: {},
      }),
    )
    expect(stale.cpuPct).toBe(0)
  })

  test('samples are remembered per container, never shared', () => {
    const reader = createStatsReader()
    reader.read('a', sample({ precpu_stats: {} }))
    // `b` is a first read of its own, regardless of what `a` did.
    expect(reader.read('b', sample({ precpu_stats: {} })).cpuPct).toBe(0)
  })

  test('forget() drops a container so a recreated id starts clean', () => {
    const reader = createStatsReader()
    reader.read('abc', sample({ precpu_stats: {} }))
    reader.forget('abc')
    expect(
      reader.read(
        'abc',
        sample({
          cpu_stats: {
            cpu_usage: { total_usage: 1_200 },
            system_cpu_usage: 110_000,
            online_cpus: 4,
          },
          precpu_stats: {},
        }),
      ).cpuPct,
    ).toBe(0)
  })

  test('an unreported counter stays null, so the UI can say "not reported"', () => {
    const reader = createStatsReader()
    const stats = reader.read('abc', sample({ networks: undefined, blkio_stats: {} }))
    expect(stats.netRxBytes).toBeNull()
    expect(stats.netTxBytes).toBeNull()
    expect(stats.blockReadBytes).toBeNull()
    expect(stats.netIO).toBe('')
  })

  test('a Windows container uses its own CPU formula and reports no memory percentage', () => {
    // `docker stats` prints `--` for MemPerc and PIDs on Windows, and MemUsage without a limit.
    const reader = createStatsReader({ windows: true })
    const stats = reader.read(
      'abc',
      sample({
        read: '2026-07-28T10:00:00.100Z',
        preread: '2026-07-28T10:00:00.000Z',
        num_procs: 2,
        cpu_stats: { cpu_usage: { total_usage: 200_000 } },
        precpu_stats: { cpu_usage: { total_usage: 0 } },
        memory_stats: { usage: 0, privateworkingset: 44_040_192 },
      }),
    )
    expect(stats.cpuPct).toBeCloseTo(10, 6)
    expect(stats.memPct).toBe(0)
    // No ` / limit` suffix: Windows has no limit to divide by.
    expect(stats.memUsage).toBe('42MiB')
  })
})
