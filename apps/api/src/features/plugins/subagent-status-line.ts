import type { CommandRunner } from '@rsaryev/llx-plugin'
import type { SubagentStatusTask } from '@rsaryev/llx-plugin/settings'
import { childEnv } from '../../lib/login-shell-env'
import {
  hostCommandRunner,
  pluginDataDir,
  processEnvironment,
  runKitSubagentStatusLine,
  subagentStatusLineInput,
  type ChosenSubagentStatusLine,
} from './kit'

/**
 * Running a `subagentStatusLine` (statusline.md, "Subagent status lines"): Claude Code runs the
 * command on every refresh tick with the visible subagent rows on stdin, and draws each
 * `{"id","content"}` line it prints as that row's body: an empty `content` hides the row, a row it
 * does not name keeps the default. Which line runs, under which gates, is the kit's
 * (`chosenSubagentStatusLine`); its stdin, the run and the rows it prints are the kit's too
 * (`runSubagentStatusLine`). Localix keeps the environment, the 5 s limit, the output cap and how a row
 * is drawn: Localix draws its subagents in the runtime panel under the composer, so the command
 * rewrites those rows; the server owns the refresh (`chat/service/subagent-rows-live.ts`).
 */

const TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_CONTENT_CHARS = 500
/** Hook commands' transport, each stream captured up to 64 KiB. */
const cappedRunner = hostCommandRunner({ maxOutputBytes: MAX_OUTPUT_BYTES })

/**
 * A row body as text: ANSI colors and other escape sequences are dropped, and an OSC 8 hyperlink
 * keeps its visible text — the panel draws plain text in the kit's own type.
 */
export function plainRowText(content: string): string {
  return (
    content
      // OSC sequences (hyperlinks, titles), ended by BEL or ST; a link's text sits between them.
      // oxlint-disable-next-line no-control-regex -- strips terminal escapes from a row body
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      // CSI sequences: colors, cursor moves.
      // oxlint-disable-next-line no-control-regex -- strips terminal escapes from a row body
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      // oxlint-disable-next-line no-control-regex -- strips terminal escapes from a row body
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CONTENT_CHARS)
  )
}

/** Run the command once over `tasks`; a failure, a timeout or no output rewrites nothing. */
export async function runSubagentStatusLine(input: {
  line: ChosenSubagentStatusLine
  tasks: readonly SubagentStatusTask[]
  sessionId: string
  cwd: string
  columns: number
  homeDir: string
  runner?: CommandRunner
}): Promise<Array<{ id: string; content: string }>> {
  if (input.tasks.length === 0) return []
  const env = childEnv({
    CLAUDE_PROJECT_DIR: input.cwd,
    // A line from the person's own settings belongs to no plugin.
    ...(input.line.plugin
      ? {
          CLAUDE_PLUGIN_ROOT: input.line.plugin.root,
          CLAUDE_PLUGIN_DATA: pluginDataDir(input.line.plugin.id, input.homeDir),
        }
      : {}),
  })
  const rows = await runKitSubagentStatusLine(
    { type: 'command', command: input.line.command },
    {
      // Localix keeps no transcript file a status line could read.
      input: subagentStatusLineInput(
        { session_id: input.sessionId, transcript_path: '', cwd: input.cwd },
        input.columns,
        input.tasks,
      ),
      env: processEnvironment(() => env).snapshot(),
    },
    input.runner ?? cappedRunner,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  ).catch(() => new Map<string, string>())
  return [...rows].map(([id, content]) => ({ id, content: plainRowText(content) }))
}
