import { join } from 'node:path'

import { claudeCodeHome, claudeConfigDir } from '../../cc-settings/config-dir'
import { sessionRoute } from '../../../contracts/session-route'
import { childEnv } from '../../../lib/login-shell-env'
import { settingsCommandLine, type SettingsCommandLine } from '../../cc-settings/settings-commands'
import {
  localSettingsRoot,
  readSettingsFileLayers,
  type SettingsLayer,
} from '../../cc-settings/settings-files'
import { claudeCodeSettingsEnv } from '../../cc-settings/settings-env'
import { settingsAdditionalDirectories } from '../../cc-settings/settings-permissions'
import { claudeCodeTrusts } from '../../cc-settings/settings-trust'
import { runHookCommand } from '../../lifecycle-hooks/command'
import type { StatusLineDeps } from './status-line-deps'
import { statusLineInput } from './status-line-input'
import { statusLineRows } from './status-line-output'
import { watchSettingsDirs } from './status-line-watch'
import { readStatusLineWorkspace } from './status-line-workspace'
import type { Timers } from './subagent-rows-live'

export { statusLineInput } from './status-line-input'
export type { StatusLineDeps } from './status-line-deps'
export type { StatusLineUsage } from './status-line-usage'

/**
 * CLAUDE CODE'S `statusLine`, UNDER A CONVERSATION'S MESSAGE BOX (statusline.md). The command of
 * the person's settings for the conversation's folder runs with the session as JSON on stdin
 * (`status-line-input.ts`), and what it prints is the line: each printed row its own row, with
 * its colors and links (`status-line-output.ts`) — drawn with the mods' status lines, as Claude
 * Code's status bar shows both.
 *
 * When it runs, as in Claude Code: when the conversation is opened or changes (a new message, a
 * mode change, a compaction), batched 300 ms; at once when the `command` setting changes; every
 * `refreshInterval` seconds while a client renders it; an update while the command runs cancels
 * it. A command that fails, times out or prints nothing clears the line.
 */

const DEBOUNCE_MS = 300
const TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 64 * 1024
const COLUMNS = 120

