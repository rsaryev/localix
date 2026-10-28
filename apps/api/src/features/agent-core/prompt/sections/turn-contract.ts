/**
 * The conversation contract, in the pieces the prompt assembles by what the run holds.
 * Shared behavior has one owner; tool schemas separately describe their call shapes.
 *
 * WHO does a piece of work — yourself or a subagent — is not here: it is `# Collaboration`
 * (`collaboration.ts`). This file says how a turn with the person is run.
 */

/**
 * The person is reached through `ask`, never by a mention: a question blocks on the tool's own card.
 * A run without `ask` (nobody is at the keyboard) proceeds on a stated assumption instead.
 */
export const HUMAN_ASK_CONTROL = `Never @mention the person. When you need their answer, decision or approval, use \`AskUserQuestion\`; otherwise report and stop — your reply returns to them.`
export const HUMAN_NO_ASK_CONTROL = `Never @mention the person. Nobody can answer a question in this run: when you need a decision, proceed on your best assumption and state it.`

/**
 * The board lines below render only for a run that holds a task board: a contract naming a board
 * the run does not have once made a model invent a KANBAN.md.
 */
export const HUMAN_BOARD_CONTROL = `A card assigned to the person waits for them; never take or do it.`
export const BOARD_OWNER = `You own the whole task board.`
