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
