import type { ReaderFormat, ReaderSource } from './contracts'

/**
 * The ONE answer to "can the reader open this?".
 *
 * Backend parsing (`library.ts`), the file-editor contribution (`register.tsx`),
 * the library's file picker and the reading pane all route through this table —
 * before, each kept its own list, so the picker happily handed the reader a PNG
 * and the failure only surfaced as a backend `Unsupported reader format` string
 * on a chrome-less error pane. The manifest's `fileAssociations` is checked
 * against this table by `formats.test.ts`.
 */
export const READER_FORMAT_BY_EXTENSION: Readonly<Record<string, ReaderFormat>> = {
  epub: 'epub',
  pdf: 'pdf',
  mobi: 'mobi',
  azw3: 'azw3',
  fb2: 'fb2',
  cbz: 'cbz',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
  html: 'html',
  htm: 'html',
}

/** Every extension the reader accepts, lower-case and without a leading dot. */
export const READER_EXTENSIONS: readonly string[] = Object.keys(READER_FORMAT_BY_EXTENSION)

/** Human-facing format list, used wherever the user is told what Reader handles. */
export const READER_FORMAT_SUMMARY = 'EPUB, PDF, MOBI, AZW3, FB2, CBZ, Markdown, HTML and text'

/** Lower-case extension of a path or a bare file name; empty for dot-files and extension-less names. */
export function readerExtension(pathOrName: string): string {
  const name = pathOrName.split(/[/\\]/u).at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function readerFormatFor(pathOrName: string): ReaderFormat | null {
  return READER_FORMAT_BY_EXTENSION[readerExtension(pathOrName)] ?? null
}

export function isReaderReadable(pathOrName: string): boolean {
  return readerFormatFor(pathOrName) !== null
}

export function readerFileName(source: ReaderSource): string {
  const raw = 'path' in source ? source.path : (source.name ?? '')
  return raw.split(/[/\\]/u).at(-1) ?? raw
}

/**
 * Why the reader refuses a source, or `null` when it will at least try.
 *
 * A media-backed source with no name carries no extension to judge, so it is let
 * through and the backend stays the final authority.
 */
export function readerUnsupportedReason(source: ReaderSource): string | null {
  const name = readerFileName(source)
  if (!name || isReaderReadable(name)) return null
  const extension = readerExtension(name)
  return extension
    ? `.${extension} is not a reading format. Reader opens ${READER_FORMAT_SUMMARY}.`
    : `Reader opens ${READER_FORMAT_SUMMARY}.`
}

export { type ReaderFormat }
