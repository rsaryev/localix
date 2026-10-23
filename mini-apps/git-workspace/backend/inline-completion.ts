import type { MiniAppTextInputCompletionSurface } from '@localixai/mini-app-sdk/backend'
import { cleanCompletionSuffix, completionDraftTail } from '@localixai/mini-app-sdk/backend'

import { renderCommitCompletionContext } from './completion-context'
import type { createSourceControlService } from './source-control/service'

export const COMMIT_COMPLETION_SURFACE_ID = 'git-workspace.commit'

interface CommitPayload {
  draft: string
  repoRoot?: string
}

const MAX_DRAFT_BYTES = 400
const MAX_COMPLETION_CHARS = 180
const MAX_SUBJECT_CHARS = 72
const CONVENTIONAL_SUBJECT = /^[a-z][a-z0-9-]*(?:\([^)]+\))?!?:\s+\S/i

function isCommitPayload(value: unknown): value is CommitPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { draft?: unknown }).draft === 'string' &&
    (!('repoRoot' in value) || typeof value.repoRoot === 'string')
  )
}

export function cleanInlineCompletion(raw: string, draft = ''): string {
  return cleanCompletionSuffix(raw, draft, MAX_COMPLETION_CHARS)
}

export function cleanCommitCompletion(raw: string, draft = ''): string {
  if (draft.includes('\n')) return ''
  const suffix = cleanInlineCompletion(raw.split('\n')[0] ?? '', draft)
  if (!suffix) return ''
  if (draft.trim() && CONVENTIONAL_SUBJECT.test(suffix.trimStart())) return ''

  const completed = `${draft}${suffix}`.trim()
  if (!CONVENTIONAL_SUBJECT.test(completed)) return ''
  const remaining = MAX_SUBJECT_CHARS - draft.length
  if (remaining <= 0) return ''
  if (suffix.length <= remaining) return suffix

  const clipped = suffix.slice(0, remaining)
  const wordBoundary = clipped.lastIndexOf(' ')
  return (
    wordBoundary > Math.floor(remaining * 0.55) ? clipped.slice(0, wordBoundary) : clipped
  ).trimEnd()
}

export function createCommitCompletionSurface(
  sourceControl: Pick<ReturnType<typeof createSourceControlService>, 'getCommitCompletionContext'>,
): MiniAppTextInputCompletionSurface {
  return {
    id: COMMIT_COMPLETION_SURFACE_ID,
    async resolveContext(request) {
      if (
        !isCommitPayload(request.payload) ||
        request.signal?.aborted ||
        (request.deadlineAtMs !== undefined && Date.now() >= request.deadlineAtMs)
      ) {
        return []
      }
      const context = await sourceControl.getCommitCompletionContext(
        request.userId,
        request.sessionId,
        request.payload.repoRoot,
        request.signal,
      )
      if (
        !context ||
        request.signal?.aborted ||
        (request.deadlineAtMs !== undefined && Date.now() >= request.deadlineAtMs)
      ) {
        return []
      }
      // One contribution: the host admits it (a secret-shaped diff line is withheld) and clips
      // it to its per-surface ceiling, so this surface no longer bounds the prompt on trust.
      return [
        {
          id: `commit-changeset:${request.payload.repoRoot ?? 'default'}`,
          providerId: COMMIT_COMPLETION_SURFACE_ID,
          providerVersion: '1',
          scope: 'project',
          kind: 'commit-changeset',
          content: renderCommitCompletionContext(context),
          priority: 1000,
          sensitivity: 'project',
        },
      ]
    },
    actionable: (payload, context) => isCommitPayload(payload) && Boolean(context.trim()),
    buildFragment: (payload, context) => {
      if (!isCommitPayload(payload)) return ''
      const draft = completionDraftTail(payload.draft, MAX_DRAFT_BYTES)
      return [context.trim(), draft ? `Current commit-message input: ${JSON.stringify(draft)}` : '']
        .filter(Boolean)
        .join('\n\n')
    },
    instruction: (payload) =>
      isCommitPayload(payload) && payload.draft.trim()
        ? 'only the exact short suffix that completes the current Conventional Commit subject (72 characters total or fewer); preserve joining whitespace, continue unfinished words directly, preserve the user’s chosen type/scope and never repeat the typed prefix'
        : 'one concise Conventional Commit subject (`type(scope): description`, 72 characters or fewer) describing the dominant intent of the actual change set; do not enumerate files or invent omitted changes',
    clean: (raw, payload) =>
      isCommitPayload(payload) ? cleanCommitCompletion(raw, payload.draft) : '',
  }
}
