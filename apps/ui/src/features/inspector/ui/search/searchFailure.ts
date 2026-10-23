import type { Problem, ProblemRecovery } from '@localixai/mini-app-sdk/ui/problems'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { ApiError } from '@/shared/api/failure'
import { confirmAndOpenExternal } from '@/shared/lib/externalLink'

const RIPGREP_INSTALL_URL = 'https://github.com/BurntSushi/ripgrep#installation'

/** Why a content search produced no list — the sentence, the engine's words, and which kind. */
export interface SearchFailure {
  message: string
  detail: string | null
  /** ripgrep is not installed: the way out is installing it, not editing the pattern. */
  toolMissing: boolean
}

/**
 * Classify a failed search. ripgrep answers `regex parse error: … unclosed group (` — precise, and
 * precisely the thing a status strip cannot hold, so the strip gets the classification and the
 * engine's own words go to the centre as `detail`. A missing ripgrep is not a bad pattern: the
 * server's `tool_missing` sentence names the program.
 */
export function searchFailureOf(err: unknown, regex: boolean): SearchFailure {
  const toolMissing = err instanceof ApiError && err.code === 'tool_missing'
  return {
    message: toolMissing
      ? (err as ApiError).message
      : regex
        ? 'This search pattern could not be run.'
        : 'The search could not be run.',
    detail: (err instanceof ApiError ? err.detail : undefined) ?? (errorMessage(err, '') || null),
    toolMissing,
  }
}

/** The failure as the problem the panel reports, and its way out when there is one. */
export function searchProblemOf(
  failure: SearchFailure,
  query: string,
): { problem: Problem; actions?: ProblemRecovery[] } {
  if (!failure.toolMissing) {
    return {
      problem: { message: failure.message, detail: failure.detail ?? undefined, field: query },
    }
  }
  return {
    problem: {
      message: failure.message,
      hint: 'Install ripgrep, then search again.',
      detail: failure.detail ?? undefined,
      code: 'tool_missing',
    },
    actions: [
      {
        id: 'install-ripgrep',
        label: 'Install ripgrep',
        primary: true,
        run: () => confirmAndOpenExternal(RIPGREP_INSTALL_URL),
      },
    ],
  }
}
