import type { Message } from './contracts'

/**
 * Rebind timeline anchors when a persisted message claims one or more
 * client-only optimistic ids. Only anchored rows are cloned; an unused mapping
 * preserves the original array and every message reference.
 */
export function remapMessageAnchors(
  messages: Message[],
  idRemap: ReadonlyMap<string, string>,
): Message[] {
  if (idRemap.size === 0) return messages

  let remapped: Message[] | null = null
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const anchor = message.afterMessageId
    if (anchor == null) continue
    const nextAnchor = idRemap.get(anchor)
    if (!nextAnchor || nextAnchor === anchor) continue
    remapped ??= messages.slice()
    remapped[index] = { ...message, afterMessageId: nextAnchor }
  }
  return remapped ?? messages
}
