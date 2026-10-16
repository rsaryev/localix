import type { ReaderBookMetadataPatch, ReaderBookSummary } from '../shared/contracts'
import type { ParsedReaderDocument } from './chapters'
import { metadataField } from './presentation-fields'

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

export function patchBookMetadata(
  current: ReaderBookSummary,
  patch: ReaderBookMetadataPatch,
): ReaderBookSummary {
  const overrides = { ...current.overrides }
  if (patch.title !== undefined) {
    if (patch.title === null) delete overrides.title
    else overrides.title = metadataField(patch.title, 'Title')
  }
  if (patch.author !== undefined) {
    if (patch.author === null) delete overrides.author
    else overrides.author = metadataField(patch.author, 'Author', true)
  }
  const sourceTitle = current.sourceTitle ?? current.title
  const sourceAuthor =
    current.sourceAuthor ?? (current.overrides?.author === undefined ? current.author : undefined)
  return {
    ...current,
    title: overrides.title ?? sourceTitle,
    ...((overrides.author ?? sourceAuthor)
      ? { author: overrides.author ?? sourceAuthor }
      : { author: undefined }),
    sourceTitle,
    ...(sourceAuthor ? { sourceAuthor } : {}),
    ...(Object.keys(overrides).length > 0 ? { overrides } : { overrides: undefined }),
    updatedAt: new Date().toISOString(),
  }
}
