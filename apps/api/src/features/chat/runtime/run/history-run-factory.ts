/**
 * How `executeRun` gets its history run. Every session — the user's chat, a delegated task run, a
 * loop round, a delegated sub-agent, a hook verifier — runs the ONE chat-hybrid strategy:
 * boundary cut → runtime tail → reminders → media → preflight → compress → admission. A
 * sub-session is an ordinary session with a narrower tool surface, not a different runtime.
 *
 * Kept out of the history stage (`stages/history.ts`) so the media/document wiring is one
 * readable function rather than twenty lines inside the stage that opens the run row.
 */
import type { RunnerDeps } from '../agent-runner-types'
import { createChatHistoryRun, type ChatHistoryRunContext } from '../history/chat-strategy'
import { buildDocumentTextExtractor } from './document-extract'

export interface BuildHistoryRunInput {
  deps: RunnerDeps
  ctx: Omit<ChatHistoryRunContext, 'media' | 'recoveryToolAvailable'>
  defaultCwd: string
  recoveryToolAvailable: boolean
  /** Does this run's model read images? Decides whether returned tool images are replayed. */
  acceptsImages: boolean
}

export function buildHistoryRun(input: BuildHistoryRunInput) {
  const { deps } = input
  return createChatHistoryRun({
    ...input.ctx,
    recoveryToolAvailable: input.recoveryToolAvailable,
    media: {
      mediaStore: deps.mediaStore,
      defaultCwd: input.defaultCwd,
      acceptsImages: input.acceptsImages,
      // Office/spreadsheet attachments get their TEXT extracted for a head preview.
      extractDocument: (() => {
        const port = deps.documentExtract?.()
        return port ? buildDocumentTextExtractor(port) : undefined
      })(),
    },
  })
}
