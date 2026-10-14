export type SortDirection = 'asc' | 'desc'
export type ResourceSortValue = string | number | boolean | null | undefined

export interface ResourceSort<Key extends string = string> {
  key: Key
  direction: SortDirection
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

/** Normalize one persisted sort record against the keys supported by a resource view. */
export function normalizeResourceSort<Key extends string>(
  raw: unknown,
  allowedKeys: readonly Key[],
  fallback: ResourceSort<Key>,
): ResourceSort<Key> {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const key =
    typeof value.key === 'string' && allowedKeys.includes(value.key as Key)
      ? (value.key as Key)
      : fallback.key
  const direction =
    value.direction === 'asc' || value.direction === 'desc' ? value.direction : fallback.direction
  return { key, direction }
}

function compareValues(left: ResourceSortValue, right: ResourceSortValue): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return collator.compare(String(left), String(right))
}

/** Stable, immutable client-side sorting for already-loaded resource inventories. */
export function sortResources<Item>(
  items: readonly Item[],
  sort: ResourceSort,
  valueFor: (item: Item, key: string) => ResourceSortValue,
): Item[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftValue = valueFor(left.item, sort.key)
      const rightValue = valueFor(right.item, sort.key)
      if (leftValue == null && rightValue == null) return left.index - right.index
      // Missing/unparseable values remain last in BOTH directions.
      if (leftValue == null) return 1
      if (rightValue == null) return -1
      const compared = compareValues(leftValue, rightValue) * direction
      return compared || left.index - right.index
    })
    .map(({ item }) => item)
}

/** Invalid dates sort last. */
export function sortableTimestamp(value: string): number | null {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

/** Docker human sizes (`142MB`, `1.2 GiB`) converted to bytes for numeric sorting. */
export function sortableByteSize(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)\s*([kmgtpe]?i?b)?$/i)
  if (!match) return null
  const amount = Number.parseFloat(match[1] ?? '')
  if (!Number.isFinite(amount)) return null
  const unit = (match[2] ?? 'b').toLowerCase()
  const powers: Record<string, number> = {
    b: 0,
    kb: 1,
    kib: 1,
    mb: 2,
    mib: 2,
    gb: 3,
    gib: 3,
    tb: 4,
    tib: 4,
    pb: 5,
    pib: 5,
    eb: 6,
    eib: 6,
  }
  const power = powers[unit]
  const base = unit.includes('i') ? 1024 : 1000
  return power === undefined ? null : amount * base ** power
}
