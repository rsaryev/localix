/**
 * The PURE half of pod/node usage: Kubernetes quantity parsing and
 * `metrics.k8s.io` list shaping. No fetch, no cache, no kubeconfig — see
 * `api-metrics.ts` for those, mirroring the `discovery.ts` / `api-discovery.ts` split.
 *
 * The metrics API reports `PodMetrics` usage per container rather than as a pod-level total, so
 * pod rows sum their container values. Quantity parsing follows the Kubernetes grammar locally,
 * including lowercase `k` for decimal kilo and exponent forms such as `1e3`; both can occur in
 * values from `metrics-server` or a `resources.limits` field.
 */

import type { ContainerUsage, NodeUsage, PodUsage } from './contracts'

const QUANTITY = /^\s*([+-]?\d+(?:\.\d+)?)(?:e([+-]?\d+))?\s*([a-zA-Z]*)\s*$/

/** Binary suffixes (1024-based). Kubernetes writes these with the trailing `i`. */
const BINARY: Record<string, number> = { Ki: 1, Mi: 2, Gi: 3, Ti: 4, Pi: 5, Ei: 6 }
/** Decimal suffixes (1000-based). Kilo is lowercase `k` in the quantity grammar. */
const DECIMAL: Record<string, number> = { k: 1, M: 2, G: 3, T: 4, P: 5, E: 6 }
/** Sub-unit suffixes, expressed as a multiplier against the base unit. */
const FRACTIONAL: Record<string, number> = { n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3 }

/**
 * Parse a Kubernetes resource quantity into a plain number of BASE units
 * (cores for CPU, bytes for memory). Returns 0 for absent or unparseable input:
 * a metrics row we cannot read must render as "no data", never as `NaN` in a table.
 */
export function parseQuantity(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const match = QUANTITY.exec(value)
  if (!match) return 0
  const mantissa = Number(match[1])
  if (!Number.isFinite(mantissa)) return 0
  // `1e3` and the explicit `1E3`-style suffix are the same thing in the grammar.
  const exponent = match[2] ? Number(match[2]) : 0
  const suffix = match[3] ?? ''
  const scaled = mantissa * 10 ** exponent
  if (!suffix) return scaled
  if (suffix in BINARY) return scaled * 1024 ** BINARY[suffix]!
  if (suffix in DECIMAL) return scaled * 1000 ** DECIMAL[suffix]!
  if (suffix in FRACTIONAL) return scaled * FRACTIONAL[suffix]!
  return 0
}

/** CPU quantity → nanocores, the unit `metrics.k8s.io` itself reports in. */
export function parseCpuNanos(value: unknown): number {
  return Math.round(parseQuantity(value) * 1e9)
}

/** Memory quantity → bytes. */
export function parseMemoryBytes(value: unknown): number {
  return Math.round(parseQuantity(value))
}

interface UsageBlock {
  cpu?: unknown
  memory?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function items(body: unknown): Record<string, unknown>[] {
  const list = record(body)?.items
  if (!Array.isArray(list)) return []
  return (list as unknown[]).flatMap((item): Record<string, unknown>[] => {
    const entry = record(item)
    return entry ? [entry] : []
  })
}

function usage(value: unknown): { cpuNanos: number; memoryBytes: number } {
  const block = (record(value) ?? {}) as UsageBlock
  return { cpuNanos: parseCpuNanos(block.cpu), memoryBytes: parseMemoryBytes(block.memory) }
}

/**
 * Shape a `PodMetricsList` body into pod rows.
 *
 * A pod's usage is the SUM of its containers because the API reports no pod-level total. Rows
 * without a name are dropped rather than keyed as empty strings, since the caller joins them to
 * pods by `namespace/name`.
 */
export function parsePodMetricsList(body: unknown): PodUsage[] {
  return items(body).flatMap((item) => {
    const metadata = record(item.metadata) ?? {}
    const name = typeof metadata.name === 'string' ? metadata.name : ''
    if (!name) return []
    const containers = (Array.isArray(item.containers) ? item.containers : []).flatMap(
      (entry): ContainerUsage[] => {
        const container = record(entry)
        if (!container) return []
        const { cpuNanos, memoryBytes } = usage(container.usage)
        return [
          {
            name: typeof container.name === 'string' ? container.name : '',
            cpuNanos,
            memoryBytes,
          },
        ]
      },
    )
    return [
      {
        namespace: typeof metadata.namespace === 'string' ? metadata.namespace : '',
        name,
        cpuNanos: containers.reduce((total, container) => total + container.cpuNanos, 0),
        memoryBytes: containers.reduce((total, container) => total + container.memoryBytes, 0),
        containers,
      },
    ]
  })
}

/** Shape a `NodeMetricsList` body into node rows. */
export function parseNodeMetricsList(body: unknown): NodeUsage[] {
  return items(body).flatMap((item) => {
    const metadata = record(item.metadata) ?? {}
    const name = typeof metadata.name === 'string' ? metadata.name : ''
    if (!name) return []
    return [{ name, ...usage(item.usage) }]
  })
}
