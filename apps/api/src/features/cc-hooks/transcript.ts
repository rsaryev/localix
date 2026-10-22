/**
 * Claude Code's `transcript_path` and `agent_transcript_path`: a JSONL file of the conversation
 * that hooks read (ralph-loop takes the last assistant text from it, hookify matches stop rules
 * against it). Claude Code writes it as the session goes; the host here keeps the conversation in
 * its database, so the file is a projection the host brings up to date before a hook that can
 * read it runs. This module only says when; what goes in the file is the host's (the chat
 * feature's `cc-transcript.ts`).
 *
 * Layer: api feature module. No chat/UI imports.
 */
import type { CcHookHandler, CcHookInput } from './contracts'

export interface CcTranscript {
  /** The session's transcript file (`transcript_path`). */
  path: string
  /** A subagent's own transcript file (`agent_transcript_path`). */
  agentPath(agentId: string): string
  /**
   * Bring the files this input names up to date: the session's, and for SubagentStop the
   * subagent's own. Never throws; a file that could not be written keeps its last state.
   */
  refresh(input: CcHookInput): Promise<void>
}

/** Handlers that run outside the process and so can open the file the path names. */
export const readsTranscript = (handler: CcHookHandler): boolean =>
  handler.kind === undefined || handler.kind === 'command' || handler.kind === 'http'

/** Refresh the transcript for those of `handlers` that can read it; a no-op otherwise. */
export async function refreshTranscriptFor(
  transcript: CcTranscript | undefined,
  handlers: readonly CcHookHandler[],
  input: CcHookInput,
): Promise<void> {
  if (transcript && handlers.some(readsTranscript)) await transcript.refresh(input)
}
