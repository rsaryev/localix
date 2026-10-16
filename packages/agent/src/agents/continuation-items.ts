import type { AgentItem } from './items'

interface ContinuationMessage {
  id: string
  role: string
  from?: string
  continuedFromMessageId?: string
  items?: AgentItem[]
}

/** Repair replayed prefixes only across explicitly linked assistant segments. */
export function projectContinuationItems<T extends ContinuationMessage>(
  messages: readonly T[],
): readonly T[] {
  if (!messages.some((message) => message.continuedFromMessageId)) return messages
  const rows = new Map<string, { from?: string; owners: Map<string, [number, number]> }>()
  let projected: T[] | undefined
  messages.forEach((message, rowIndex) => {
    if (message.role !== 'assistant') return
    const previous = message.continuedFromMessageId
      ? rows.get(message.continuedFromMessageId)
      : undefined
    const owners =
      previous?.from === message.from
        ? new Map(previous?.owners)
        : new Map<string, [number, number]>()
    const items: AgentItem[] = []
    let repeated = false
    for (const item of message.items ?? []) {
      const owner = owners.get(item.id)
      if (owner) {
        repeated = true
        const [index, itemIndex] = owner
        if (index === rowIndex) {
          items[itemIndex] = item
          continue
        }
        const original = (projected ?? messages)[index]!
        if (original.items?.[itemIndex] !== item) {
          projected ??= [...messages]
          const updated = [...original.items!]
          updated[itemIndex] = item
          projected[index] = { ...original, items: updated }
        }
      } else {
        owners.set(item.id, [rowIndex, items.length])
        items.push(item)
      }
    }
    if (repeated) {
      projected ??= [...messages]
      projected[rowIndex] = { ...message, items }
    }
    rows.set(message.id, { from: message.from, owners })
  })
  return projected ?? messages
}
