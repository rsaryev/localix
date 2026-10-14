/**
 * The three ways a run can happen. Not roles, not names — hosts.
 *
 *  - `chat`       — a human is watching and can be asked. The only shape that may grow.
 *  - `subagent`   — a delegated child: synchronous, reports to its parent, cannot nest freely.
 *  - `automation` — unattended: a scheduled job or a loop's run. Nobody to ask.
 */
export type RunShape = 'chat' | 'subagent' | 'automation'

/**
 * How one shape relates to one tool.
 *
 *  - `default` — in the shape's base surface.
 *  - `opt-in`  — not by default; an agent record may declare it for this shape.
 *  - `never`   — the shape cannot carry it at all. A declaration is an error, the prompt does
 *                not mention it, and no remedy exists: this is the structural bound (a child
 *                cannot ask the user; a sub-session cannot rewrite configuration).
 */
export type ExposureLevel = 'default' | 'opt-in' | 'never'

export type ToolExposure = Readonly<Record<RunShape, ExposureLevel>>

/** What a tool that declares nothing gets: on a chat's wire, declarable by an unattended role. */
export const DEFAULT_TOOL_EXPOSURE: ToolExposure = {
  chat: 'default',
  subagent: 'opt-in',
  automation: 'opt-in',
}
