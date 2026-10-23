import { describe, expect, test } from 'bun:test'
import {
  parseCpuNanos,
  parseMemoryBytes,
  parseNodeMetricsList,
  parsePodMetricsList,
  parseQuantity,
} from './metrics'

/**
 * Quantities are the real `metrics.k8s.io` spellings, not invented ones: metrics-server
 * reports CPU in nanocores (`123456789n`) and memory in `Ki`, while `resources.limits`
 * written by a human uses `500m`, `2`, `512Mi` or `1G`. Both spellings reach the same
 * parser, so both are exercised here.
 */
describe('parseQuantity', () => {
  test('plain and exponent forms', () => {
    expect(parseQuantity('1000')).toBe(1000)
    expect(parseQuantity('1.5')).toBe(1.5)
    expect(parseQuantity('1e3')).toBe(1000)
    expect(parseQuantity('1.5e-3')).toBeCloseTo(0.0015, 9)
  })
  test('binary suffixes are 1024-based', () => {
    expect(parseQuantity('1Ki')).toBe(1024)
    expect(parseQuantity('512Mi')).toBe(512 * 1024 * 1024)
    expect(parseQuantity('2Gi')).toBe(2 * 1024 ** 3)
  })
  test('decimal suffixes are 1000-based, with kilo spelled lowercase', () => {
    expect(parseQuantity('1k')).toBe(1000)
    expect(parseQuantity('1M')).toBe(1_000_000)
    expect(parseQuantity('1G')).toBe(1_000_000_000)
  })
  test('sub-unit suffixes', () => {
    expect(parseQuantity('500m')).toBeCloseTo(0.5, 12)
    expect(parseQuantity('1000u')).toBeCloseTo(0.001, 12)
    expect(parseQuantity('123456789n')).toBeCloseTo(0.123456789, 12)
  })
  test('absent or unreadable input is zero, never NaN', () => {
    // A NaN here would render as "NaN" in a usage column, which is worse than "no data".
    for (const value of [undefined, null, '', 'lots', '12Zi', {}, Number.NaN]) {
      expect(parseQuantity(value)).toBe(0)
    }
  })
})

describe('CPU and memory helpers', () => {
  test('CPU normalizes to nanocores regardless of how it was written', () => {
    expect(parseCpuNanos('123456789n')).toBe(123456789)
    expect(parseCpuNanos('500m')).toBe(500_000_000)
    expect(parseCpuNanos('2')).toBe(2_000_000_000)
  })
  test('memory normalizes to bytes', () => {
    expect(parseMemoryBytes('131072Ki')).toBe(134_217_728)
    expect(parseMemoryBytes('1Gi')).toBe(1024 ** 3)
  })
})

const POD_METRICS = {
  kind: 'PodMetricsList',
  apiVersion: 'metrics.k8s.io/v1beta1',
  items: [
    {
      metadata: { name: 'api-7d9f', namespace: 'default' },
      containers: [
        { name: 'app', usage: { cpu: '12345678n', memory: '65536Ki' } },
        { name: 'sidecar', usage: { cpu: '1000000n', memory: '1024Ki' } },
      ],
    },
    {
      metadata: { name: 'worker-1', namespace: 'jobs' },
      containers: [{ name: 'worker', usage: { cpu: '0', memory: '0' } }],
    },
  ],
}

describe('parsePodMetricsList', () => {
  test('a pod row is the SUM of its containers, which the API never reports itself', () => {
    const [api, worker] = parsePodMetricsList(POD_METRICS)
    expect(api).toMatchObject({ namespace: 'default', name: 'api-7d9f' })
    expect(api!.cpuNanos).toBe(12345678 + 1000000)
    expect(api!.memoryBytes).toBe((65536 + 1024) * 1024)
    expect(api!.containers.map((c) => c.name)).toEqual(['app', 'sidecar'])
    expect(worker!.cpuNanos).toBe(0)
  })
  test('a pod with no containers yet is a zero row, not a dropped row', () => {
    const rows = parsePodMetricsList({ items: [{ metadata: { name: 'pending', namespace: 'x' } }] })
    expect(rows).toEqual([
      { namespace: 'x', name: 'pending', cpuNanos: 0, memoryBytes: 0, containers: [] },
    ])
  })
  test('unnamed rows are dropped — the caller keys usage by namespace/name', () => {
    expect(parsePodMetricsList({ items: [{ metadata: {} }, { containers: [] }] })).toEqual([])
  })
  test('a non-list body yields no rows instead of throwing', () => {
    for (const body of [null, undefined, {}, { items: 'nope' }, 'error']) {
      expect(parsePodMetricsList(body)).toEqual([])
    }
  })
})

describe('parseNodeMetricsList', () => {
  test('nodes report one usage block, so there is nothing to sum', () => {
    expect(
      parseNodeMetricsList({
        items: [{ metadata: { name: 'node-a' }, usage: { cpu: '250m', memory: '2Gi' } }],
      }),
    ).toEqual([{ name: 'node-a', cpuNanos: 250_000_000, memoryBytes: 2 * 1024 ** 3 }])
  })
  test('a node whose usage block is missing is a zero row', () => {
    expect(parseNodeMetricsList({ items: [{ metadata: { name: 'node-b' } }] })).toEqual([
      { name: 'node-b', cpuNanos: 0, memoryBytes: 0 },
    ])
  })
})
