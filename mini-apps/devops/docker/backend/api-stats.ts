import type { ContainerStats } from './contracts'
import { formatBinarySize, formatDecimalSize } from './bytes'
import {
  type RawStatsSample,
  blockIoBytes,
  cpuPercentUnix,
  cpuPercentWindows,
  memoryPercent,
  memoryUsageBytes,
  networkIoBytes,
} from './stats-calc'

/**
 * Turn raw API stats samples into the workbench's `ContainerStats`.
 *
 * Holds the one piece of state the fast path needs: the PREVIOUS sample per container.
 * `one-shot=true` answers in ~2ms instead of ~2s precisely because the daemon does not wait for
 * a second cycle — which means it returns no `precpu_stats`, and the CPU delta has to come from
 * a sample we kept ourselves.
 *
 * Display strings are reproduced exactly as `docker stats` prints them, because they are what a
 * user recognises: memory in BINARY units at 4 significant digits, network and block I/O in
 * DECIMAL units at 3 (docker/cli `formatter_stats.go`). The precisions genuinely differ.
 */

/** How long a remembered sample stays useful for a delta. */
const SAMPLE_TTL_MS = 60_000

interface RememberedSample {
  at: number
  sample: RawStatsSample
}

export interface StatsReaderOptions {
  /** Windows containers need a different CPU formula and report no memory percentage. */
  windows?: boolean
  now?: () => number
}

export interface StatsReader {
  /**
   * Shape one sample into the contract.
   *
   * The first call for a container has nothing to diff against, so CPU comes back as 0 and the
   * NEXT poll carries a real figure — the same warm-up `docker stats` hides by blocking for two
   * cycles. Reporting 0 for one tick is better than blocking the panel for two seconds.
   */
  read(id: string, sample: RawStatsSample): ContainerStats
  /** Forget a container (it was removed, or its tab closed). */
  forget(id: string): void
}

export function createStatsReader(options: StatsReaderOptions = {}): StatsReader {
  const now = options.now ?? Date.now
  const previous = new Map<string, RememberedSample>()

  return {
    read(id, sample) {
      const remembered = previous.get(id)
      const at = now()
      // A stale sample would produce a delta averaged over minutes, which reads as a flat line
      // through a spike. Older than the TTL is treated as no sample at all.
      const usable = remembered && at - remembered.at <= SAMPLE_TTL_MS ? remembered.sample : null
      previous.set(id, { at, sample })

      // A one-shot read returns `precpu_stats` ZEROED, which is structurally indistinguishable
      // from a real sample unless you check it: diffing against zeros reports the container's
      // whole lifetime as one interval — a busy container that has been up for a week shows a
      // plausible-looking few percent that never changes. A populated `system_cpu_usage` is the
      // tell that the daemon actually did a two-cycle read (a pre-1.41 daemon).
      const daemonPrevious =
        (sample.precpu_stats?.system_cpu_usage ?? 0) > 0 ? sample.precpu_stats : undefined
      const previousCpu = usable?.cpu_stats ?? daemonPrevious
      const cpuPct = options.windows
        ? cpuPercentWindows(sample)
        : // No previous sample means no interval, so there is no rate to report — the same rule
          // `counterRate` follows for I/O.
          previousCpu
          ? cpuPercentUnix(sample.cpu_stats, previousCpu)
          : 0

      const memory = memoryUsageBytes(sample.memory_stats)
      const limit = sample.memory_stats?.limit ?? 0
      const network = networkIoBytes(sample.networks)
      const block = blockIoBytes(sample.blkio_stats)

      return {
        id,
        cpuPct,
        // Windows reports no memory percentage at all; `docker stats` prints `--` there.
        memPct: options.windows ? 0 : memoryPercent(sample.memory_stats),
        memUsage: options.windows
          ? formatBinarySize(memory)
          : `${formatBinarySize(memory)} / ${formatBinarySize(limit)}`,
        netIO: network ? `${formatDecimalSize(network.rx)} / ${formatDecimalSize(network.tx)}` : '',
        blockIO: `${formatDecimalSize(block.read)} / ${formatDecimalSize(block.write)}`,
        // `null` where the daemon reported nothing, so the UI says "not reported" instead of 0B.
        netRxBytes: network?.rx ?? null,
        netTxBytes: network?.tx ?? null,
        blockReadBytes: sample.blkio_stats?.io_service_bytes_recursive ? block.read : null,
        blockWriteBytes: sample.blkio_stats?.io_service_bytes_recursive ? block.write : null,
        pids: sample.pids_stats?.current ?? 0,
      }
    },
    forget(id) {
      previous.delete(id)
    },
  }
}
