/**
 * Writes that touch only the WORKING TREE and the index — staging, discarding,
 * ignoring.
 *
 * They are grouped by what they invalidate, not by subject matter: none of them
 * can move a ref, so each answers with the refreshed status ALONE and the UI has
 * nothing else to repaint (see `SourceControlMutation`). Everything that can
 * move a branch tip lives in `service-ref-writes.ts` and answers with more.
 */
import type { SourceControlMutation } from './contracts'
import type { LineStageInput } from './ports'

export interface SourceControlTreeWrites {
  /** Revert a single hunk of a file back to its committed state; returns the refreshed status. */
  revertHunk(
    userId: string,
    sessionId: string | null,
    input: { path: string; index: number; header: string },
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Stage the selected diff lines of a file; returns the refreshed status. */
  stageLines(
    userId: string,
    sessionId: string | null,
    input: LineStageInput,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Unstage the selected diff lines of a file; returns the refreshed status. */
  unstageLines(
    userId: string,
    sessionId: string | null,
    input: LineStageInput,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Discard the selected diff lines from the working tree (destructive); returns the refreshed status. */
  discardLines(
    userId: string,
    sessionId: string | null,
    input: LineStageInput,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  stage(
    userId: string,
    sessionId: string | null,
    paths: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  unstage(
    userId: string,
    sessionId: string | null,
    paths: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  discard(
    userId: string,
    sessionId: string | null,
    paths: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Append gitignore patterns to the repo's `.gitignore`; returns the refreshed status. */
  addToGitignore(
    userId: string,
    sessionId: string | null,
    patterns: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation>
}
