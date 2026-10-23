/**
 * A failed read, in the two halves the report has room for.
 *
 * `errorMessage(err, fallback)` returns the fallback ONLY when the thrown thing has no message of
 * its own, which is almost never: a dropped request arrives as `TypeError: Failed to fetch` and a
 * broken file as `InvalidPDFException: …`, so the sentence the tab wrote was thrown away and a V8
 * string took the pane. The route's own message IS a sentence — it comes from `defineTypedError` —
 * so that one is kept; anything else is classified and its raw text goes where raw text belongs.
 */

import { MiniAppApiError } from '@localixai/mini-app-sdk/ui/transport'

export function documentFailure(
  error: unknown,
  message: string,
): { message: string; detail?: string } {
  if (error instanceof MiniAppApiError) {
    return { message: error.message, ...(error.detail ? { detail: error.detail } : {}) }
  }
  const raw = error instanceof Error ? error.message : String(error)
  return { message, ...(raw ? { detail: raw } : {}) }
}
