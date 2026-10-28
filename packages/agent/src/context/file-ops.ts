/**
 * WHICH FILES a stretch of conversation read and changed, read from its tool calls.
 *
 * When history leaves the model's view it is described by an epoch card, and the one fact a card
 * must not get wrong is which files the work touched: the model's next step after a checkpoint is
 * usually a re-read of one of them. So the lists come from the structured tool items — a
 * `file_change` item carries the exact paths it applied, whichever tool (`write`, `edit`,
 * a historical `apply_patch`) produced it — never from prose, which can drop or misname a path.
 */
import type { ChatMessage } from '../chat'
import { isFileChangeItem, isToolBackedItem } from '../agents/items'
import { inputFilePaths } from './path-key'

export interface FileOperations {
  read: string[]
  modified: string[]
}

/** Tools whose `path` argument names a file they only read (`view_image`: historical items). */
const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'view_image'])

/**
 * Paths read and modified by COMPLETED tool calls, in first-seen order.
 *
 * A path that was both read and modified is listed as modified only: "changed" is the stronger
 * fact, and listing it twice would spend card budget on a duplicate. A hunk that failed to apply
 * changed nothing, so its path is not reported as modified.
 */
export function extractFileOperations(messages: readonly ChatMessage[]): FileOperations {
  const read = new Set<string>()
  const modified = new Set<string>()
  for (const message of messages) {
    for (const item of message.items ?? []) {
      if (!isToolBackedItem(item) || item.status !== 'completed') continue
      if (isFileChangeItem(item)) {
        for (const change of item.changes) {
          const path = change.path.trim()
          if (path && !change.failed) modified.add(path)
        }
        continue
      }
      if (!READ_TOOLS.has(item.name)) continue
      // Every file of a batched read (`reads`), not just its first.
      for (const path of inputFilePaths(item.input)) read.add(path.trim())
    }
  }
  for (const path of modified) read.delete(path)
  return { read: [...read], modified: [...modified] }
}
