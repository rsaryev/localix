import { isMissingExecutable } from '@localixai/plugin-sdk/prerequisite'

import { ApiError } from '../../../lib/errors'

/**
 * A content search that could not run because `rg` is not on this machine.
 *
 * It used to answer `500 content_search_failed` with the shell's raw `rg: command not found` as the
 * message — an error that read like a crash, for a program the person simply does not have. The
 * shell's own exit for "no such command" is 127, which is the reliable signal when its wording is
 * localized or reworded. Anything else stays an ordinary search failure.
 */
export function searchToolMissing(raw: string, exitCode?: number): ApiError | null {
  if (exitCode !== 127 && !isMissingExecutable(raw)) return null
  return new ApiError(
    503,
    'tool_missing',
    'ripgrep (rg) is not installed, so file contents cannot be searched.',
    raw || undefined,
  )
}
