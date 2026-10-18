/**
 * Peak memory bandwidth of common chips, in GB/s — what decode speed is estimated from. Published
 * figures; a chip not listed falls back to its class, so an estimate is always available and only
 * ever rough.
 */

const APPLE: Record<string, number> = {
  M1: 68,
  'M1 Pro': 200,
  'M1 Max': 400,
  'M1 Ultra': 800,
  M2: 100,
  'M2 Pro': 200,
  'M2 Max': 400,
  'M2 Ultra': 800,
  M3: 100,
  'M3 Pro': 150,
  'M3 Max': 400,
  'M3 Ultra': 819,
  M4: 120,
  'M4 Pro': 273,
  'M4 Max': 546,
  M5: 153,
}
/** An Apple chip newer than the table: its tier's latest known figure. */
const APPLE_TIER: Record<string, number> = { '': 153, Pro: 273, Max: 546, Ultra: 819 }

const NVIDIA: Array<[RegExp, number]> = [
  [/RTX 5090/, 1792],
  [/RTX 5080/, 960],
  [/RTX 5070 Ti/, 896],
  [/RTX 5070/, 672],
  [/RTX 5060 Ti/, 448],
  [/RTX 5060/, 448],
  [/RTX 4090/, 1008],
  [/RTX 4080/, 717],
  [/RTX 4070 Ti/, 504],
  [/RTX 4070/, 504],
  [/RTX 4060 Ti/, 288],
  [/RTX 4060/, 272],
  [/RTX 3090/, 936],
  [/RTX 3080 Ti/, 912],
  [/RTX 3080/, 760],
  [/RTX 3070/, 448],
  [/RTX 3060 Ti/, 448],
  [/RTX 3060/, 360],
  [/A100/, 1555],
  [/H100/, 3350],
  [/L4\b/, 300],
  [/GB10|DGX Spark/, 273],
]

const DEDICATED_GPU = 300
const INTEGRATED_GPU = 70
const CPU = 60

/** Bytes per second for a chip, by name and class. */
export function bandwidthOf(
  chip: string | null,
  kind: 'apple' | 'dedicated' | 'integrated' | 'cpu',
): number {
  const gb = (value: number) => value * 1e9
  if (kind === 'apple' && chip) {
    const m = /\b(M\d+)(?:\s+(Pro|Max|Ultra))?\b/.exec(chip)
    if (m) {
      const name = m[2] ? `${m[1]} ${m[2]}` : m[1]!
      return gb(APPLE[name] ?? APPLE_TIER[m[2] ?? '']!)
    }
  }
  if (kind === 'dedicated' && chip) {
    const known = NVIDIA.find(([pattern]) => pattern.test(chip))
    if (known) return gb(known[1])
    return gb(DEDICATED_GPU)
  }
  if (kind === 'integrated') return gb(INTEGRATED_GPU)
  return gb(CPU)
}
