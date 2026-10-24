import { claudeCodeHome } from '../../cc-settings/config-dir'
import { agentRoute, sessionRoute } from '../../../contracts/session-route'
import { childEnv } from '../../../lib/login-shell-env'
import { settingsCommandLine } from '../../cc-settings/settings-commands'
import { readSettingsFileLayers } from '../../cc-settings/settings-files'
import type { ManagedSettingsSource } from '../../cc-settings/managed-settings'
import { claudeCodeSettingsEnv } from '../../cc-settings/settings-env'
import { settingsAdditionalDirectories } from '../../cc-settings/settings-permissions'
import { claudeCodeTrusts } from '../../cc-settings/settings-trust'
import { runHookCommand, type HookCommandOptions } from '../../lifecycle-hooks/command'
import { plainRowText } from '../../plugins/subagent-status-line'
import type { SessionRecord } from '../repository'
import type { Timers } from './subagent-rows-live'

/**
 * CLAUDE CODE'S `statusLine`, UNDER A CONVERSATION'S MESSAGE BOX (statusline.md). The command of
 * the person's settings for the conversation's folder runs with the session as JSON on stdin, and
 * what it prints is the line — drawn with the mods' status lines, as Claude Code's status bar
 * shows both. Colors and links are stripped (the line is drawn in the kit's own type) and rows
 * are joined with ` · `.
 *
 * When it runs, as in Claude Code: when the conversation is opened or changes (a new message,
 * a mode change), batched 300 ms; every `refreshInterval` seconds while a client renders it; an
 * update while the command runs cancels it. A command that fails, times out or prints nothing
 * clears the line.
 */

const DEBOUNCE_MS = 300
const TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 64 * 1024
const COLUMNS = 120

export interface StatusLineUsage {
  totalCost?: number
  inputTokens?: number
  outputTokens?: number
  /** Tokens in the context window after the last model call, and the window's size. */
  context?: { used?: number; size?: number }
}

export interface StatusLineDeps {
  requireSession(userId: string, sessionId: string): Promise<SessionRecord>
  resolveSessionWorkingDir(userId: string, session: SessionRecord): Promise<string>
  usage(userId: string, sessionId: string): Promise<StatusLineUsage>
  /** Draw (or with `undefined`, clear) the conversation's line. */
  publish(sessionId: string, text: string | undefined): void
  /** Is a client rendering the conversation? The refresh timer runs only then. */
  watched(userId: string, sessionId: string): boolean
  homeDir?: string
  env?: Record<string, string | undefined>
  managed?: ManagedSettingsSource | null
  timers?: Timers
  run?: (options: HookCommandOptions) => ReturnType<typeof runHookCommand>
}

