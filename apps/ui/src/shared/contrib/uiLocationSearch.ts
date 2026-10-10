import type { UiLocationDescriptor } from '@localixai/plugin-sdk/ui'

function compareLocationOrder(left: UiLocationDescriptor, right: UiLocationDescriptor): number {
  if (left.title !== right.title) return left.title < right.title ? -1 : 1
  return left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0
}

export function rankUiLocations(
  entries: UiLocationDescriptor[],
  needle: string,
  limit: number,
): UiLocationDescriptor[] {
  const rows = entries.map((entry) => {
    const text =
      `${entry.title} ${entry.description ?? ''} ${entry.id} ${entry.keywords.join(' ')}`.toLowerCase()
    const title = entry.title.toLowerCase()
    const score =
      !needle || title === needle ? 3 : title.startsWith(needle) ? 2 : text.includes(needle) ? 1 : 0
    return { entry, score }
  })
  return rows
    .filter((row) => row.score > 0)
    .sort(
      (left, right) => right.score - left.score || compareLocationOrder(left.entry, right.entry),
    )
    .slice(0, limit)
    .map((row) => row.entry)
}
