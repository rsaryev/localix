import type { ReaderBookSummary } from '../shared/contracts'
import type { ParsedReaderDocument } from './chapters'

function newestTimestamp(left: string | undefined, right: string): string {
  return left && left.localeCompare(right) > 0 ? left : right
}

export function bookFromPath(
  path: string,
  parsed: ParsedReaderDocument,
  previous: ReaderBookSummary | undefined,
  size: number,
  updatedAt: string,
): ReaderBookSummary {
  const sourceTitle = parsed.document.title
  const sourceAuthor = parsed.document.author
  const overrides = previous?.overrides
  return {
    path,
    ...(parsed.cover ? { cover: parsed.cover } : {}),
    title: overrides?.title ?? sourceTitle,
    ...((overrides?.author ?? sourceAuthor) ? { author: overrides?.author ?? sourceAuthor } : {}),
    sourceTitle,
    ...(sourceAuthor ? { sourceAuthor } : {}),
    ...(overrides ? { overrides } : {}),
    ...(previous?.collectionIds ? { collectionIds: previous.collectionIds } : {}),
    format: parsed.document.format,
    size,
    updatedAt: newestTimestamp(previous?.updatedAt, updatedAt),
  }
}

export function bookFromMedia(
  mediaId: string,
  name: string | undefined,
  parsed: ParsedReaderDocument,
  previous: ReaderBookSummary | undefined,
  size: number,
): ReaderBookSummary {
  const sourceTitle = parsed.document.title
  const sourceAuthor = parsed.document.author
  const overrides = previous?.overrides
  return {
    path: name?.trim() || mediaId,
    mediaId,
    ...(parsed.cover ? { cover: parsed.cover } : {}),
    title: overrides?.title ?? sourceTitle,
    ...((overrides?.author ?? sourceAuthor) ? { author: overrides?.author ?? sourceAuthor } : {}),
    sourceTitle,
    ...(sourceAuthor ? { sourceAuthor } : {}),
    ...(overrides ? { overrides } : {}),
    ...(previous?.collectionIds ? { collectionIds: previous.collectionIds } : {}),
    format: parsed.document.format,
    size,
    updatedAt: new Date().toISOString(),
  }
}

export function bookFromStorage(
  stored: ReaderBookSummary,
  validCollectionIds: ReadonlySet<string>,
): ReaderBookSummary {
  const overrides = stored.overrides
  const sourceTitle = stored.sourceTitle ?? stored.title
  const sourceAuthor =
    stored.sourceAuthor ?? (overrides?.author === undefined ? stored.author : undefined)
  return {
    ...stored,
    title: overrides?.title ?? stored.title,
    ...((overrides?.author ?? stored.author)
      ? { author: overrides?.author ?? stored.author }
      : { author: undefined }),
    sourceTitle,
    ...(sourceAuthor ? { sourceAuthor } : {}),
    collectionIds: [...new Set(stored.collectionIds ?? [])].filter((id) =>
      validCollectionIds.has(id),
    ),
  }
}