const realTimers: Timers = {
  set(run, ms) {
    const handle = setTimeout(run, ms)
    handle.unref?.()
    return handle
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const percent = (used: number | undefined, size: number | undefined) =>
  used !== undefined && size ? Math.round((used / size) * 100) : null

/** The session as the command reads it on stdin (statusline.md, "Available data"). */
export function statusLineInput(input: {
  session: SessionRecord
  cwd: string
  addedDirs: readonly string[]
  usage: StatusLineUsage
}) {
  const { session, cwd, usage } = input
  const route = agentRoute(session, sessionRoute(session).agentId) ?? sessionRoute(session)
  const modelId = route?.modelId ?? ''
  const used = usage.context?.used
  const size = usage.context?.size
  const usedPercentage = percent(used, size)
  return {
    cwd,
    session_id: session.id,
    ...(session.title ? { session_name: session.title } : {}),
    transcript_path: '',
    model: { id: modelId, display_name: modelId },
    workspace: { current_dir: cwd, project_dir: cwd, added_dirs: [...input.addedDirs] },
    ...(session.outputStyle ? { output_style: { name: session.outputStyle } } : {}),
    cost: {
      total_cost_usd: usage.totalCost ?? 0,
      total_duration_ms: Math.max(0, Date.now() - (Date.parse(session.createdAt) || Date.now())),
      total_api_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    },
    context_window: {
      total_input_tokens: usage.inputTokens ?? 0,
      total_output_tokens: usage.outputTokens ?? 0,
      context_window_size: size ?? null,
      used_percentage: usedPercentage,
      remaining_percentage: usedPercentage === null ? null : 100 - usedPercentage,
      current_usage: null,
    },
    exceeds_200k_tokens: (used ?? 0) > 200_000,
    ...(route?.reasoningEffort ? { effort: { level: route.reasoningEffort } } : {}),
  }
}

/** The line a command printed: escapes stripped, rows joined. */
export function statusLineText(stdout: string): string | undefined {
  const rows = stdout
    .split('\n')
    .map((row) => plainRowText(row))
    .filter(Boolean)
  return rows.length > 0 ? rows.join(' · ') : undefined
}

interface Entry {
  timer: unknown
  refreshTimer: unknown
  running: AbortController | null
  done: Promise<void>
}

export function createStatusLine(deps: StatusLineDeps) {
  const timers = deps.timers ?? realTimers
  const homeDir = () => deps.homeDir ?? claudeCodeHome()
  const entries = new Map<string, Entry>()
  const keyOf = (userId: string, sessionId: string) => `${userId}\0${sessionId}`
  const entryOf = (userId: string, sessionId: string) => {
    const key = keyOf(userId, sessionId)
    let entry = entries.get(key)
    if (!entry)
      entries.set(
        key,
        (entry = { timer: null, refreshTimer: null, running: null, done: Promise.resolve() }),
      )
    return entry
  }

  async function draw(
    userId: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<number | undefined> {
    const session = await deps.requireSession(userId, sessionId)
    const cwd = await deps.resolveSessionWorkingDir(userId, session)
    const settingsInput = {
      homeDir: homeDir(),
      cwd,
      ...(deps.env ? { env: deps.env } : {}),
      ...(deps.managed !== undefined ? { managed: deps.managed } : {}),
    }
    const layers = readSettingsFileLayers(settingsInput)
    const line = settingsCommandLine(layers, 'statusLine')
    if (!line) {
      deps.publish(sessionId, undefined)
      return undefined
    }
    const trusted = claudeCodeTrusts(settingsInput)
    const usage = await deps.usage(userId, sessionId)
    const result = await (deps.run ?? runHookCommand)({
      command: line.command,
      input: JSON.stringify(
        statusLineInput({
          session,
          cwd,
          addedDirs: settingsAdditionalDirectories(layers, {
            projectTrusted: trusted,
            cwd,
            homeDir: homeDir(),
          }),
          usage,
        }),
      ),
      cwd,
      timeoutMs: TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      signal,
      env: childEnv({
        ...claudeCodeSettingsEnv(settingsInput),
        CLAUDE_PROJECT_DIR: cwd,
        COLUMNS: String(COLUMNS),
        LINES: '1',
      }),
    }).catch(() => null)
    if (signal.aborted) return line.refreshInterval
    const text = result && result.code === 0 ? statusLineText(result.stdout) : undefined
    deps.publish(sessionId, text && line.padding ? `${' '.repeat(line.padding)}${text}` : text)
    return line.refreshInterval
  }

  /** Draw now, cancelling a draw in flight; re-arm the refresh timer while watched. */
  function refresh(userId: string, sessionId: string): Promise<void> {
    const entry = entryOf(userId, sessionId)
    entry.running?.abort()
    const controller = new AbortController()
    entry.running = controller
    timers.clear(entry.refreshTimer)
    entry.done = draw(userId, sessionId, controller.signal)
      .then((interval) => {
        if (entry.running !== controller) return
        entry.running = null
        if (interval && deps.watched(userId, sessionId))
          entry.refreshTimer = timers.set(() => void refresh(userId, sessionId), interval * 1000)
      })
      .catch(() => {
        if (entry.running === controller) entry.running = null
      })
    return entry.done
  }

  /** The conversation changed: draw once, a moment later, however many changes arrive. */
  function changed(userId: string, sessionId: string) {
    const entry = entryOf(userId, sessionId)
    timers.clear(entry.timer)
    entry.timer = timers.set(() => {
      entry.timer = null
      void refresh(userId, sessionId)
    }, DEBOUNCE_MS)
  }

  return {
    refresh,
    changed,
    /** Every conversation it draws, again (settings may have changed). */
    refreshAll() {
      for (const key of entries.keys()) {
        const [userId, sessionId] = key.split('\0') as [string, string]
        void refresh(userId, sessionId)
      }
    },
    deleted(userId: string, sessionId: string) {
      const entry = entries.get(keyOf(userId, sessionId))
      if (!entry) return
      entry.running?.abort()
      timers.clear(entry.timer)
      timers.clear(entry.refreshTimer)
      entries.delete(keyOf(userId, sessionId))
    },
    /** A client opened the conversation: its first draw, once. */
    viewed(userId: string, sessionId: string) {
      if (!entries.has(keyOf(userId, sessionId))) changed(userId, sessionId)
    },
    /** Resolves when the draw in flight, if any, is done. */
    settled: (userId: string, sessionId: string) => entryOf(userId, sessionId).done,
  }
}

export type StatusLine = ReturnType<typeof createStatusLine>
