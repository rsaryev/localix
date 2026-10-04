import { isFileChangeItem, isItemStreaming } from '@localixai/agent/agents/items'
import type { AgentItem } from '@localixai/agent/agents'
import { publishFilesReloaded } from '@/shared/lib/fileReloadBus'

/**
 * An agent's finished file edit, announced to every open editor of that file.
 *
 * The editor used to learn about an agent's `edit`/`write`/`apply_patch` only through the
 * file watcher — which watches one root per session, starts only once the Explorer has
 * listed that root, and delivers to the session it belongs to. A file outside that root, a
 * watcher never started, or a tab owned by another session all left the open editor showing
 * the old text until it was closed and reopened. The tool's own settled card is on the
 * stream anyway and names exactly the files it wrote, so it is announced on the known-write
 * bus (`fileReloadBus`), which every open editor of the path reconciles against — a clean
 * buffer takes the new text, a dirty one raises its reconcile banner, and an unchanged file
 * answers "unchanged" to the conditional read.
 *
 * Each settled item is announced once: a card's later snapshots (and a replay) name the same
 * item again. The memory is bounded — forgetting an old key only costs one extra, cheap,
 * conditional re-read.
 */

const MAX_REMEMBERED = 2000
const announced = new Set<string>()

function remember(key: string): boolean {
  if (announced.has(key)) return false
  announced.add(key)
  if (announced.size > MAX_REMEMBERED) {
    const oldest = announced.values().next().value
    if (oldest !== undefined) announced.delete(oldest)
  }
  return true
}

/** The files a message's settled file-change items wrote, each item counted once. */
export function newlyWrittenFiles(
  messageId: string,
  items: readonly AgentItem[] | undefined,
): string[] {
  const paths: string[] = []
  for (const item of items ?? []) {
    if (!isFileChangeItem(item) || isItemStreaming(item)) continue
    if (!remember(`${messageId}\u0000${item.id}`)) continue
    for (const change of item.changes) {
      if (!change.failed && change.kind !== 'delete') paths.push(change.path)
    }
  }
  return paths
}

/** Announce the files a message's newly settled file-change items wrote. */
export function routeAgentFileWrites(
  messageId: string,
  items: readonly AgentItem[] | undefined,
): void {
  publishFilesReloaded(newlyWrittenFiles(messageId, items))
}

/** Test seam: forget every announced item. */
export function resetAgentFileWrites(): void {
  announced.clear()
}
