import type { MessageContextBindingDraft } from './contrib'
import { fileExtension, mediaTypeForPath } from './file-types'

export type ContextBindingPreviewKind = 'image' | 'text'

function stringAttribute(binding: MessageContextBindingDraft, name: string): string | null {
  const value = binding.target.attributes?.[name]
  return typeof value === 'string' && value ? value : null
}

/** Opaque content id for a host-persisted browser/clipboard file. Never a path. */
export function contextBindingMediaId(binding: MessageContextBindingDraft): string | null {
  return binding.target.kind === 'file' ? stringAttribute(binding, 'mediaId') : null
}

/** Original filename used for routing and presentation of either file storage route. */
export function contextBindingFileName(binding: MessageContextBindingDraft): string | null {
  if (binding.target.kind !== 'file') return null
  return stringAttribute(binding, 'name') ?? binding.target.label ?? null
}

/** Declared media type for a persisted browser/clipboard file. */
export function contextBindingFileType(binding: MessageContextBindingDraft): string | null {
  return binding.target.kind === 'file' ? stringAttribute(binding, 'type') : null
}

const IMAGE_PREVIEW_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
])

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'css',
  'go',
  'html',
  'java',
  'js',
  'json',
  'jsonc',
  'jsx',
  'md',
  'mdx',
  'py',
  'rs',
  'scss',
  'sh',
  'sql',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
])

/** Canonical file path carried by a context binding, without depending on a mini app's model. */
export function contextBindingFilePath(binding: MessageContextBindingDraft): string | null {
  if (binding.target.kind !== 'file') return null
  if (contextBindingMediaId(binding)) return null
  const path = binding.target.attributes?.path
  if (typeof path === 'string' && path) return path
  return binding.target.token.startsWith('@/') ? binding.target.token.slice(1) : null
}

/** Synchronous host-neutral presentation hint; reading and rendering still belong to the host. */
export function contextBindingPreviewKind(
  binding: MessageContextBindingDraft,
): ContextBindingPreviewKind | null {
  if (binding.target.kind !== 'file') return null
  const candidate = contextBindingFilePath(binding) ?? contextBindingFileName(binding)
  if (!candidate) return null
  const mediaType = contextBindingFileType(binding)
  if (mediaType?.startsWith('image/')) return 'image'
  if (mediaType?.startsWith('text/')) return 'text'
  const extension = fileExtension(candidate)
  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) return 'image'
  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) return 'text'
  return null
}

/** MIME fallback for image bindings when a remote/local file source omits one. */
export function contextBindingImageMimeType(binding: MessageContextBindingDraft): string | null {
  const mediaType = contextBindingFileType(binding)
  if (mediaType?.startsWith('image/')) return mediaType
  const candidate = contextBindingFilePath(binding) ?? contextBindingFileName(binding)
  if (!candidate) return null
  const byExtension = mediaTypeForPath(candidate)
  return byExtension?.startsWith('image/') ? byExtension : null
}
