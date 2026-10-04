import { fileExtension } from '@localixai/plugin-sdk/ui/file-types'

import { BUILTIN_EDITOR_CHOICE } from '@/shared/contrib/fileEditorChoice'

const NATIVE_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
])

const NATIVE_TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'html',
  'htm',
  'css',
  'scss',
  'js',
  'jsx',
  'ts',
  'tsx',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'xml',
  'toml',
  'sql',
  'sh',
  'py',
  'rs',
])

export type NativeFileViewerKind = 'image' | 'text'

export function nativeFileViewerKind(pathOrName: string): NativeFileViewerKind | null {
  const extension = fileExtension(pathOrName)
  if (NATIVE_IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (NATIVE_TEXT_EXTENSIONS.has(extension)) return 'text'
  return null
}

/** Formats for which the built-in file surface is a first-class viewer. */
export function hasNativeFileViewer(pathOrName: string): boolean {
  return nativeFileViewerKind(pathOrName) !== null
}

/**
 * Resolve an editor without hiding a meaningful collision from the user.
 * `null` means the Open with chooser must be rendered.
 *
 * `requestedBuiltin` outranks everything, including a remembered preference: it is not a guess
 * about what the reader usually wants but an explicit instruction from the OPEN — "show me the
 * text of this file" — and the only way to express it. Without it, a plugin owning a file type
 * either wins silently (one match, no native viewer) or forces the chooser (one match plus a
 * native viewer), and neither can be answered with "the code, please".
 */
export function initialFileEditorSelection(
  matchingIds: string[],
  remembered: string | null,
  offerNativeChoice: boolean,
  requestedBuiltin = false,
): string | null {
  if (requestedBuiltin) return BUILTIN_EDITOR_CHOICE
  if (remembered === BUILTIN_EDITOR_CHOICE) return BUILTIN_EDITOR_CHOICE
  if (remembered && matchingIds.includes(remembered)) return remembered
  if (matchingIds.length === 1 && !offerNativeChoice) return matchingIds[0]!
  return null
}
