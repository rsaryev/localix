/**
 * Parse the human-readable byte sizes the `docker` CLI prints.
 *
 * `docker stats` hands back display strings, not numbers, and it uses TWO unit systems in
 * the same row: `MemUsage` goes through Docker's `units.BytesSize` (binary — `MiB`, `GiB`)
 * while `NetIO` and `BlockIO` go through `units.HumanSize` (decimal — `kB`, `MB`, `GB`).
 * Reading `1.2MB` as 1.2 MiB is a 5% error that compounds into a visibly wrong rate, so
 * both spellings are honoured exactly as Docker wrote them.
 *
 * `null` is reserved for "Docker did not report this", which is NOT zero: a container on
 * `--network host`, a Windows container, or a rootless/cgroup-v2 host with no blkio
 * accounting prints `--`. Rendering that as `0B` claims there was no traffic.
 */

const DECIMAL: Record<string, number> = { b: 0, kb: 1, mb: 2, gb: 3, tb: 4, pb: 5 }
const BINARY: Record<string, number> = { kib: 1, mib: 2, gib: 3, tib: 4, pib: 5 }

const SIZE = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/

/** One human size → bytes, or `null` when Docker reported nothing usable. */
export function parseDockerBytes(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  // Docker's own placeholder for an unavailable counter.
  if (!text || text === '--' || text === '-') return null
  const match = SIZE.exec(text)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const unit = (match[2] ?? '').toLowerCase()
  if (!unit) return Math.round(amount)
  // Rounded because a byte count is integral, and because the float multiply does not
  // land there on its own: `4.1 * 1000 ** 2` is 4099999.9999999995, which then renders
  // as `4099999.9999999995 B/s` the moment it reaches a rate.
  if (unit in BINARY) return Math.round(amount * 1024 ** BINARY[unit]!)
  if (unit in DECIMAL) return Math.round(amount * 1000 ** DECIMAL[unit]!)
  return null
}

/**
 * Split one of Docker's `<in> / <out>` pair columns (`NetIO`, `BlockIO`) into bytes.
 *
 * Either side can be independently unavailable, so each is reported on its own; a column
 * Docker filled with `--` yields `[null, null]` rather than a zeroed pair.
 */
export function parseDockerBytePair(value: unknown): [number | null, number | null] {
  if (typeof value !== 'string') return [null, null]
  const [left, right] = value.split('/')
  return [parseDockerBytes(left), parseDockerBytes(right)]
}

const RATE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const

/**
 * Bytes-per-second → a short display string, in the same decimal units Docker printed the
 * counter in (so `1.2kB` accumulating once a second reads as `1.2 kB/s`, not `1.17 KiB/s`).
 */
export function formatByteRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return ''
  let value = bytesPerSecond
  let unit = 0
  while (value >= 1000 && unit < RATE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const rounded = unit === 0 ? Math.round(value) : Number(value.toFixed(value < 10 ? 1 : 0))
  return `${rounded} ${RATE_UNITS[unit]}/s`
}

const BINARY_ABBRS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const
const DECIMAL_ABBRS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 * go-units' `%.{precision}g`: significant digits, trailing zeros stripped.
 *
 * Not a fixed number of decimals — that is the difference between Docker's `17.54GiB` and a
 * naive `17.5GiB`, and between `1.68MB` and `1.7MB`.
 */
function significant(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '0'
  // After the unit division the value sits in [0, base), so `toPrecision` never goes exponential.
  const text = value.toPrecision(precision)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

function humanSize(
  bytes: number,
  base: number,
  abbrs: readonly string[],
  precision: number,
): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  let value = bytes
  let unit = 0
  while (value >= base && unit < abbrs.length - 1) {
    value /= base
    unit += 1
  }
  return `${significant(value, precision)}${abbrs[unit]}`
}

/**
 * Memory sizes, as `docker stats` prints them: BINARY units, 4 significant digits.
 *
 * `units.BytesSize` in docker/cli's `formatter_stats.go`. Verified against a live container:
 * `143.3MiB / 17.54GiB`.
 */
export function formatBinarySize(bytes: number): string {
  return humanSize(bytes, 1024, BINARY_ABBRS, 4)
}

/**
 * Network and block I/O totals, as `docker stats` prints them: DECIMAL units, 3 significant
 * digits (`units.HumanSizeWithPrecision(x, 3)`).
 *
 * The precision genuinely differs from memory's — 1675264 bytes is `1.68MB` here and would be
 * `1.675MB` at memory's precision.
 */
export function formatDecimalSize(bytes: number): string {
  return humanSize(bytes, 1000, DECIMAL_ABBRS, 3)
}
