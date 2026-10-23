import { describe, expect, test } from 'bun:test'
import type { NodeUsage, PodUsage } from '../../backend/contracts'
import {
  USAGE_ABSENT_RETRY_MS,
  USAGE_POLL_MS,
  containerUsageLines,
  formatCpu,
  formatMemory,
  formatUsagePair,
  formatUsageShare,
  indexNodeUsage,
  indexPodUsage,
  nodeReservation,
  nodeUsageDisplay,
  podUsageKey,
  usagePercent,
  usagePollDelay,
} from './usage'

const pod = (namespace: string, name: string, cpuNanos = 0, memoryBytes = 0): PodUsage => ({
  namespace,
  name,
  cpuNanos,
  memoryBytes,
  containers: [],
})

describe('formatCpu', () => {
  test('millicores are the working unit', () => {
    expect(formatCpu(12_000_000)).toBe('12m')
    expect(formatCpu(999_000_000)).toBe('999m')
  })
  test('sub-millicore usage keeps a decimal instead of collapsing to 0m', () => {
    // Truncating here would show idle sidecars as `0`, which reads as "not running"
    // for a container that is very much running.
    expect(formatCpu(200_000)).toBe('0.2m')
    expect(formatCpu(900_000)).toBe('0.9m')
    expect(formatCpu(0)).toBe('0m')
  })
  test('a core or more switches to cores', () => {
    expect(formatCpu(1_250_000_000)).toBe('1.25')
    expect(formatCpu(12_500_000_000)).toBe('12.5')
  })
  test('nonsense input is blank, never NaN', () => {
    expect(formatCpu(Number.NaN)).toBe('')
    expect(formatCpu(-1)).toBe('')
  })
})

describe('formatMemory', () => {
  test('binary units, matching what a manifest is written in', () => {
    expect(formatMemory(512)).toBe('512B')
    expect(formatMemory(64 * 1024)).toBe('64Ki')
    expect(formatMemory(1536)).toBe('1.5Ki')
    expect(formatMemory(64 * 1024 * 1024)).toBe('64Mi')
    expect(formatMemory(1.5 * 1024 ** 3)).toBe('1.5Gi')
    expect(formatMemory(16 * 1024 ** 3)).toBe('16Gi')
  })
  test('it stops at the largest unit it knows instead of overflowing', () => {
    expect(formatMemory(3 * 1024 ** 5)).toBe('3.0Pi')
  })
  test('nonsense input is blank', () => {
    expect(formatMemory(Number.NaN)).toBe('')
    expect(formatMemory(-5)).toBe('')
  })
})

describe('usagePercent', () => {
  test('a percentage of what is schedulable', () => {
    expect(usagePercent(500, 1000)).toBe(50)
    expect(usagePercent(0, 1000)).toBe(0)
  })
  test('no denominator is null, NOT zero', () => {
    // Zero would draw an empty gauge and claim the node is idle when it is unknown.
    expect(usagePercent(500, 0)).toBeNull()
    expect(usagePercent(500, Number.NaN)).toBeNull()
  })
  test('over-allocatable usage caps at 100 for display', () => {
    // Real (system reserve is soft), but a 104% bar reads as a rendering bug.
    expect(usagePercent(1040, 1000)).toBe(100)
  })
})

describe('joining usage to rows', () => {
  test('the key is namespace-qualified so all-namespaces lists cannot cross-match', () => {
    const index = indexPodUsage([pod('default', 'api', 5), pod('staging', 'api', 9)])
    expect(index.get(podUsageKey('default', 'api'))?.cpuNanos).toBe(5)
    expect(index.get(podUsageKey('staging', 'api'))?.cpuNanos).toBe(9)
  })
  test('absent metrics index to an empty map, so every lookup is a clean miss', () => {
    expect(indexPodUsage(null).size).toBe(0)
    expect(indexNodeUsage(null).size).toBe(0)
  })
  test('node usage indexes by name', () => {
    const rows: NodeUsage[] = [{ name: 'node-a', cpuNanos: 1, memoryBytes: 2 }]
    expect(indexNodeUsage(rows).get('node-a')?.memoryBytes).toBe(2)
  })
})

