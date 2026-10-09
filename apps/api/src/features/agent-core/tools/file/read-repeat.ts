import type { ReadDedupStore } from './read-dedup'
import { readDedupStub } from './read-dedup-stub'

/**
 * A pointer is valid only for the same window and bytes while its earlier result survives.
 * Clipped deliveries do not arm a new pointer that could hide the unread tail.
 */
export function createReadRepeatPolicy(
  targetPath: string,
  toolCallId: string,
  dedup: ReadDedupStore,
  isResultElided?: (toolCallId: string) => boolean,
) {
  const dedupStub = (
    window: string | undefined,
    delivered: string,
    suppressArm: boolean,
  ): string | undefined => {
    const earlierCallId = dedup.lastCallId(targetPath, window)
    const stubOk = isResultElided
      ? earlierCallId !== undefined && !isResultElided(earlierCallId)
      : !dedup.stubServed(targetPath, window)
    if (dedup.isUnchanged(targetPath, window, delivered) && stubOk) {
      dedup.setStubServed(targetPath, window, true)
      const what = window === undefined ? targetPath : `${targetPath} (${window})`
      return readDedupStub(what)
    }
    if (!suppressArm) dedup.record(targetPath, window, delivered, toolCallId)
    return undefined
  }

  return dedupStub
}
