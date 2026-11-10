/**
 * Claude Code's `transcript_path` and `agent_transcript_path`: a JSONL file of the conversation
 * that hooks read (ralph-loop takes the last assistant text from it, hookify matches stop rules
 * against it). Claude Code writes it as the session goes; the host here keeps the conversation in
 * its database, so the file is a projection the host brings up to date before a hook runs. What
 * goes in the file is the chat feature's (`cc-transcript.ts`).
 *
 * Layer: api feature module. No chat/UI imports.
 */
export interface CcTranscript {
  /** The session's transcript file (`transcript_path`). */
  path: string
  /** A subagent's own transcript file (`agent_transcript_path`). */
  agentPath(agentId: string): string
  /**
   * Bring the session's file up to date, and the subagent's own when one is named (SubagentStop).
   * Never throws; a file that could not be written keeps its last state.
   */
  refresh(agentId?: string): Promise<void>
}