describe('nodeUsageDisplay', () => {
  const node = { allocatableCpuNanos: 7_910_000_000, allocatableMemoryBytes: 16 * 1024 ** 3 }

  test('formats usage and its share of allocatable', () => {
    const display = nodeUsageDisplay(node, {
      name: 'node-a',
      cpuNanos: 791_000_000,
      memoryBytes: 4 * 1024 ** 3,
    })
    expect(display).toMatchObject({ cpu: '791m', memory: '4.0Gi' })
    expect(display!.cpuPercent).toBeCloseTo(10, 6)
    expect(display!.memoryPercent).toBeCloseTo(25, 6)
  })

  test('a node with no allocatable block still shows usage, just no percentage', () => {
    const display = nodeUsageDisplay(
      { allocatableCpuNanos: 0, allocatableMemoryBytes: 0 },
      { name: 'edge-1', cpuNanos: 500_000_000, memoryBytes: 1024 },
    )
    expect(display).toEqual({
      cpu: '500m',
      memory: '1.0Ki',
      cpuPercent: null,
      memoryPercent: null,
    })
  })

  test('a node absent from the metrics answer has no usage cell at all', () => {
    expect(nodeUsageDisplay(node, undefined)).toBeNull()
  })
})

describe('display helpers', () => {
  test('a share reads as amount + percentage, and drops the percentage without one', () => {
    expect(formatUsageShare('23m', 12.4)).toBe('23m (12%)')
    expect(formatUsageShare('23m', null)).toBe('23m')
  })

  test('the compact pair is what a row cell shows', () => {
    expect(formatUsagePair(12_000_000, 64 * 1024 * 1024)).toBe('12m · 64Mi')
  })

  test('container lines are sorted by CPU so the expensive container is the first line', () => {
    // The point of the breakdown: a summed pod row cannot say WHICH container is the cost.
    const usage: PodUsage = {
      namespace: 'default',
      name: 'api',
      cpuNanos: 0,
      memoryBytes: 0,
      containers: [
        { name: 'sidecar', cpuNanos: 1_000_000, memoryBytes: 1024 },
        { name: 'app', cpuNanos: 40_000_000, memoryBytes: 2048 },
      ],
    }
    expect(containerUsageLines(usage)).toEqual(['app 40m · 2.0Ki', 'sidecar 1m · 1.0Ki'])
  })

  test('a pod with no usage has no container lines rather than a bogus one', () => {
    expect(containerUsageLines(undefined)).toEqual([])
    expect(containerUsageLines(pod('a', 'b'))).toEqual([])
  })
})

describe('nodeReservation', () => {
  const node = { allocatableCpuNanos: 4_000_000_000, allocatableMemoryBytes: 8 * 1024 ** 3 }
  const scheduled = (cpu: number, memory: number) => ({
    requestedCpuNanos: cpu,
    requestedMemoryBytes: memory,
  })

  test('sums the requests of the pods placed on the node, against allocatable', () => {
    const reservation = nodeReservation(
      [scheduled(1_000_000_000, 2 * 1024 ** 3), scheduled(3_000_000_000, 2 * 1024 ** 3)],
      node,
    )
    expect(reservation.cpu).toBe('4.00')
    expect(reservation.cpuPercent).toBeCloseTo(100, 6)
    expect(reservation.memory).toBe('4.0Gi')
    expect(reservation.memoryPercent).toBeCloseTo(50, 6)
  })

  test('a fully reserved node reads 100% even while measured usage is near idle', () => {
    // The whole reason reservation is shown next to usage: this node schedules nothing
    // more, and live usage cannot say so.
    expect(nodeReservation([scheduled(4_000_000_000, 0)], node).cpuPercent).toBe(100)
  })

  test('an empty node reserves nothing', () => {
    expect(nodeReservation([], node)).toMatchObject({ cpu: '0m', memory: '0B' })
  })

  test('without allocatable there is no percentage, only the amount', () => {
    const reservation = nodeReservation([scheduled(1_000_000_000, 1024)], {
      allocatableCpuNanos: 0,
      allocatableMemoryBytes: 0,
    })
    expect(reservation).toMatchObject({ cpuPercent: null, memoryPercent: null, cpu: '1.00' })
  })
})

describe('pacing', () => {
  test('an available metrics API polls at the scrape cadence', () => {
    expect(usagePollDelay(true)).toBe(USAGE_POLL_MS)
  })
  test('a cluster without metrics-server backs off instead of asking every 10s', () => {
    // A fixed 10s interval firing at a 404 forever is ~8,600 wasted requests a day per
    // open view. It still retries, because the add-on can be installed.
    expect(usagePollDelay(false)).toBe(USAGE_ABSENT_RETRY_MS)
    expect(USAGE_ABSENT_RETRY_MS).toBeGreaterThan(USAGE_POLL_MS)
  })
})
