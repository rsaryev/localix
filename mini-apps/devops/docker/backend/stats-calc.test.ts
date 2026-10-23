import { describe, expect, test } from 'bun:test'
import {
  blockIoBytes,
  cpuPercentUnix,
  cpuPercentWindows,
  memoryPercent,
  memoryUsageBytes,
  networkIoBytes,
  type RawStatsSample,
} from './stats-calc'

describe('cpuPercentUnix', () => {
  test("docker/cli's formula: (cpuDelta / systemDelta) * onlineCPUs * 100", () => {
    // 1% of total system time across 12 cores is 12% of one core's worth.
    const percent = cpuPercentUnix(
      { cpu_usage: { total_usage: 1_100 }, system_cpu_usage: 110_000, online_cpus: 12 },
      { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000 },
    )
    expect(percent).toBeCloseTo(12, 6)
  })

  test('the onlineCPUs factor is NOT optional', () => {
    // Omitting it under-reports by exactly the core count — 1.2% instead of 12% here.
    const withCores = cpuPercentUnix(
      { cpu_usage: { total_usage: 1_100 }, system_cpu_usage: 110_000, online_cpus: 12 },
      { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000 },
    )
    const withoutCores = (100 / 10_000) * 100
    expect(withCores / withoutCores).toBeCloseTo(12, 6)
  })

  test('an older daemon without online_cpus falls back to the per-CPU array length', () => {
    expect(
      cpuPercentUnix(
        {
          cpu_usage: { total_usage: 1_100, percpu_usage: [1, 2, 3, 4] },
          system_cpu_usage: 110_000,
        },
        { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000 },
      ),
    ).toBeCloseTo(4, 6)
  })

  test('non-advancing or reset counters report 0, never a negative or NaN', () => {
    const current = { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000, online_cpus: 4 }
    // Identical samples: no time passed.
    expect(cpuPercentUnix(current, current)).toBe(0)
    // Counters went backwards (container restarted).
    expect(
      cpuPercentUnix(current, {
        cpu_usage: { total_usage: 9_000 },
        system_cpu_usage: 900_000,
      }),
    ).toBe(0)
    // Nothing at all.
    expect(cpuPercentUnix(undefined, undefined)).toBe(0)
  })

  test('a one-shot sample has no precpu, so the previous sample is the denominator source', () => {
    // This is why one-shot works at all: precpu_stats comes back zeroed, and diffing against
    // it would report the container's whole lifetime as one interval.
    const oneShot: RawStatsSample = {
      cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 200_000, online_cpus: 8 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
    }
    const againstZeroed = cpuPercentUnix(oneShot.cpu_stats, oneShot.precpu_stats)
    const againstOurPrevious = cpuPercentUnix(oneShot.cpu_stats, {
      cpu_usage: { total_usage: 1_800 },
      system_cpu_usage: 190_000,
    })
    // Against the zeroed precpu the whole lifetime is one interval: 2000/200000 * 8 * 100.
    expect(againstZeroed).toBeCloseTo(8, 6)
    // Against our own previous sample only the last interval counts: 200/10000 * 8 * 100.
    expect(againstOurPrevious).toBeCloseTo(16, 6)
  })
})

describe('cpuPercentWindows', () => {
  test('wall-clock intervals times processors, not system_cpu_usage', () => {
    // 100ms between reads on 2 procs = 2,000,000 possible 100ns intervals; 200,000 used = 10%.
    expect(
      cpuPercentWindows({
        read: '2026-07-28T10:00:00.100Z',
        preread: '2026-07-28T10:00:00.000Z',
        num_procs: 2,
        cpu_stats: { cpu_usage: { total_usage: 200_000 } },
        precpu_stats: { cpu_usage: { total_usage: 0 } },
      }),
    ).toBeCloseTo(10, 6)
  })

  test('a Windows sample through the UNIX formula reads as permanently idle', () => {
    // The bug this separate function prevents: Windows reports no system_cpu_usage, so the
    // Unix denominator is 0 and every container looks like 0% forever.
    const sample: RawStatsSample = {
      read: '2026-07-28T10:00:00.100Z',
      preread: '2026-07-28T10:00:00.000Z',
      num_procs: 2,
      cpu_stats: { cpu_usage: { total_usage: 200_000 } },
      precpu_stats: { cpu_usage: { total_usage: 0 } },
    }
    expect(cpuPercentUnix(sample.cpu_stats, sample.precpu_stats)).toBe(0)
    expect(cpuPercentWindows(sample)).toBeGreaterThan(0)
  })

  test('missing or unparseable timestamps report 0 rather than dividing by zero', () => {
    expect(cpuPercentWindows({ num_procs: 2 })).toBe(0)
    expect(cpuPercentWindows({ read: 'nonsense', preread: 'nonsense', num_procs: 2 })).toBe(0)
    // Same instant, or no processors reported.
    expect(
      cpuPercentWindows({
        read: '2026-07-28T10:00:00.000Z',
        preread: '2026-07-28T10:00:00.000Z',
        num_procs: 2,
      }),
    ).toBe(0)
  })
})

