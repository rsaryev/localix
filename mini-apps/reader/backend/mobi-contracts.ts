/**
 * Foliate builds its section documents with the linkedom DOM installed by
 * `acquireServerDom`, and a linkedom node's `toString()` is a real HTML serializer.
 * `lib.dom`'s `Document` only inherits Object's, so the serializer is stated here
 * rather than assumed at the one call site that reads the markup back out.
 */
export type SerializableDocument = Document & { toString(): string }

export interface FoliateSection {
  id?: string | number
  linear?: string
  createDocument?: () => Promise<SerializableDocument> | SerializableDocument
}

export interface FoliateTocItem {
  label?: string
  href?: string
  subitems?: FoliateTocItem[]
}

export interface FoliateBook {
  metadata?: Record<string, unknown>
  sections: FoliateSection[]
  toc?: FoliateTocItem[]
  splitTOCHref?: (href: string) => unknown[] | Promise<unknown[]>
  resolveHref?: (
    href: string,
  ) =>
    | { index: number; anchor?: (document: Document) => Element | null }
    | undefined
    | Promise<{ index: number; anchor?: (document: Document) => Element | null } | undefined>
  isExternal?: (href: string) => boolean
  getCover?: () => Promise<Blob | undefined>
  mobi?: { loadResource(index: number): Promise<ArrayBuffer> }
  loadResourceBlob?: (uri: string) => Promise<[Blob]>
  destroy?: () => void
}
