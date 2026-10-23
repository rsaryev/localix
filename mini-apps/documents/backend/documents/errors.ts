/**
 * Typed, agnostic error vocabulary for document extraction/generation. Every driver
 * throws its own lib-specific shape; the service feeds it through
 * {@link mapDocumentError} so routes and capability adapters
 * tools) get a small, stable set of codes to render/branch on WITHOUT knowing anything
 * about mammoth vs officeparser vs SheetJS.
 *
 * The class + `toErrorInfo` skeleton is NOT re-hand-rolled here: it is the shared
 * `@localixai/mini-app-sdk/backend` factory, which the four workbench subsystems share too.
 * What stays is the only part with domain content in it — the code vocabulary, the
 * friendly sentences, the HTTP status map, and `mapDocumentError`.
 */

import { errorMessage } from '@localixai/mini-app-sdk/backend'
import { defineTypedError } from '@localixai/mini-app-sdk/backend'

export type DocumentErrorCode =
  | 'unsupported_format'
  | 'not_found'
  | 'too_large'
  | 'invalid_input'
  | 'extract_failed'
  | 'generate_failed'

const FRIENDLY: Record<DocumentErrorCode, string> = {
  unsupported_format: 'This file type is not supported for extraction.',
  not_found: 'The document could not be found.',
  too_large: 'The document is too large to extract.',
  invalid_input: 'The request is missing a file path or media id.',
  extract_failed: 'The document could not be extracted.',
  generate_failed: 'The document could not be generated.',
}

/** HTTP status for each code (routes map codes → responses). */
export const DOCUMENT_ERROR_STATUS: Record<DocumentErrorCode, number> = {
  unsupported_format: 415,
  not_found: 404,
  too_large: 413,
  invalid_input: 400,
  extract_failed: 400,
  generate_failed: 400,
}

const kit = defineTypedError<DocumentErrorCode>('DocumentError', FRIENDLY)

/** A typed document error: `code` is the stable classification, `message` the raw text. */
export const DocumentError = kit.DomainError
export type DocumentError = InstanceType<typeof DocumentError>

/** Wire payload: friendly `message`, with the raw text as `detail` when it adds anything. */
export const toErrorInfo = kit.toErrorInfo

/**
 * Classify an arbitrary thrown value into a {@link DocumentError}. Idempotent: an
 * already-mapped error is returned unchanged. Anything unrecognised collapses to
 * `extract_failed` carrying the raw text, so an operator still sees what the lib said.
 */
export function mapDocumentError(err: unknown): DocumentError {
  if (err instanceof DocumentError) return err
  return new DocumentError('extract_failed', errorMessage(err), { cause: err })
}
