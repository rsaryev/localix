import { looksBinary } from '@/shared/lib/looksBinary'
import { isMarkdown } from './fileTabHelpers'
import type { FileContentResponse } from '@/shared/api/contracts'

type ReadyState = {
  status: 'ready'
  content: string
  truncated: boolean
  mimeType?: string
  encoding?: 'utf8' | 'base64'
  /** Absolute resolved path (LSP + save key). */
  absPath: string
  /** Optimistic-concurrency token (absent when truncated). */
  hash?: string
  /** Editable text (not image/binary/truncated) → opens directly in the editor. */
  editable: boolean
}

export type FileLoadState =
  | { status: 'loading'; reconnecting?: boolean }
  /** `message` is the classified sentence; `detail` is the backend's own words, for the centre. */
  | { status: 'error'; message: string; detail?: string }
  | ReadyState

export function readyStateFor(path: string, response: FileContentResponse): ReadyState {
  const isImage = Boolean(response.mimeType?.startsWith('image/'))
  const isBinary = !isMarkdown(path) && !isImage && looksBinary(response.content)
  return {
    status: 'ready',
    content: response.content,
    truncated: response.truncated,
    mimeType: response.mimeType,
    encoding: response.encoding,
    absPath: response.path,
    hash: response.hash,
    editable: !isImage && !isBinary && !response.truncated && response.hash != null,
  }
}
