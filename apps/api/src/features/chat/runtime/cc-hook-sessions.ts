/**
 * Claude Code hooks BETWEEN runs: the events that happen to a session while no turn is running
 * (its model switched, its project moved, a watched file changed) and the context they leave for
 * the next turn.
 *
 * A session's hooks are the ones its latest run assembled (enabled plugins plus nothing scoped):
 * each run hands them here, so an event outside a run fires exactly the handlers the session's
 * turns fire. A session that has not run since the process started has not started its hooks
 * session either — the same moment `SessionStart` has not fired — and its between-run events fire
 * nothing.
 *
 * `FileChanged` watching lives here too: the literal filenames the session's `FileChanged`
 * matchers name (in its working directory) and the absolute paths hooks returned as `watchPaths`
 * are watched until the session is forgotten. A change fires `FileChanged`; its `watchPaths`
 * replace the dynamic list.
 */
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import {
  createCcHooksRuntime,
  INERT_CC_HOOKS,
  type CcHookEvent,
  type CcHookRegistry,
  type CcHooksRuntime,
  type CcSessionEnvFiles,
} from '../../cc-hooks'
import type { ScopedCcHooks } from './run-contract'

/** Watch one file; `onChange` fires on any change to it. Returns the disposer. */
export type WatchFile = (path: string, onChange: () => void) => () => void

export interface CcHookSessionEntry {
  registry: CcHookRegistry
  projectDir: string
  onceKeys?: Set<string>
  emitNotice?: (message: string, event: CcHookEvent) => void
  /** The session's `CLAUDE_ENV_FILE`s: CwdChanged and FileChanged hooks write theirs there. */
  envFiles?: CcSessionEnvFiles
}

/** Sessions watched at once; the oldest watch is dropped beyond it. */
const MAX_WATCHED_SESSIONS = 64

const logger = { warn: (m: string) => console.warn(m), info: (m: string) => console.info(m) }

export function createCcHookSessions(watchFile?: WatchFile) {
  const entries = new Map<string, CcHookSessionEntry>()
  const pendingContext = new Map<string, string>()
  /** What `async` hooks said after they exited, oldest first; every one reaches the next turn. */
  const asyncContext = new Map<string, string[]>()
  const dynamicWatch = new Map<string, string[]>()
  const watches = new Map<string, Map<string, { dispose: () => void; existed: boolean }>>()
  const skillHooks = new Map<string, Map<string, ScopedCcHooks>>()

  function runtimeFor(sessionId: string): CcHooksRuntime {
    const entry = entries.get(sessionId)
    if (!entry) return INERT_CC_HOOKS
    return createCcHooksRuntime({
      registry: entry.registry,
      sessionId,
      projectDir: entry.projectDir,
      enabled: true,
      logger,
      ...(entry.onceKeys ? { onceKeys: entry.onceKeys } : {}),
      ...(entry.emitNotice ? { emitNotice: entry.emitNotice } : {}),
      ...(entry.envFiles ? { envFiles: entry.envFiles } : {}),
      onAsyncContext: (text) => appendAsyncContext(sessionId, text),
    })
  }

  function appendAsyncContext(sessionId: string, text: string): void {
    asyncContext.set(sessionId, [...(asyncContext.get(sessionId) ?? []), text])
  }

  async function fileChanged(sessionId: string, path: string): Promise<void> {
    const watch = watches.get(sessionId)?.get(path)
    if (!watch) return
    const exists = existsSync(path)
    const event = !exists ? 'unlink' : watch.existed ? 'change' : 'add'
    watch.existed = exists
    const { watchPaths } = await runtimeFor(sessionId).runFileChanged(path, event)
    if (watchPaths) setWatchPaths(sessionId, watchPaths)
  }

  /** Reconcile one session's watchers with its matcher filenames and dynamic paths. */
  function syncWatches(sessionId: string): void {
    if (!watchFile) return
    const entry = entries.get(sessionId)
    const wanted = new Set<string>()
    if (entry) {
      for (const name of runtimeFor(sessionId).fileChangedWatchNames())
        wanted.add(isAbsolute(name) ? name : join(entry.projectDir, name))
      for (const path of dynamicWatch.get(sessionId) ?? []) if (isAbsolute(path)) wanted.add(path)
    }
    const current = watches.get(sessionId) ?? new Map()
    for (const [path, watch] of current)
      if (!wanted.has(path)) {
        watch.dispose()
        current.delete(path)
      }
    for (const path of wanted)
      if (!current.has(path))
        current.set(path, {
          existed: existsSync(path),
          dispose: watchFile(path, () => void fileChanged(sessionId, path).catch(() => {})),
        })
    if (current.size === 0) {
      watches.delete(sessionId)
      return
    }
    watches.delete(sessionId)
    watches.set(sessionId, current)
    while (watches.size > MAX_WATCHED_SESSIONS) {
      const [oldest, dropped] = watches.entries().next().value!
      for (const watch of dropped.values()) watch.dispose()
      watches.delete(oldest)
    }
  }

  function setWatchPaths(sessionId: string, paths: readonly string[]): void {
    dynamicWatch.set(sessionId, [...paths])
    syncWatches(sessionId)
  }

  return {
    /** A run assembled the session's hooks: remember them for its between-run events. */
    remember(sessionId: string, entry: CcHookSessionEntry): void {
      entries.set(sessionId, entry)
      syncWatches(sessionId)
    },
    /** The session's hooks outside a run; inert until the session has run in this process. */
    runtimeFor,
    /** Replace the session's dynamic watch list (a hook's `watchPaths`). */
    setWatchPaths,
    /** Context a between-run hook left for the model (replacing any earlier); next request. */
    setPendingContext(sessionId: string, text: string | undefined): void {
      if (text) pendingContext.set(sessionId, text)
      else pendingContext.delete(sessionId)
    },
    /**
     * What an `async` hook said after it exited (hooks.md: delivered "to Claude on the next
     * conversation turn"). Added to what is already waiting, never replacing it.
     */
    appendAsyncContext,
    takeContext(sessionId: string): string | undefined {
      const parts = [pendingContext.get(sessionId), ...(asyncContext.get(sessionId) ?? [])]
      pendingContext.delete(sessionId)
      asyncContext.delete(sessionId)
      const kept = parts.filter((part): part is string => Boolean(part))
      return kept.length > 0 ? kept.join('\n\n') : undefined
    },
    /**
     * An invoked skill's frontmatter `hooks`, kept for "the rest of the session once the skill is
     * invoked" (Claude Code). Invoking the same skill again registers nothing new.
     */
    addSkillHooks(sessionId: string, hooks: ScopedCcHooks): void {
      const key = JSON.stringify([hooks.plugin?.name ?? null, hooks.raw])
      const kept = skillHooks.get(sessionId) ?? new Map<string, ScopedCcHooks>()
      if (!kept.has(key)) kept.set(key, hooks)
      skillHooks.set(sessionId, kept)
    },
    /** The skill hooks the session's runs merge, in the order the skills were invoked. */
    skillHooks(sessionId: string): ScopedCcHooks[] {
      return [...(skillHooks.get(sessionId)?.values() ?? [])]
    },
    forget(sessionId: string): void {
      skillHooks.delete(sessionId)
      entries.delete(sessionId)
      pendingContext.delete(sessionId)
      asyncContext.delete(sessionId)
      dynamicWatch.delete(sessionId)
      for (const watch of watches.get(sessionId)?.values() ?? []) watch.dispose()
      watches.delete(sessionId)
    },
  }
}

export type CcHookSessions = ReturnType<typeof createCcHookSessions>
