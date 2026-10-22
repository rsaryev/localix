import { childEnv } from '../../lib/login-shell-env'
import { pluginDataDir } from '../ext/user-config-substitute'
import { runHookCommand, type HookCommandOptions } from '../lifecycle-hooks/command'
import type { PluginCatalog } from './catalog'

/**
 * A plugin's `subagentStatusLine` (`settings.json`): Claude Code runs the command on every refresh
 * tick with the visible subagent rows on stdin, and draws each `{"id","content"}` line it prints
 * as that row's body — an empty `content` hides the row, a row it does not name keeps the default.
 * Localix draws its subagents in the runtime panel under the composer, so the same command
 * rewrites those rows; the server owns the refresh (`chat/service/subagent-rows-live.ts`). Enabling the plugin is the trust gate, as for its hooks; when two enabled
 * plugins set one, the one loaded last applies, as in Claude Code.
 */
export interface SubagentStatusLine {
  pluginName: string
  pluginRoot: string
  command: string
}

/** One row the command reads, in Claude Code's task fields. */
export interface SubagentTask {
  id: string
  name?: string
  type: 'local_agent'
  agentType: string
  status: string
  description: string
  label: string
  startTime: number
  model?: string
  tokenCount: number
  /** Up to the last 16 `tokenCount` readings, one per refresh, oldest first. */
  tokenSamples: number[]
  cwd: string
}

const TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_CONTENT_CHARS = 500

/** The status line the scope's enabled plugins set, or null. */
export function activeSubagentStatusLine(catalog: PluginCatalog): SubagentStatusLine | null {
  let found: SubagentStatusLine | null = null
  for (const { plugin } of catalog.enabled) {
    const line = plugin.entrypoints.components?.settings.subagentStatusLine
    if (line)
      found = { pluginName: plugin.manifest.name, pluginRoot: plugin.dir, command: line.command }
  }
  return found
}

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

/** The rows the command rewrote: one JSON line per row; other lines and unknown ids are ignored. */
export function parseSubagentRows(
  stdout: string,
  ids: ReadonlySet<string>,
): Array<{ id: string; content: string }> {
  const rows = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    try {
      const parsed = JSON.parse(text) as { id?: unknown; content?: unknown }
      if (typeof parsed.id === 'string' && ids.has(parsed.id) && typeof parsed.content === 'string')
        rows.set(parsed.id, plainRowText(parsed.content))
    } catch {
      // Not a row: Claude Code ignores it too.
    }
  }
  return [...rows].map(([id, content]) => ({ id, content }))
}

/** Run the command once over `tasks`; a failure, a timeout or no output rewrites nothing. */
export async function runSubagentStatusLine(input: {
  line: SubagentStatusLine
  tasks: readonly SubagentTask[]
  sessionId: string
  cwd: string
  columns: number
  homeDir: string
  run?: (options: HookCommandOptions) => ReturnType<typeof runHookCommand>
}): Promise<Array<{ id: string; content: string }>> {
  if (input.tasks.length === 0) return []
  const result = await (input.run ?? runHookCommand)({
    command: input.line.command,
    input: JSON.stringify({
      session_id: input.sessionId,
      cwd: input.cwd,
      columns: input.columns,
      tasks: input.tasks,
    }),
    cwd: input.cwd,
    timeoutMs: TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    env: childEnv({
      CLAUDE_PROJECT_DIR: input.cwd,
      CLAUDE_PLUGIN_ROOT: input.line.pluginRoot,
      CLAUDE_PLUGIN_DATA: pluginDataDir(input.line.pluginName, input.homeDir),
    }),
  }).catch(() => null)
  if (!result || result.code !== 0) return []
  return parseSubagentRows(result.stdout, new Set(input.tasks.map((task) => task.id)))
}
