import type { FoldedSummary, SourceRef, SummaryFold } from './types'
import { foldJsonlFrom, readMark } from './fs-read'

/** Above this a session's usage is not walked at all, so it never carries a fold either. */
export const MAX_USAGE_FILE_BYTES = 128 * 1024 * 1024

/**
 * The previous fold of this same file, when the file only grew since: the same path, at least as
 * many bytes as the fold read, and the bytes before its cut unchanged. Anything else refolds from
 * byte 0, which is always correct and only slower.
 */
export async function resumableFold(
  ref: SourceRef,
  previous: FoldedSummary | undefined,
): Promise<FoldedSummary | undefined> {
  const fold = previous?.fold
  if (!fold || previous.summary.sourcePath !== ref.sourcePath) return undefined
  if (ref.sourceBytes === undefined || ref.sourceBytes < fold.offset) return undefined
  try {
    return (await readMark(ref.sourcePath, fold.offset)) === fold.mark ? previous : undefined
  } catch {
    return undefined
  }
}

/** Whether this file's usage is walked, and how far: a whole-file bound, never a mid-file cut. */
export function usageEnd(ref: SourceRef): number | undefined {
  const size = ref.sourceBytes
  return size !== undefined && size <= MAX_USAGE_FILE_BYTES ? size : undefined
}

/**
 * The most a LIST read walks: what appends add to a session between two looks at it. A live
 * session grows by kilobytes per turn, so its counts stay current at list cost; a session first
 * seen, or one that grew past this while nobody looked, waits for a walked scan instead.
 */
export const LIST_WALK_BYTES = 4 * 1024 * 1024

/**
 * How far this read walks, and whether that leaves the walk owed: a walked read goes to the usage
 * end; a list read only continues a resumed fold by an append's worth, and otherwise walks nothing.
 */
export function walkEnd(
  ref: SourceRef,
  resumed: FoldedSummary | undefined,
  walk: boolean,
): { end: number; unwalked: boolean } | undefined {
  const end = usageEnd(ref)
  if (end === undefined) return undefined
  const from = resumed?.fold?.offset ?? 0
  if (walk || (resumed && end - from <= LIST_WALK_BYTES)) return { end, unwalked: false }
  return { end: from, unwalked: from < end }
}

/**
 * Fold the records the previous fold has not read, up to `end`, and say where this one stopped.
 * `carry` is asked after the walk, so it reports what the fold holds at its cut.
 */
export async function foldOnward(
  ref: SourceRef,
  resumed: FoldedSummary | undefined,
  end: number,
  wanted: (line: string) => boolean,
  onRecord: (record: Record<string, unknown>) => void,
  carry: () => Readonly<Record<string, unknown>> | undefined,
): Promise<SummaryFold> {
  const offset = await foldJsonlFrom(
    ref.sourcePath,
    resumed?.fold?.offset ?? 0,
    end,
    wanted,
    onRecord,
  )
  const held = carry()
  return { offset, mark: await readMark(ref.sourcePath, offset), ...(held ? { carry: held } : {}) }
}
