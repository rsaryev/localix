/**
 * Derive the displayed stats from a raw Docker API `/containers/{id}/stats` sample.
 *
 * The formulas preserve Docker CLI semantics across both transports. CPU percentage must include
 * the online-CPU factor or it is under-reported by the core count, and network totals must include
 * every interface so multi-network containers do not lose traffic from later entries.
 *
 * Why compute at all instead of reading Docker's pre-formatted `docker stats` output: the CLI
 * (and `stats?stream=false`) makes the DAEMON wait two full sample cycles, ~2s per read.
 * `stats?stream=false&one-shot=true` answers in ~2ms but returns no `precpu_stats`, so the
 * deltas must come from the caller's own previous sample. That turns a ~2 s read into ~2 ms.
 */

/** The subset of the API's stats body these formulas need. Everything is optional: the
 *  daemon omits whole blocks depending on platform, cgroup version and driver. */
export interface RawStatsSample {
  read?: string
  preread?: string
  num_procs?: number
  cpu_stats?: RawCpuStats
  precpu_stats?: RawCpuStats
  memory_stats?: {
    usage?: number
    limit?: number
    /** cgroup counters; the keys differ between v1 and v2. */
    stats?: Record<string, number>
    /** Windows only. */
    privateworkingset?: number
  }
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>
  blkio_stats?: { io_service_bytes_recursive?: { op?: string; value?: number }[] | null }
  pids_stats?: { current?: number }
}

interface RawCpuStats {
  cpu_usage?: { total_usage?: number; percpu_usage?: number[] }
  system_cpu_usage?: number
  online_cpus?: number
}

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * CPU percent for a Linux container.
 *
 * `previous` is either the sample's own `precpu_stats` (a two-cycle read) or the caller's
 * last sample (a one-shot read). A non-positive delta means the counters did not advance
 * or were reset, so there is no positive interval rate to report.
 */
export function cpuPercentUnix(
  current: RawCpuStats | undefined,
  previous: RawCpuStats | undefined,
): number {
  const cpuDelta =
    number(current?.cpu_usage?.total_usage) - number(previous?.cpu_usage?.total_usage)
  const systemDelta = number(current?.system_cpu_usage) - number(previous?.system_cpu_usage)
  // `online_cpus` is absent on older daemons; the per-CPU array length expresses the same count.
  const onlineCpus = number(current?.online_cpus) || (current?.cpu_usage?.percpu_usage?.length ?? 0)
  if (systemDelta <= 0 || cpuDelta <= 0 || onlineCpus <= 0) return 0
  return (cpuDelta / systemDelta) * onlineCpus * 100
}

/**
 * CPU percent for a WINDOWS container — a different formula, not a variant of the Unix one.
 *
 * Windows reports no `system_cpu_usage`; the denominator is wall-clock instead: the number of
 * 100ns intervals between the two reads, times the process count. Using the Unix formula on
 * Windows divides by zero and silently yields 0% forever, which is the shape of "idle".
 */
export function cpuPercentWindows(sample: RawStatsSample): number {
  const read = Date.parse(sample.read ?? '')
  const preread = Date.parse(sample.preread ?? '')
  if (!Number.isFinite(read) || !Number.isFinite(preread)) return 0
  // ms → 100ns intervals, then one denominator per processor.
  const possibleIntervals = (((read - preread) * 1e6) / 100) * number(sample.num_procs)
  if (possibleIntervals <= 0) return 0
  const used =
    number(sample.cpu_stats?.cpu_usage?.total_usage) -
    number(sample.precpu_stats?.cpu_usage?.total_usage)
  if (used <= 0) return 0
  return (used / possibleIntervals) * 100
}

/**
 * Memory in use, with the page cache excluded.
 *
 * Raw `memory_stats.usage` counts the page cache, so a container that merely READ a large
 * file appears to be holding it. Subtracting the inactive file cache reports active usage;
 * the key is `total_inactive_file` on cgroup v1 and `inactive_file` on cgroup v2.
 */
export function memoryUsageBytes(memory: RawStatsSample['memory_stats']): number {
  const usage = number(memory?.usage)
  // Windows reports no cgroup stats block; its working set IS the answer.
  if (!memory?.stats) return number(memory?.privateworkingset) || usage
  const cache =
    'total_inactive_file' in memory.stats
      ? number(memory.stats.total_inactive_file)
      : number(memory.stats.inactive_file)
  return cache < usage ? usage - cache : usage
}

/** Memory as a percentage of the container's limit, or 0 when it has none. */
export function memoryPercent(memory: RawStatsSample['memory_stats']): number {
  const limit = number(memory?.limit)
  if (limit <= 0) return 0
  return (memoryUsageBytes(memory) / limit) * 100
}

/**
 * Block I/O, summed over EVERY device.
 *
 * The entries are per-device and per-operation, and `op` varies in casing and length
 * (`Read`/`read`/`r` have all appeared). Matching its first letter case-insensitively avoids
 * relying on array positions, which differ with multiple devices and under cgroup v2.
 */
export function blockIoBytes(blkio: RawStatsSample['blkio_stats']): {
  read: number
  write: number
} {
  let read = 0
  let write = 0
  for (const entry of blkio?.io_service_bytes_recursive ?? []) {
    const op = (entry?.op ?? '')[0]?.toLowerCase()
    if (op === 'r') read += number(entry?.value)
    else if (op === 'w') write += number(entry?.value)
  }
  return { read, write }
}

/**
 * Network I/O, summed over EVERY interface.
 *
 * A container attached to two networks has two entries, so reading only the first loses traffic
 * from every other interface. An absent `networks` block means the daemon reported none at all —
 * for example, with `--network host` or a Windows container — which the caller must render as
 * "not reported" rather than as zero traffic.
 */
export function networkIoBytes(
  networks: RawStatsSample['networks'],
): { rx: number; tx: number } | null {
  if (!networks || Object.keys(networks).length === 0) return null
  let rx = 0
  let tx = 0
  for (const entry of Object.values(networks)) {
    rx += number(entry?.rx_bytes)
    tx += number(entry?.tx_bytes)
  }
  return { rx, tx }
}
