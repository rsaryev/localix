/**
 * What a subagent (a child session started with `Agent`) is told about its own run: execute the
 * assignment once, and how to reach the agent that started it.
 */

export const ONE_SHOT_EXECUTION = `Execute the assigned task once, within its scope and your professional role.
Keep detailed investigation and tool output in this session.
Publish progress only when the stage changes, a blocker appears, or input is needed.
The parent reviews your report.
The parent may message you, during this task or after your report: each message amends this assignment, and your final reply to it is sent back as a new report.`

/**
 * The child's line to its parent mid-run (`SendMessage`), said once with the task. Without it a
 * child that hit a question only the parent can answer guessed, or ended early to ask in its reply.
 */
export const PARENT_LINE =
  'To ask the agent that started you something only it can answer, or to share a finding it needs now, SendMessage to "main": keep working, or end your turn if you can only wait, and its answer arrives as a message. Do not send your final result that way.'