describe('memoryUsageBytes', () => {
  test('cgroup v2 subtracts inactive_file', () => {
    expect(memoryUsageBytes({ usage: 1_000, stats: { inactive_file: 400 } })).toBe(600)
  })

  test('cgroup v1 subtracts total_inactive_file, which takes precedence', () => {
    expect(
      memoryUsageBytes({ usage: 1_000, stats: { total_inactive_file: 300, inactive_file: 900 } }),
    ).toBe(700)
  })

  test('excluding the cache is what makes the number comparable', () => {
    // A container that merely READ a big file shows the cache in `usage`; reporting that as
    // memory in use is how a 90%-memory panic gets manufactured out of nothing.
    const withCache = { usage: 1_000_000_000, stats: { inactive_file: 900_000_000 } }
    expect(memoryUsageBytes(withCache)).toBe(100_000_000)
  })

  test('a cache larger than usage is not trusted into a negative', () => {
    expect(memoryUsageBytes({ usage: 100, stats: { inactive_file: 500 } })).toBe(100)
  })

  test('Windows has no cgroup stats block; its working set is the answer', () => {
    expect(memoryUsageBytes({ usage: 0, privateworkingset: 42_000 })).toBe(42_000)
  })

  test('nothing reported is zero, not NaN', () => {
    expect(memoryUsageBytes(undefined)).toBe(0)
    expect(memoryUsageBytes({})).toBe(0)
  })
})

describe('memoryPercent', () => {
  test('cache-excluded usage over the limit', () => {
    expect(memoryPercent({ usage: 600, limit: 1_000, stats: { inactive_file: 100 } })).toBeCloseTo(
      50,
      6,
    )
  })
  test('no limit means no percentage to report', () => {
    expect(memoryPercent({ usage: 600, limit: 0 })).toBe(0)
    expect(memoryPercent(undefined)).toBe(0)
  })
})

describe('blockIoBytes', () => {
  test('summed over every device, keyed on the first letter of op', () => {
    // Two devices, mixed casing — all four spellings appear across daemon versions.
    expect(
      blockIoBytes({
        io_service_bytes_recursive: [
          { op: 'Read', value: 100 },
          { op: 'write', value: 200 },
          { op: 'r', value: 50 },
          { op: 'W', value: 25 },
        ],
      }),
    ).toEqual({ read: 150, write: 225 })
  })

  test('indexing [0] and [1] would have been wrong', () => {
    // On a multi-device host the array is not [read, write]; it is per-device pairs.
    const stats = {
      io_service_bytes_recursive: [
        { op: 'Read', value: 1 },
        { op: 'Read', value: 2 },
        { op: 'Write', value: 4 },
      ],
    }
    expect(blockIoBytes(stats)).toEqual({ read: 3, write: 4 })
  })

  test('an absent or null block yields zeros rather than throwing', () => {
    // Docker sends `io_service_bytes_recursive: null` on hosts without blkio accounting.
    expect(blockIoBytes({ io_service_bytes_recursive: null })).toEqual({ read: 0, write: 0 })
    expect(blockIoBytes(undefined)).toEqual({ read: 0, write: 0 })
    expect(blockIoBytes({ io_service_bytes_recursive: [{ value: 5 }] })).toEqual({
      read: 0,
      write: 0,
    })
  })
})

describe('networkIoBytes', () => {
  test('summed over EVERY interface', () => {
    // portainer's chart reads Networks[0] only and loses the second network's traffic.
    expect(
      networkIoBytes({
        eth0: { rx_bytes: 100, tx_bytes: 10 },
        eth1: { rx_bytes: 200, tx_bytes: 20 },
      }),
    ).toEqual({ rx: 300, tx: 30 })
  })

  test('no networks block is null — "not reported", not "no traffic"', () => {
    // `--network host` and Windows containers report nothing; zero would be a lie.
    expect(networkIoBytes(undefined)).toBeNull()
    expect(networkIoBytes({})).toBeNull()
  })

  test('a partially reported interface counts what it has', () => {
    expect(networkIoBytes({ eth0: { rx_bytes: 100 } })).toEqual({ rx: 100, tx: 0 })
  })
})
