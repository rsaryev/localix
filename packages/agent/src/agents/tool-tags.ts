// How a tool is classified outside its own code: the settings UI groups it by category, and the
// host recognizes the jobs it takes on by role.

/**
 * UI category used to group tools in settings.
 * The api tool manifest tags each tool with one of these; the frontend reads them from the API.
 * Add new categories here as needed.
 */
export type AgentToolCategory = 'core' | 'filesystem' | 'knowledge' | 'automation' | 'ui'

/**
 * A job the host has rules for, which any tool may take on by declaring it — the host then knows
 * the tool by its role and never by its name, so a tool from a mini app or MCP server is found the
 * same way a built-in is.
 *
 * - `task-board`: the run's task board. Its input has an `action`: `create` makes cards and answers
 *   with `details.task` or `details.tasks` (`{ id, title, description? }`), `detail` reads one by
 *   `task_id`, `complete` closes one by `task_id`, `delete` removes one. The board rules join the
 *   prompt, and Claude Code's TaskCreated / TaskCompleted hooks run on its cards.
 */
export type ToolRole = 'task-board'
