import type { IconComponent, MiniAppOwnedContribution } from './contrib'

/**
 * Where a batch of review comments can go besides the chat.
 *
 * The host owns the batch — the comments a person left on a file or a preview, and the "send to
 * the agent" action every surface shares. What else a batch can become (a card on a task board, an
 * issue in a tracker) is a mini app's to offer: the host renders every contributed action beside
 * "Send", hands it the batch, and clears the comments once the action resolved. The host names no
 * destination itself.
 */
export interface CommentBatch {
  /** The chat the comments were written in. */
  sessionId: string
  /** A short title derived from what the comments are about. */
  title: string
  /** Every comment, as markdown, with its target line quoted. */
  summary: string
  /** Workspace paths the comments point at. */
  files: readonly string[]
}

export interface CommentActionContribution extends MiniAppOwnedContribution {
  /** `<app>:<name>`, like every mini-app-chosen identity. */
  id: string
  /** The button's text, e.g. "Task". */
  label: string
  /** Tooltip naming what happens, e.g. "Create a board task from these comments". */
  title?: string
  Icon: IconComponent
  /**
   * Do it. Resolve with a sentence to confirm it to the person ("Added to the board"); reject with
   * a sentence to tell them it failed. The comments are cleared only after it resolves.
   */
  run(batch: CommentBatch): Promise<{ message?: string } | void>
}