const realTimers: Timers = {
  set(run, ms) {
    const handle = setTimeout(run, ms)
    handle.unref?.()
    return handle
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

interface Entry {
  timer: unknown
  refreshTimer: unknown
  running: AbortController | null
  done: Promise<void>
  /** The command the last draw ran, to tell a changed one from another setting. */
  command: string | undefined
  unwatch: (() => void) | null
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
        (entry = {
          timer: null,
          refreshTimer: null,
          running: null,
          done: Promise.resolve(),
          command: undefined,
          unwatch: null,
        }),
      )
    return entry
  }

  /** The session, its folder and the `statusLine` setting that applies there. */
  async function resolveLine(userId: string, sessionId: string) {
    const session = await deps.requireSession(userId, sessionId)
    const cwd = await deps.resolveSessionWorkingDir(userId, session)
    const settingsInput = {
      homeDir: homeDir(),
      cwd,
      ...(deps.env ? { env: deps.env } : {}),
      ...(deps.managed !== undefined ? { managed: deps.managed } : {}),
    }
    const layers: SettingsLayer[] = readSettingsFileLayers(settingsInput)
    const line: SettingsCommandLine | undefined = settingsCommandLine(layers, 'statusLine')
    return { session, cwd, settingsInput, layers, line }
  }

  /** The folders whose settings files may set the line: a change in one is a trigger. */
  function settingsDirs(cwd: string): string[] {
    const root = localSettingsRoot(cwd, homeDir())
    return [
      claudeConfigDir(homeDir(), deps.env ?? process.env),
      join(cwd, '.claude'),
      ...(root ? [join(root, '.claude')] : []),
    ]
  }

  /** The conversation's entry, if it is still the one in the map (a deletion or release drops it). */
  const isLive = (userId: string, sessionId: string, entry: Entry) =>
    entries.get(keyOf(userId, sessionId)) === entry

  /** Stop everything the conversation's line holds: its draw, timers and settings watchers. */
  function release(userId: string, sessionId: string) {
    const key = keyOf(userId, sessionId)
    const entry = entries.get(key)
    if (!entry) return
    entry.running?.abort()
    entry.unwatch?.()
    entry.unwatch = null
    timers.clear(entry.timer)
    timers.clear(entry.refreshTimer)
    entries.delete(key)
  }

  async function draw(
    userId: string,
    sessionId: string,
    entry: Entry,
    signal: AbortSignal,
  ): Promise<number | undefined> {
    const { session, cwd, settingsInput, layers, line } = await resolveLine(userId, sessionId)
    // Deleted, or let go of, while the settings were read: leave nothing behind.
    if (signal.aborted || !isLive(userId, sessionId, entry)) return undefined
    entry.command = line?.command
    const onSettingsChange = () => void (entry.done = settingsChanged(userId, sessionId))
    const dirs = settingsDirs(cwd)
    entry.unwatch ??= deps.watchSettings
      ? deps.watchSettings(dirs, onSettingsChange)
      : watchSettingsDirs(dirs, onSettingsChange)
    if (!line) {
      deps.publish(sessionId, undefined)
      return undefined
    }
    const trusted = claudeCodeTrusts(settingsInput)
    const route = sessionRoute(session)
    const [usage, model, workspace, transcriptPath] = await Promise.all([
      deps.usage(userId, sessionId),
      deps.modelInfo?.(userId, route).catch(() => ({})),
      (deps.workspace ? deps.workspace(cwd) : readStatusLineWorkspace(cwd)).catch(() => ({})),
      deps.transcriptPath?.(userId, session, cwd).catch(() => undefined),
    ])
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
          ...(model ? { model } : {}),
          workspace,
          ...(transcriptPath ? { transcriptPath } : {}),
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
    deps.publish(
      sessionId,
      result?.code === 0 ? statusLineRows(result.stdout, line.padding) : undefined,
    )
    return line.refreshInterval
  }

  /** Draw now, cancelling a draw in flight; re-arm the refresh timer while watched. */
  function refresh(userId: string, sessionId: string): Promise<void> {
    const entry = entryOf(userId, sessionId)
    entry.running?.abort()
    const controller = new AbortController()
    entry.running = controller
    timers.clear(entry.refreshTimer)
    entry.done = draw(userId, sessionId, entry, controller.signal)
      .then((interval) => {
        if (entry.running !== controller || !isLive(userId, sessionId, entry)) return
        entry.running = null
        if (interval && deps.watched(userId, sessionId))
          entry.refreshTimer = timers.set(
            () => refreshIfWatched(userId, sessionId),
            interval * 1000,
          )
      })
      .catch(() => {
        if (entry.running === controller) entry.running = null
      })
    return entry.done
  }

  /** A timer fired: draw if a client still renders the conversation, else let go of it. */
  function refreshIfWatched(userId: string, sessionId: string) {
    if (deps.watched(userId, sessionId)) void refresh(userId, sessionId)
    else release(userId, sessionId)
  }

  /** Draw once, a moment later, however many requests arrive; `opened` skips the watched check. */
  function schedule(userId: string, sessionId: string, opened = false) {
    const entry = entryOf(userId, sessionId)
    timers.clear(entry.timer)
    entry.timer = timers.set(() => {
      entry.timer = null
      if (opened) void refresh(userId, sessionId)
      else refreshIfWatched(userId, sessionId)
    }, DEBOUNCE_MS)
  }

  /**
   * The conversation changed: draw once, a moment later, however many changes arrive — but only a
   * conversation a client renders; a background or child session runs no command, and one nobody
   * renders any more lets go of its settings watchers.
   */
  function changed(userId: string, sessionId: string) {
    if (deps.watched(userId, sessionId)) schedule(userId, sessionId)
    else release(userId, sessionId)
  }

  /**
   * A settings file changed. A different `command` (or none, or a first one) runs at once, past
   * the debounce, as Claude Code runs a new command right away; any other setting is a change
   * like the rest.
   */
  async function settingsChanged(userId: string, sessionId: string): Promise<void> {
    const entry = entries.get(keyOf(userId, sessionId))
    if (!entry) return
    if (!deps.watched(userId, sessionId)) return release(userId, sessionId)
    const { line } = await resolveLine(userId, sessionId).catch(() => ({ line: undefined }))
    if (!isLive(userId, sessionId, entry)) return
    if (line?.command !== entry.command) await refresh(userId, sessionId)
    else changed(userId, sessionId)
  }

  return {
    refresh,
    changed,
    /** Every conversation it draws, again (settings may have changed). */
    refreshAll() {
      for (const key of Array.from(entries.keys())) {
        const [userId, sessionId] = key.split('\0') as [string, string]
        refreshIfWatched(userId, sessionId)
      }
    },
    deleted: release,
    /** A client opened the conversation: its first draw, once (its stream may not be up yet). */
    viewed(userId: string, sessionId: string) {
      if (!entries.has(keyOf(userId, sessionId))) schedule(userId, sessionId, true)
    },
    /** Resolves when the draw in flight, if any, is done. */
    settled: (userId: string, sessionId: string) =>
      entries.get(keyOf(userId, sessionId))?.done ?? Promise.resolve(),
  }
}

export type StatusLine = ReturnType<typeof createStatusLine>
